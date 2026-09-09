BEGIN;

CREATE TABLE public.provider_verification_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  note text CHECK(note IS NULL OR char_length(note)<=2000),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  review_note text CHECK(review_note IS NULL OR char_length(review_note)<=2000),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(requested_by,client_request_id),
  CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status='cancelled' AND reviewed_by IS NULL)
    OR (status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX provider_verification_one_pending
  ON public.provider_verification_requests(provider_id) WHERE status='pending';
CREATE INDEX provider_verification_status_updated
  ON public.provider_verification_requests(status,updated_at DESC,id DESC);

CREATE TABLE public.provider_verification_documents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.provider_verification_requests(id) ON DELETE RESTRICT,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK(position BETWEEN 0 AND 4),
  storage_path text NOT NULL UNIQUE CHECK(char_length(storage_path) BETWEEN 1 AND 500),
  original_name text NOT NULL CHECK(char_length(original_name) BETWEEN 1 AND 255 AND original_name !~ '[/\\]'),
  mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,position)
);

ALTER TABLE public.provider_verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_verification_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_verification_requests,public.provider_verification_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.provider_verification_requests,public.provider_verification_documents TO authenticated;
GRANT ALL ON public.provider_verification_requests,public.provider_verification_documents TO service_role;
CREATE POLICY provider_verification_owner_read ON public.provider_verification_requests
FOR SELECT TO authenticated USING (
  public.is_account_active((SELECT auth.uid())) AND (
    requested_by=(SELECT auth.uid()) OR public.is_app_admin()
  )
);
CREATE POLICY provider_verification_document_read ON public.provider_verification_documents
FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.provider_verification_requests request WHERE request.id=request_id)
);

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('provider-verification','provider-verification',false,10485760,ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
CREATE POLICY provider_verification_object_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id='provider-verification' AND public.is_account_active((SELECT auth.uid())) AND (
    public.is_app_admin() OR EXISTS(
      SELECT 1 FROM public.providers provider
      WHERE provider.id::text=(storage.foldername(name))[1]
        AND provider.user_id=(SELECT auth.uid())
    )
  )
);
CREATE POLICY provider_verification_object_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id='provider-verification' AND public.is_account_active((SELECT auth.uid()))
  AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
  AND EXISTS(
    SELECT 1 FROM public.providers provider
    WHERE provider.id::text=(storage.foldername(name))[1]
      AND provider.user_id=(SELECT auth.uid())
      AND provider.is_active
  )
);
CREATE POLICY provider_verification_object_delete ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id='provider-verification' AND public.is_account_active((SELECT auth.uid()))
  AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
  AND NOT EXISTS(
    SELECT 1 FROM public.provider_verification_documents document WHERE document.storage_path=name
  )
);

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK(type IN ('message','order','withdrawal','support','refund','dispute','verification'));
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,p_event_key text,p_type text,p_title_ar text,p_title_en text,
  p_body_ar text,p_body_en text,p_link text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_account_active(p_user_id) THEN RETURN NULL; END IF;
  IF char_length(coalesce(p_event_key,'')) NOT BETWEEN 1 AND 300
    OR p_type NOT IN ('message','order','withdrawal','support','refund','dispute','verification')
    OR char_length(coalesce(p_title_ar,'')) NOT BETWEEN 1 AND 300
    OR char_length(coalesce(p_title_en,'')) NOT BETWEEN 1 AND 300
    OR char_length(coalesce(p_body_ar,'')) NOT BETWEEN 1 AND 1000
    OR char_length(coalesce(p_body_en,'')) NOT BETWEEN 1 AND 1000
    OR (p_link IS NOT NULL AND (char_length(p_link) NOT BETWEEN 1 AND 1000 OR left(p_link,1)<>'/' OR left(p_link,2)='//' OR p_link~'[[:space:]]')) THEN RAISE EXCEPTION 'Invalid notification'; END IF;
  INSERT INTO public.notifications(user_id,event_key,type,title_ar,title_en,body_ar,body_en,link)
  VALUES(p_user_id,p_event_key,p_type,p_title_ar,p_title_en,p_body_ar,p_body_en,p_link)
  ON CONFLICT(user_id,event_key) DO NOTHING RETURNING id INTO v_id;
  IF NOT FOUND THEN SELECT id INTO v_id FROM public.notifications WHERE user_id=p_user_id AND event_key=p_event_key; END IF;
  RETURN v_id;
