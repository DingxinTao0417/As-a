BEGIN;

ALTER TABLE public.services
  ADD COLUMN moderation_status text NOT NULL DEFAULT 'draft'
    CHECK (moderation_status IN ('draft','pending_review','approved','rejected','suspended')),
  ADD COLUMN moderation_note text CHECK (char_length(moderation_note) <= 1000),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN provider_publish_intent boolean NOT NULL DEFAULT false;

ALTER TABLE public.services
  ADD CONSTRAINT services_publication_state_check
  CHECK (is_active = (moderation_status = 'approved' AND provider_publish_intent));

CREATE FUNCTION public.sync_client_service_moderation()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin') OR (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND
     (to_jsonb(NEW) - ARRAY[
       'is_active','moderation_status','moderation_note','submitted_at','reviewed_at',
       'reviewed_by','provider_publish_intent','updated_at'
     ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
       'is_active','moderation_status','moderation_note','submitted_at','reviewed_at',
       'reviewed_by','provider_publish_intent','updated_at'
     ]) THEN
    NEW.is_active := false;
    NEW.moderation_status := 'draft';
    NEW.moderation_note := NULL;
    NEW.submitted_at := NULL;
    NEW.reviewed_at := NULL;
    NEW.reviewed_by := NULL;
    NEW.provider_publish_intent := false;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.sync_client_service_moderation()
  FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_service_moderation
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.sync_client_service_moderation();

