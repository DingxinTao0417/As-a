BEGIN;

ALTER TABLE public.orders
  ADD COLUMN dispute_status text NOT NULL DEFAULT 'none'
    CHECK (dispute_status IN ('none','open','under_review','resolved','closed'));

CREATE TABLE public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  opened_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('delivery','quality','payment','conduct','other')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 5000),
  requested_resolution text NOT NULL CHECK (char_length(requested_resolution) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved','closed')),
  ledger_hold_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (ledger_hold_amount >= 0),
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  resolution text CHECK (resolution IS NULL OR resolution IN ('continue_order','refund','closed_no_action')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 3 AND 2000),
  resolution_refund_id uuid REFERENCES public.refund_requests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(opened_by,client_request_id)
);
CREATE UNIQUE INDEX disputes_one_active_order
  ON public.disputes(order_id) WHERE status IN ('open','under_review');
CREATE INDEX disputes_queue_idx ON public.disputes(status,updated_at DESC);

CREATE TABLE public.dispute_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.disputes(id) ON DELETE RESTRICT,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE CHECK (char_length(storage_path) BETWEEN 10 AND 1000),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispute_evidence_dispute_idx ON public.dispute_evidence(dispute_id,created_at,id);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.disputes,public.dispute_evidence FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.disputes,public.dispute_evidence TO authenticated;
GRANT ALL ON public.disputes,public.dispute_evidence TO service_role;
CREATE POLICY dispute_participant_read ON public.disputes
  FOR SELECT TO authenticated USING (
    public.is_account_active((SELECT auth.uid())) AND EXISTS (
      SELECT 1 FROM public.orders order_record
      WHERE order_record.id=order_id AND (
        order_record.seeker_id=(SELECT auth.uid()) OR public.owns_provider(order_record.provider_id)
        OR public.is_app_admin()
      )
    )
  );