END $$;
ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK(action IN (
  'set_admin','verify_provider','set_service_active','review_withdrawal','review_service',
  'suspend_user','restore_user','support_ticket_status','refund_review','dispute_review',
  'payout_tracking','payment_event_relink','provider_verification_review'
));

CREATE OR REPLACE FUNCTION public.apply_admin_action(
  p_actor_id uuid,p_action text,p_target_id uuid,p_value text,p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior jsonb;updated jsonb;
BEGIN
  PERFORM id FROM public.profiles WHERE is_admin OR id IN(p_actor_id,p_target_id) ORDER BY id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin AND deletion_requested_at IS NULL) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_action<>'set_admin' OR p_actor_id=p_target_id OR p_value IS NULL OR p_value NOT IN('true','false') THEN RAISE EXCEPTION 'Unsupported administrator action'; END IF;
  SELECT jsonb_build_object('is_admin',is_admin) INTO prior FROM public.profiles WHERE id=p_target_id AND deletion_requested_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active user not found'; END IF;
  UPDATE public.profiles SET is_admin=p_value::boolean WHERE id=p_target_id;
  updated:=jsonb_build_object('is_admin',p_value::boolean);
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data) VALUES(p_actor_id,p_action,p_target_id,prior,updated);
END $$;

CREATE FUNCTION public.request_provider_verification(
  p_actor_id uuid,p_provider_id uuid,p_client_request_id uuid,p_note text,p_documents jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_request public.provider_verification_requests%rowtype;
  v_existing_documents jsonb;
  v_document jsonb;
  v_position integer:=0;
  v_admin uuid;
BEGIN
  IF p_actor_id IS NULL OR p_client_request_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR char_length(btrim(coalesce(p_note,'')))>2000
    OR jsonb_typeof(coalesce(p_documents,'[]'::jsonb))<>'array'
    OR jsonb_array_length(coalesce(p_documents,'[]'::jsonb)) NOT BETWEEN 1 AND 5
    OR NOT EXISTS(SELECT 1 FROM public.providers provider WHERE provider.id=p_provider_id AND provider.user_id=p_actor_id AND provider.is_active AND NOT provider.is_verified)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_documents,'[]'::jsonb)) document WHERE
      jsonb_typeof(document)<>'object'
      OR char_length(btrim(coalesce(document->>'path',''))) NOT BETWEEN 1 AND 500
      OR char_length(btrim(coalesce(document->>'name',''))) NOT BETWEEN 1 AND 255
      OR coalesce(document->>'name','')~'[/\\]'
      OR coalesce(document->>'mime','') NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
      OR CASE WHEN coalesce(document->>'size','')~'^[0-9]+$' THEN (document->>'size')::integer NOT BETWEEN 1 AND 10485760 ELSE true END
      OR split_part(document->>'path','/',1)<>p_provider_id::text
      OR split_part(document->>'path','/',2)<>p_actor_id::text
      OR array_length(string_to_array(document->>'path','/'),1)<>3
      OR split_part(document->>'path','/',3) NOT LIKE p_client_request_id::text||'-%'
      OR document->>'path'~'\.\.'
      OR NOT EXISTS(SELECT 1 FROM storage.objects object WHERE object.bucket_id='provider-verification' AND object.name=document->>'path')
    ) OR (SELECT count(*)<>count(DISTINCT document->>'path') FROM jsonb_array_elements(coalesce(p_documents,'[]'::jsonb)) document) THEN
    RAISE EXCEPTION 'Invalid verification request';
  END IF;

  SELECT * INTO v_request FROM public.provider_verification_requests
  WHERE requested_by=p_actor_id AND client_request_id=p_client_request_id;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('path',document.storage_path,'name',document.original_name,'mime',document.mime_type,'size',document.size_bytes) ORDER BY document.position),'[]'::jsonb)
    INTO v_existing_documents FROM public.provider_verification_documents document WHERE document.request_id=v_request.id;
    IF v_request.provider_id IS DISTINCT FROM p_provider_id OR coalesce(v_request.note,'') IS DISTINCT FROM btrim(coalesce(p_note,'')) OR v_existing_documents IS DISTINCT FROM p_documents THEN
      RAISE EXCEPTION 'Verification request identifier was reused with different content';
    END IF;
    RETURN to_jsonb(v_request)||jsonb_build_object('documents',v_existing_documents);
  END IF;
  IF EXISTS(SELECT 1 FROM public.provider_verification_requests WHERE provider_id=p_provider_id AND status='pending') THEN
    RAISE EXCEPTION 'A verification request is already pending';
  END IF;
  INSERT INTO public.provider_verification_requests(provider_id,requested_by,client_request_id,note)
  VALUES(p_provider_id,p_actor_id,p_client_request_id,nullif(btrim(coalesce(p_note,'')),'')) RETURNING * INTO v_request;
  FOR v_document IN SELECT value FROM jsonb_array_elements(p_documents) LOOP
    INSERT INTO public.provider_verification_documents(request_id,uploaded_by,position,storage_path,original_name,mime_type,size_bytes)
    VALUES(v_request.id,p_actor_id,v_position,v_document->>'path',v_document->>'name',v_document->>'mime',(v_document->>'size')::integer);
    v_position:=v_position+1;
  END LOOP;
  FOR v_admin IN SELECT id FROM public.profiles WHERE is_admin AND public.is_account_active(id) LOOP
    PERFORM public.create_notification(v_admin,'verification-request:'||v_request.id,'verification','طلب توثيق جديد','New verification request','يوجد طلب توثيق لمقدم خدمة يحتاج إلى مراجعة.','A provider verification request requires review.','/admin/providers');
  END LOOP;
  RETURN to_jsonb(v_request)||jsonb_build_object('documents',p_documents);