CREATE OR REPLACE FUNCTION public.create_service_draft(
  p_actor_id uuid,
  p_name_ar text,
  p_name_en text,
  p_description_ar text,
  p_description_en text,
  p_category text,
  p_price numeric,
  p_price_type text,
  p_delivery_time text,
  p_features text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider_id uuid;
  v_service_id uuid;
BEGIN
  SELECT id INTO v_provider_id FROM public.providers
    WHERE user_id = p_actor_id AND is_active
    FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active provider required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.service_payload_is_valid(
    p_name_ar,p_name_en,p_description_ar,p_description_en,p_category,p_price,
    p_price_type,p_delivery_time,p_features,'{}'::text[]
  ) THEN RAISE EXCEPTION 'Invalid service details'; END IF;

  INSERT INTO public.services(
    provider_id,name_ar,name_en,description_ar,description_en,category,
    price,price_type,delivery_time,features,image_urls,is_active,
    moderation_status,provider_publish_intent
  ) VALUES (
    v_provider_id,btrim(p_name_ar),btrim(p_name_en),
    nullif(btrim(coalesce(p_description_ar,'')),''),
    nullif(btrim(coalesce(p_description_en,'')),''),
    p_category,p_price,p_price_type,
    nullif(btrim(coalesce(p_delivery_time,'')),''),
    ARRAY(SELECT DISTINCT btrim(value) FROM unnest(p_features) value),
    '{}',false,'draft',false
  ) RETURNING id INTO v_service_id;
  RETURN v_service_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_service_draft(
  p_actor_id uuid,
  p_service_id uuid,
  p_name_ar text,
  p_name_en text,
  p_description_ar text,
  p_description_en text,
  p_category text,
  p_price numeric,
  p_price_type text,
  p_delivery_time text,
  p_features text[],
  p_image_urls text[]
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM s.id FROM public.services s
    JOIN public.providers p ON p.id = s.provider_id
    WHERE s.id = p_service_id AND p.user_id = p_actor_id AND p.is_active
    FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.service_payload_is_valid(
    p_name_ar,p_name_en,p_description_ar,p_description_en,p_category,p_price,
    p_price_type,p_delivery_time,p_features,p_image_urls
  ) THEN RAISE EXCEPTION 'Invalid service details'; END IF;

  UPDATE public.services SET
    name_ar = btrim(p_name_ar),
    name_en = btrim(p_name_en),
    description_ar = nullif(btrim(coalesce(p_description_ar,'')),''),
    description_en = nullif(btrim(coalesce(p_description_en,'')),''),
    category = p_category,
    price = p_price,
    price_type = p_price_type,
    delivery_time = nullif(btrim(coalesce(p_delivery_time,'')),''),
    features = ARRAY(SELECT DISTINCT btrim(value) FROM unnest(p_features) value),
    image_urls = ARRAY(SELECT DISTINCT btrim(value) FROM unnest(p_image_urls) value),
    is_active = false,
    moderation_status = 'draft',
    moderation_note = NULL,
    submitted_at = NULL,
    reviewed_at = NULL,
    reviewed_by = NULL,
    provider_publish_intent = false,
    updated_at = now()
  WHERE id = p_service_id;
END $$;

CREATE FUNCTION public.submit_service_for_review(p_actor_id uuid,p_service_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM s.id FROM public.services s
    JOIN public.providers p ON p.id = s.provider_id
    WHERE s.id = p_service_id
      AND p.user_id = p_actor_id
      AND p.is_active
      AND cardinality(s.image_urls) > 0
      AND s.moderation_status IN ('draft','rejected')
    FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Review submission requirements not met';
  END IF;
  UPDATE public.services SET
    moderation_status = 'pending_review',
    moderation_note = NULL,
    submitted_at = now(),
    reviewed_at = NULL,
    reviewed_by = NULL,
    provider_publish_intent = true,
    is_active = false,
    updated_at = now()
  WHERE id = p_service_id;
END $$;

CREATE FUNCTION public.set_service_publish_intent(p_actor_id uuid,p_service_id uuid,p_publish boolean)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM s.id FROM public.services s
    JOIN public.providers p ON p.id = s.provider_id
    WHERE s.id = p_service_id
      AND p.user_id = p_actor_id
      AND p.is_active
      AND s.moderation_status = 'approved'
    FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Approved service not found';
  END IF;
  UPDATE public.services SET
    provider_publish_intent = p_publish,
    is_active = p_publish,
    updated_at = now()
  WHERE id = p_service_id;
END $$;

CREATE FUNCTION public.review_service(
  p_actor_id uuid,
  p_service_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  prior jsonb;
  updated jsonb;
BEGIN
  PERFORM id FROM public.profiles WHERE is_admin OR id = p_actor_id ORDER BY id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_actor_id AND is_admin AND deletion_requested_at IS NULL
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_decision NOT IN ('approved','rejected','suspended')
     OR (p_decision = 'rejected' AND char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 1000)
     OR char_length(coalesce(p_note,'')) > 1000 THEN
    RAISE EXCEPTION 'Invalid review decision';
  END IF;

  SELECT jsonb_build_object(
    'moderation_status',moderation_status,
    'is_active',is_active,
    'moderation_note',moderation_note
  ) INTO prior FROM public.services WHERE id = p_service_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service not found'; END IF;
  IF p_decision = 'approved' AND NOT EXISTS (
    SELECT 1 FROM public.services s
    JOIN public.providers p ON p.id = s.provider_id
    WHERE s.id = p_service_id
      AND p.is_active
      AND public.is_account_active(p.user_id)
      AND cardinality(s.image_urls) > 0
      AND s.moderation_status IN ('pending_review','suspended')
  ) THEN RAISE EXCEPTION 'Pending service with an active provider and image required'; END IF;

  UPDATE public.services SET
    moderation_status = p_decision,
    moderation_note = nullif(btrim(coalesce(p_note,'')),''),
    reviewed_at = now(),
    reviewed_by = p_actor_id,
    provider_publish_intent = (p_decision = 'approved'),
    is_active = (p_decision = 'approved'),
    updated_at = now()
  WHERE id = p_service_id;
  updated := jsonb_build_object(
    'moderation_status',p_decision,
    'is_active',(p_decision = 'approved'),
    'moderation_note',nullif(btrim(coalesce(p_note,'')),'')
  );
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(p_actor_id,'set_service_active',p_service_id,prior,updated);
END $$;

REVOKE ALL ON FUNCTION public.submit_service_for_review(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_service_publish_intent(uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_service(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_service_for_review(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_service_publish_intent(uuid,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_service(uuid,uuid,text,text) TO service_role;

COMMIT;