CREATE POLICY dispute_evidence_participant_read ON public.dispute_evidence
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.disputes dispute WHERE dispute.id=dispute_id)
  );

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('dispute-evidence','dispute-evidence',false,10485760,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE POLICY dispute_evidence_object_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id='dispute-evidence' AND public.is_account_active((SELECT auth.uid())) AND EXISTS (
    SELECT 1 FROM public.disputes dispute
    JOIN public.orders order_record ON order_record.id=dispute.order_id
    WHERE dispute.id::text=(storage.foldername(name))[1] AND (
      order_record.seeker_id=(SELECT auth.uid()) OR public.owns_provider(order_record.provider_id)
      OR public.is_app_admin()
    )
  )
);
CREATE POLICY dispute_evidence_object_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id='dispute-evidence' AND public.is_account_active((SELECT auth.uid()))
  AND (storage.foldername(name))[2]=(SELECT auth.uid())::text AND EXISTS (
    SELECT 1 FROM public.disputes dispute
    JOIN public.orders order_record ON order_record.id=dispute.order_id
    WHERE dispute.id::text=(storage.foldername(name))[1]
      AND dispute.status IN ('open','under_review')
      AND (order_record.seeker_id=(SELECT auth.uid()) OR public.owns_provider(order_record.provider_id) OR public.is_app_admin())
  )
);
CREATE POLICY dispute_evidence_object_delete ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id='dispute-evidence' AND public.is_account_active((SELECT auth.uid())) AND (
    (storage.foldername(name))[2]=(SELECT auth.uid())::text OR public.is_app_admin()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.dispute_evidence evidence WHERE evidence.storage_path=name
  )
);

ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN (
    'set_admin','verify_provider','set_service_active','review_withdrawal','review_service',
    'suspend_user','restore_user','support_ticket_status','refund_review','dispute_review'
  ));
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('message','order','withdrawal','support','refund','dispute'));

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,p_event_key text,p_type text,p_title_ar text,p_title_en text,
  p_body_ar text,p_body_en text,p_link text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_account_active(p_user_id) THEN RETURN NULL; END IF;
  IF char_length(coalesce(p_event_key,'')) NOT BETWEEN 1 AND 300
     OR p_type NOT IN ('message','order','withdrawal','support','refund','dispute')
     OR char_length(coalesce(p_title_ar,'')) NOT BETWEEN 1 AND 300
     OR char_length(coalesce(p_title_en,'')) NOT BETWEEN 1 AND 300
     OR char_length(coalesce(p_body_ar,'')) NOT BETWEEN 1 AND 1000
     OR char_length(coalesce(p_body_en,'')) NOT BETWEEN 1 AND 1000
     OR (p_link IS NOT NULL AND (char_length(p_link) NOT BETWEEN 1 AND 1000
       OR left(p_link,1)<>'/' OR left(p_link,2)='//' OR p_link~'[[:space:]]')) THEN
    RAISE EXCEPTION 'Invalid notification';
  END IF;
  INSERT INTO public.notifications(user_id,event_key,type,title_ar,title_en,body_ar,body_en,link)
    VALUES(p_user_id,p_event_key,p_type,p_title_ar,p_title_en,p_body_ar,p_body_en,p_link)
    ON CONFLICT(user_id,event_key) DO NOTHING RETURNING id INTO v_id;
  IF NOT FOUND THEN SELECT id INTO v_id FROM public.notifications WHERE user_id=p_user_id AND event_key=p_event_key; END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION public.create_order_dispute(
  p_actor_id uuid,p_order_id uuid,p_client_request_id uuid,p_category text,
  p_description text,p_requested_resolution text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
  v_provider_user_id uuid;
  v_existing public.disputes%rowtype;
  v_dispute public.disputes%rowtype;
  v_refund_provider numeric;
  v_hold numeric;
  v_recipient uuid;
  v_admin record;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) OR p_client_request_id IS NULL
     OR p_category NOT IN ('delivery','quality','payment','conduct','other')
     OR char_length(btrim(coalesce(p_description,''))) NOT BETWEEN 10 AND 5000
     OR char_length(btrim(coalesce(p_requested_resolution,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid dispute';
  END IF;
  SELECT * INTO v_existing FROM public.disputes WHERE opened_by=p_actor_id AND client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_existing.order_id<>p_order_id OR v_existing.category<>p_category
       OR v_existing.description<>btrim(p_description)
       OR v_existing.requested_resolution<>btrim(p_requested_resolution) THEN
      RAISE EXCEPTION 'Dispute request ID was reused with different content';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id=v_order.provider_id FOR UPDATE;
  IF p_actor_id NOT IN (v_order.seeker_id,v_provider_user_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501'; END IF;
  IF v_order.status NOT IN ('paid','revision_requested','awaiting_confirmation','completed') THEN RAISE EXCEPTION 'Order cannot be disputed'; END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id=p_order_id AND status IN ('requested','approved','processing','unknown')) THEN
    RAISE EXCEPTION 'Open refund already covers this order';
  END IF;
  SELECT coalesce(sum(provider_amount),0) INTO v_refund_provider FROM public.refund_requests
    WHERE order_id=p_order_id AND status='succeeded';
  v_hold:=CASE WHEN v_order.status='completed' THEN greatest(v_order.provider_amount-v_refund_provider,0) ELSE 0 END;
  INSERT INTO public.disputes(order_id,opened_by,client_request_id,category,description,requested_resolution,ledger_hold_amount)
    VALUES(p_order_id,p_actor_id,p_client_request_id,p_category,btrim(p_description),btrim(p_requested_resolution),v_hold)
    RETURNING * INTO v_dispute;
  IF v_hold>0 THEN
    INSERT INTO public.ledger_entries(provider_id,order_id,entry_type,reference_key,available_delta,reserved_delta,note)
      VALUES(v_order.provider_id,v_order.id,'dispute_hold','dispute:'||v_dispute.id||':hold',-v_hold,v_hold,'Open dispute reserve');
  END IF;
  UPDATE public.orders SET dispute_status='open' WHERE id=p_order_id;
  v_recipient:=CASE WHEN p_actor_id=v_order.seeker_id THEN v_provider_user_id ELSE v_order.seeker_id END;
  PERFORM public.create_notification(v_recipient,'dispute:'||v_dispute.id||':opened','dispute',
    'نزاع جديد على الطلب','New order dispute','تم فتح نزاع على أحد طلباتك.','A dispute was opened for one of your orders.',
    '/disputes?dispute='||v_dispute.id);
  FOR v_admin IN SELECT id FROM public.profiles WHERE is_admin AND public.is_account_active(id) LOOP
    PERFORM public.create_notification(v_admin.id,'dispute:'||v_dispute.id||':opened','dispute',
      'نزاع يحتاج المراجعة','Dispute awaiting review','يوجد نزاع جديد يحتاج إلى مراجعة.','A new dispute requires review.',
      '/admin/disputes?dispute='||v_dispute.id);
  END LOOP;
  RETURN to_jsonb(v_dispute);
END $$;

CREATE FUNCTION public.add_dispute_evidence(
  p_actor_id uuid,p_dispute_id uuid,p_storage_path text,p_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_dispute public.disputes%rowtype;
  v_order public.orders%rowtype;
  v_provider_user_id uuid;
  v_evidence public.dispute_evidence%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR char_length(coalesce(p_storage_path,'')) NOT BETWEEN 10 AND 1000
     OR p_storage_path NOT LIKE p_dispute_id::text||'/'||p_actor_id::text||'/%'
     OR p_storage_path LIKE '%..%'
     OR p_description IS NOT NULL AND char_length(p_description)>1000 THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
  SELECT * INTO v_dispute FROM public.disputes WHERE id=p_dispute_id FOR UPDATE;
  IF NOT FOUND OR v_dispute.status NOT IN ('open','under_review') THEN RAISE EXCEPTION 'Dispute unavailable'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_dispute.order_id;
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id=v_order.provider_id;
  IF p_actor_id NOT IN (v_order.seeker_id,v_provider_user_id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin) THEN
    RAISE EXCEPTION 'Dispute unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.dispute_evidence(dispute_id,uploaded_by,storage_path,description)
    VALUES(p_dispute_id,p_actor_id,p_storage_path,nullif(btrim(coalesce(p_description,'')),''))
    RETURNING * INTO v_evidence;
  RETURN to_jsonb(v_evidence);
END $$;

CREATE FUNCTION public.review_order_dispute(
  p_actor_id uuid,p_dispute_id uuid,p_action text,p_note text,p_refund_amount numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_dispute public.disputes%rowtype;
  v_order public.orders%rowtype;
  v_provider_user_id uuid;
  v_release numeric;
  v_reserved numeric;
  v_provider_refund numeric;
  v_refund_id uuid;
  v_final_status text;
  v_before jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin)
     OR p_action NOT IN ('under_review','continue_order','refund','closed_no_action')
     OR char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Invalid dispute review'; END IF;
  SELECT * INTO v_dispute FROM public.disputes WHERE id=p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_dispute.order_id FOR UPDATE;
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id=v_order.provider_id FOR UPDATE;
  IF v_dispute.status IN ('resolved','closed') THEN
    IF v_dispute.resolution IS NOT DISTINCT FROM nullif(p_action,'under_review') THEN RETURN to_jsonb(v_dispute); END IF;
    RAISE EXCEPTION 'Dispute already resolved';
  END IF;
  IF p_action='under_review' AND v_dispute.status='under_review' AND v_dispute.assigned_to=p_actor_id THEN
    RETURN to_jsonb(v_dispute);
  END IF;
  v_before:=jsonb_build_object('status',v_dispute.status,'resolution',v_dispute.resolution);
  IF p_action='under_review' THEN
    UPDATE public.disputes SET status='under_review',assigned_to=p_actor_id,updated_at=now() WHERE id=p_dispute_id RETURNING * INTO v_dispute;
    UPDATE public.orders SET dispute_status='under_review' WHERE id=v_order.id;
    v_final_status:='under_review';
  ELSIF p_action='refund' THEN
    IF p_refund_amount IS NULL OR p_refund_amount<1 OR p_refund_amount<>round(p_refund_amount,2)
       OR v_order.tap_charge_id IS NULL THEN RAISE EXCEPTION 'Valid refund amount required'; END IF;
    SELECT coalesce(sum(amount),0) INTO v_reserved FROM public.refund_requests
      WHERE order_id=v_order.id AND status IN ('requested','approved','processing','succeeded','unknown');
    IF p_refund_amount>v_order.amount-greatest(v_reserved,v_order.refunded_amount) THEN RAISE EXCEPTION 'Refund exceeds remaining amount'; END IF;
    v_provider_refund:=round(p_refund_amount*v_order.provider_amount/v_order.amount,2);
    IF v_order.status='completed' AND v_provider_refund>v_dispute.ledger_hold_amount THEN RAISE EXCEPTION 'Dispute reserve is insufficient'; END IF;
    UPDATE public.disputes SET status='resolved',resolution='refund',resolution_note=btrim(p_note),
      assigned_to=p_actor_id,resolved_at=now(),updated_at=now() WHERE id=p_dispute_id;
    v_release:=CASE WHEN v_order.status='completed' THEN v_dispute.ledger_hold_amount-v_provider_refund ELSE v_dispute.ledger_hold_amount END;
    IF v_release>0 THEN
      INSERT INTO public.ledger_entries(provider_id,order_id,entry_type,reference_key,available_delta,reserved_delta,note)
        VALUES(v_order.provider_id,v_order.id,'dispute_release','dispute:'||v_dispute.id||':refund-excess-release',v_release,-v_release,'Excess dispute reserve released');
    END IF;
    INSERT INTO public.refund_requests(
      order_id,requester_id,client_request_id,charge_id,currency,amount,provider_amount,platform_amount,
      ledger_hold_amount,order_status_before,reason,status,reviewed_by,review_note,reviewed_at
    ) VALUES (
      v_order.id,v_order.seeker_id,v_dispute.id,v_order.tap_charge_id,v_order.currency,p_refund_amount,
      v_provider_refund,p_refund_amount-v_provider_refund,
      CASE WHEN v_order.status='completed' THEN v_provider_refund ELSE 0 END,v_order.status,
      left('Dispute resolution: '||btrim(p_note),2000),'approved',p_actor_id,btrim(p_note),now()
    ) RETURNING id INTO v_refund_id;
    UPDATE public.disputes SET resolution_refund_id=v_refund_id WHERE id=p_dispute_id RETURNING * INTO v_dispute;
    PERFORM public.refresh_order_refund_status(v_order.id);
    UPDATE public.orders SET dispute_status='resolved' WHERE id=v_order.id;
    v_final_status:='resolved';
  ELSE
    IF v_dispute.ledger_hold_amount>0 THEN
      INSERT INTO public.ledger_entries(provider_id,order_id,entry_type,reference_key,available_delta,reserved_delta,note)
        VALUES(v_order.provider_id,v_order.id,'dispute_release','dispute:'||v_dispute.id||':release',
          v_dispute.ledger_hold_amount,-v_dispute.ledger_hold_amount,btrim(p_note));
    END IF;
    v_final_status:=CASE WHEN p_action='continue_order' THEN 'resolved' ELSE 'closed' END;
    UPDATE public.disputes SET status=v_final_status,resolution=p_action,resolution_note=btrim(p_note),
      assigned_to=p_actor_id,resolved_at=now(),updated_at=now() WHERE id=p_dispute_id RETURNING * INTO v_dispute;
    UPDATE public.orders SET dispute_status=v_final_status WHERE id=v_order.id;
  END IF;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(p_actor_id,'dispute_review',p_dispute_id,
      v_before,
      jsonb_build_object('status',v_final_status,'resolution',p_action,'note',btrim(p_note),'refund_id',v_refund_id));
  PERFORM public.create_notification(v_order.seeker_id,'dispute:'||v_dispute.id||':action:'||p_action,'dispute',
    'تحديث النزاع','Dispute updated','حالة النزاع: '||v_final_status,'Dispute status: '||v_final_status,
    '/disputes?dispute='||v_dispute.id);
  PERFORM public.create_notification(v_provider_user_id,'dispute:'||v_dispute.id||':action:'||p_action,'dispute',
    'تحديث النزاع','Dispute updated','حالة النزاع: '||v_final_status,'Dispute status: '||v_final_status,
    '/disputes?dispute='||v_dispute.id);
  RETURN to_jsonb(v_dispute);
END $$;

CREATE FUNCTION public.prevent_order_progress_during_dispute() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  v_order_id:=(to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='orders' THEN 'id' ELSE 'order_id' END)::uuid;
  IF EXISTS (SELECT 1 FROM public.disputes WHERE order_id=v_order_id AND status IN ('open','under_review')) THEN
    RAISE EXCEPTION 'Open dispute prevents order progress';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block_delivery_during_dispute BEFORE INSERT ON public.order_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_order_progress_during_dispute();
CREATE TRIGGER block_confirmation_during_dispute BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW WHEN (NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.prevent_order_progress_during_dispute();
REVOKE ALL ON FUNCTION public.prevent_order_progress_during_dispute() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prevent_refund_during_dispute() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.disputes WHERE order_id=NEW.order_id AND status IN ('open','under_review')) THEN
    RAISE EXCEPTION 'Open dispute controls refund resolution';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_dispute_guard BEFORE INSERT ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_refund_during_dispute();
REVOKE ALL ON FUNCTION public.prevent_refund_during_dispute() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prevent_deletion_with_open_dispute() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.disputes dispute
    JOIN public.orders order_record ON order_record.id=dispute.order_id
    JOIN public.providers provider ON provider.id=order_record.provider_id
    WHERE dispute.status IN ('open','under_review')
      AND (order_record.seeker_id=NEW.user_id OR provider.user_id=NEW.user_id)
  ) THEN RAISE EXCEPTION 'Open dispute prevents account deletion'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deletion_dispute_guard BEFORE INSERT ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_deletion_with_open_dispute();
REVOKE ALL ON FUNCTION public.prevent_deletion_with_open_dispute() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_dispute_eligible_orders(p_actor_id uuid)
RETURNS TABLE(id uuid,service_name_ar text,service_name_en text,status text,amount numeric,currency text,dispute_status text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN RAISE EXCEPTION 'Active account required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT order_record.id,order_record.service_name_ar,order_record.service_name_en,
    order_record.status,order_record.amount,order_record.currency,order_record.dispute_status
  FROM public.orders order_record
  WHERE order_record.status IN ('paid','revision_requested','awaiting_confirmation','completed')
    AND order_record.dispute_status NOT IN ('open','under_review')
    AND (order_record.seeker_id=p_actor_id OR EXISTS (
      SELECT 1 FROM public.providers provider WHERE provider.id=order_record.provider_id AND provider.user_id=p_actor_id
    ))
  ORDER BY order_record.created_at DESC,order_record.id;
END $$;

CREATE FUNCTION public.export_user_data_snapshot_v6(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (public.export_user_data_snapshot_v5(p_actor_id) || jsonb_build_object(
    'schema_version',6,
    'disputes',coalesce((
      SELECT jsonb_agg(to_jsonb(dispute) ORDER BY dispute.created_at,dispute.id)
      FROM public.disputes dispute
      JOIN public.orders order_record ON order_record.id=dispute.order_id
      WHERE order_record.seeker_id=p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider WHERE provider.id=order_record.provider_id AND provider.user_id=p_actor_id
      )
    ),'[]'::jsonb),
    'dispute_evidence',coalesce((
      SELECT jsonb_agg(to_jsonb(evidence) ORDER BY evidence.created_at,evidence.id)
      FROM public.dispute_evidence evidence
      JOIN public.disputes dispute ON dispute.id=evidence.dispute_id
      JOIN public.orders order_record ON order_record.id=dispute.order_id
      WHERE order_record.seeker_id=p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider WHERE provider.id=order_record.provider_id AND provider.user_id=p_actor_id
      )
    ),'[]'::jsonb),
    'admin_actions_targeting_disputes',coalesce((
      SELECT jsonb_agg(to_jsonb(log) ORDER BY log.created_at,log.id)
      FROM public.admin_audit_log log
      JOIN public.disputes dispute ON dispute.id=log.target_id
      JOIN public.orders order_record ON order_record.id=dispute.order_id
      WHERE order_record.seeker_id=p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider WHERE provider.id=order_record.provider_id AND provider.user_id=p_actor_id
      )
    ),'[]'::jsonb)
  ));
$$;

REVOKE ALL ON FUNCTION public.create_order_dispute(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.add_dispute_evidence(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_order_dispute(uuid,uuid,text,text,numeric) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_dispute_eligible_orders(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.export_user_data_snapshot_v6(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_dispute(uuid,uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_dispute_evidence(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_order_dispute(uuid,uuid,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dispute_eligible_orders(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.export_user_data_snapshot_v6(uuid) TO service_role;

COMMIT;