END $$;

CREATE FUNCTION public.review_provider_verification(
  p_actor_id uuid,p_request_id uuid,p_decision text,p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_request public.provider_verification_requests%rowtype;v_provider public.providers%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin)
    OR p_decision NOT IN ('approved','rejected') OR char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'Invalid verification review' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_request FROM public.provider_verification_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'pending' THEN RAISE EXCEPTION 'Pending verification request not found'; END IF;
  SELECT * INTO v_provider FROM public.providers WHERE id=v_request.provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found'; END IF;
  UPDATE public.provider_verification_requests SET status=p_decision,review_note=btrim(p_note),reviewed_by=p_actor_id,reviewed_at=now(),updated_at=now() WHERE id=v_request.id;
  UPDATE public.providers SET is_verified=(p_decision='approved'),updated_at=now() WHERE id=v_provider.id;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
  VALUES(p_actor_id,'provider_verification_review',v_provider.id,jsonb_build_object('is_verified',v_provider.is_verified,'request_status',v_request.status),jsonb_build_object('is_verified',(p_decision='approved'),'request_status',p_decision,'request_id',v_request.id,'reason',btrim(p_note)));
  PERFORM public.create_notification(v_request.requested_by,'verification-review:'||v_request.id,'verification','تمت مراجعة طلب التوثيق','Verification request reviewed','حالة الطلب: '||p_decision,'Request status: '||p_decision,'/verification');
  RETURN jsonb_build_object('request_id',v_request.id,'provider_id',v_provider.id,'status',p_decision,'is_verified',(p_decision='approved'));
END $$;

CREATE FUNCTION public.cancel_provider_verification(p_actor_id uuid,p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN RAISE EXCEPTION 'Active account required' USING ERRCODE='42501'; END IF;
  UPDATE public.provider_verification_requests SET status='cancelled',updated_at=now()
  WHERE id=p_request_id AND requested_by=p_actor_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending verification request not found'; END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.revoke_provider_verification(p_actor_id uuid,p_provider_id uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_provider public.providers%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin)
    OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Invalid verification revocation' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_provider FROM public.providers WHERE id=p_provider_id FOR UPDATE;
  IF NOT FOUND OR NOT v_provider.is_verified THEN RAISE EXCEPTION 'Verified provider not found'; END IF;
  UPDATE public.providers SET is_verified=false,updated_at=now() WHERE id=v_provider.id;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
  VALUES(p_actor_id,'provider_verification_review',v_provider.id,jsonb_build_object('is_verified',true),jsonb_build_object('is_verified',false,'reason',btrim(p_reason),'decision','revoked'));
  PERFORM public.create_notification(v_provider.user_id,'verification-revoked:'||v_provider.id||':'||extract(epoch from now())::bigint,'verification','تم إلغاء التوثيق','Verification removed','راجع الإشعار وتواصل مع الدعم عند الحاجة.','Review this notice and contact support if needed.','/verification');
  RETURN true;
END $$;

CREATE FUNCTION public.get_provider_verification_page(
  p_actor_id uuid,p_admin_view boolean,p_before_updated_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS TABLE(id uuid,provider_id uuid,requested_by uuid,note text,status text,review_note text,reviewed_at timestamptz,created_at timestamptz,updated_at timestamptz,provider_name_ar text,provider_name_en text,provider_is_verified boolean,documents jsonb,total_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) OR p_limit NOT BETWEEN 1 AND 100
    OR p_admin_view IS NULL OR ((p_before_updated_at IS NULL)<>(p_before_id IS NULL))
    OR (p_admin_view AND NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)) THEN RAISE EXCEPTION 'Invalid verification query' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT request.id,request.provider_id,request.requested_by,request.note,request.status,request.review_note,request.reviewed_at,request.created_at,request.updated_at,provider.name_ar,provider.name_en,provider.is_verified,
    coalesce((SELECT jsonb_agg(jsonb_build_object('path',document.storage_path,'name',document.original_name,'mime',document.mime_type,'size',document.size_bytes) ORDER BY document.position) FROM public.provider_verification_documents document WHERE document.request_id=request.id),'[]'::jsonb),
    (SELECT count(*) FROM public.provider_verification_requests counted WHERE p_admin_view OR counted.requested_by=p_actor_id)
  FROM public.provider_verification_requests request JOIN public.providers provider ON provider.id=request.provider_id
  WHERE (p_admin_view OR request.requested_by=p_actor_id) AND (p_before_updated_at IS NULL OR request.updated_at<p_before_updated_at OR (request.updated_at=p_before_updated_at AND request.id<p_before_id))
  ORDER BY request.updated_at DESC,request.id DESC LIMIT p_limit;
END $$;

CREATE FUNCTION public.export_user_data_snapshot_v8(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_snapshot jsonb;v_provider_ids uuid[];v_request_ids uuid[];
BEGIN
  v_snapshot:=public.export_user_data_snapshot_v7(p_actor_id);
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_provider_ids FROM public.providers WHERE user_id=p_actor_id;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_request_ids FROM public.provider_verification_requests WHERE requested_by=p_actor_id OR provider_id=ANY(v_provider_ids);
  RETURN v_snapshot||jsonb_build_object('schema_version',8,
    'provider_verification_requests',coalesce((SELECT jsonb_agg(to_jsonb(request) ORDER BY request.created_at,request.id) FROM public.provider_verification_requests request WHERE request.id=ANY(v_request_ids)),'[]'::jsonb),
    'provider_verification_documents',coalesce((SELECT jsonb_agg(to_jsonb(document) ORDER BY document.created_at,document.id) FROM public.provider_verification_documents document WHERE document.request_id=ANY(v_request_ids)),'[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.request_provider_verification(uuid,uuid,uuid,text,jsonb),public.review_provider_verification(uuid,uuid,text,text),public.cancel_provider_verification(uuid,uuid),public.revoke_provider_verification(uuid,uuid,text),public.get_provider_verification_page(uuid,boolean,timestamptz,uuid,integer),public.export_user_data_snapshot_v8(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_provider_verification(uuid,uuid,uuid,text,jsonb),public.cancel_provider_verification(uuid,uuid),public.get_provider_verification_page(uuid,boolean,timestamptz,uuid,integer),public.export_user_data_snapshot_v8(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_provider_verification(uuid,uuid,text,text),public.revoke_provider_verification(uuid,uuid,text) TO service_role;

COMMIT;
