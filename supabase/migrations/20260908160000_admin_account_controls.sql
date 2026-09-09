BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspension_reason text CHECK (
    suspension_reason IS NULL OR char_length(suspension_reason) BETWEEN 3 AND 1000
  ),
  ADD COLUMN suspended_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD CONSTRAINT active_admin_not_suspended CHECK (NOT is_admin OR suspended_at IS NULL),
  ADD CONSTRAINT profile_suspension_consistency CHECK (
    (suspended_at IS NULL AND suspension_reason IS NULL AND suspended_by IS NULL)
    OR (suspended_at IS NOT NULL AND suspension_reason IS NOT NULL AND suspended_by IS NOT NULL)
  );

ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN (
    'set_admin','verify_provider','set_service_active','review_withdrawal',
    'review_service','suspend_user','restore_user'
  ));

CREATE OR REPLACE FUNCTION public.is_account_active(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      AND deletion_requested_at IS NULL
      AND suspended_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_account_active((SELECT auth.uid())) AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_admin
  );
$$;

CREATE OR REPLACE VIEW public.public_profiles WITH (security_barrier = true) AS
  SELECT id,full_name,avatar_url
  FROM public.profiles
  WHERE deletion_requested_at IS NULL AND suspended_at IS NULL;

CREATE FUNCTION public.guard_account_control_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin') OR (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.suspended_at IS NOT NULL OR NEW.suspension_reason IS NOT NULL OR NEW.suspended_by IS NOT NULL THEN
      RAISE EXCEPTION 'Protected account status fields' USING ERRCODE = '42501';
    END IF;
  ELSIF (NEW.suspended_at,NEW.suspension_reason,NEW.suspended_by)
        IS DISTINCT FROM (OLD.suspended_at,OLD.suspension_reason,OLD.suspended_by) THEN
    RAISE EXCEPTION 'Protected account status fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_account_control_columns
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_account_control_columns();
REVOKE ALL ON FUNCTION public.guard_account_control_columns()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.set_account_suspension(
  p_actor_id uuid,
  p_target_id uuid,
  p_suspended boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_target public.profiles%rowtype;
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM id FROM public.profiles
    WHERE is_admin OR id = p_target_id
    ORDER BY id FOR UPDATE;
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles admin_profile
       WHERE admin_profile.id = p_actor_id AND admin_profile.is_admin
     ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_target_id = p_actor_id THEN RAISE EXCEPTION 'Cannot suspend your own account'; END IF;
  IF p_suspended IS NULL OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Account status reason is required';
  END IF;

  SELECT * INTO v_target FROM public.profiles
    WHERE id = p_target_id AND deletion_requested_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active account not found'; END IF;
  IF (v_target.suspended_at IS NOT NULL) = p_suspended THEN
    RETURN jsonb_build_object(
      'suspended_at',v_target.suspended_at,
      'suspension_reason',v_target.suspension_reason
    );
  END IF;

  v_before := jsonb_build_object(
    'suspended_at',v_target.suspended_at,
    'suspension_reason',v_target.suspension_reason
  );
  IF p_suspended THEN
    UPDATE public.profiles
      SET suspended_at = now(),suspension_reason = btrim(p_reason),
          suspended_by = p_actor_id,updated_at = now()
      WHERE id = p_target_id
      RETURNING jsonb_build_object(
        'suspended_at',suspended_at,
        'suspension_reason',suspension_reason
      ) INTO v_after;
  ELSE
    UPDATE public.profiles
      SET suspended_at = NULL,suspension_reason = NULL,
          suspended_by = NULL,updated_at = now()
      WHERE id = p_target_id
      RETURNING jsonb_build_object(
        'suspended_at',suspended_at,
        'suspension_reason',suspension_reason,
        'restoration_reason',btrim(p_reason)
      ) INTO v_after;
  END IF;

  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(
      p_actor_id,
      CASE WHEN p_suspended THEN 'suspend_user' ELSE 'restore_user' END,
      p_target_id,v_before,v_after
    );
  RETURN v_after;
END $$;

CREATE FUNCTION public.get_admin_audit_page(
  p_actor_id uuid,
  p_query text,
  p_offset integer,
  p_limit integer
) RETURNS TABLE(
  id uuid,
  actor_id uuid,
  actor_email text,
  action text,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles admin_profile
       WHERE admin_profile.id = p_actor_id AND admin_profile.is_admin
     ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_offset < 0 OR p_limit NOT BETWEEN 1 AND 100
     OR char_length(coalesce(p_query,'')) > 100 THEN
    RAISE EXCEPTION 'Invalid audit query';
  END IF;

  RETURN QUERY
  SELECT
    log.id,log.actor_id,profile.email,log.action,log.target_id,
    log.before_data,log.after_data,log.created_at,count(*) OVER()
  FROM public.admin_audit_log log
  JOIN public.profiles profile ON profile.id = log.actor_id
  WHERE nullif(btrim(coalesce(p_query,'')),'') IS NULL
     OR log.action ILIKE '%' || btrim(p_query) || '%'
     OR log.target_id::text ILIKE '%' || btrim(p_query) || '%'
     OR coalesce(profile.email,'') ILIKE '%' || btrim(p_query) || '%'
  ORDER BY log.created_at DESC,log.id DESC
  OFFSET p_offset LIMIT p_limit;
END $$;

CREATE OR REPLACE FUNCTION public.search_service_catalog(
  p_query text,
  p_category text,
  p_sort text,
  p_offset integer,
  p_limit integer
) RETURNS TABLE(
  id uuid,name_ar text,name_en text,description_ar text,description_en text,
  category text,price numeric,price_type text,delivery_time text,features text[],
  image_urls text[],provider_id uuid,provider_name_ar text,provider_name_en text,
  provider_avatar_url text,provider_rating numeric,provider_reviews_count integer,
  provider_is_verified boolean,created_at timestamptz,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_sort NOT IN ('newest','rating','price-low','price-high')
     OR p_offset < 0 OR p_limit NOT BETWEEN 1 AND 50
     OR char_length(coalesce(p_query,'')) > 100
     OR (p_category IS NOT NULL AND p_category NOT IN ('development','design','marketing','writing','video','music','business','consulting')) THEN
    RAISE EXCEPTION 'Invalid catalog query';
  END IF;

  RETURN QUERY
  SELECT
    s.id,s.name_ar,s.name_en,s.description_ar,s.description_en,s.category,
    s.price,s.price_type,s.delivery_time,s.features,s.image_urls,s.provider_id,
    p.name_ar,p.name_en,p.avatar_url,p.rating,p.reviews_count,p.is_verified,
    s.created_at,count(*) OVER()
  FROM public.services s
  JOIN public.providers p ON p.id = s.provider_id
  WHERE s.is_active
    AND s.moderation_status = 'approved'
    AND s.provider_publish_intent
    AND p.is_active
    AND public.is_account_active(p.user_id)
    AND (p_category IS NULL OR s.category = p_category)
    AND (
      nullif(btrim(coalesce(p_query,'')),'') IS NULL
      OR s.name_ar ILIKE '%' || btrim(p_query) || '%'
      OR s.name_en ILIKE '%' || btrim(p_query) || '%'
      OR coalesce(s.description_ar,'') ILIKE '%' || btrim(p_query) || '%'
      OR coalesce(s.description_en,'') ILIKE '%' || btrim(p_query) || '%'
    )
  ORDER BY
    CASE WHEN p_sort = 'rating' THEN p.rating END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-low' THEN s.price END ASC,
    CASE WHEN p_sort = 'price-high' THEN s.price END DESC,
    CASE WHEN p_sort = 'newest' THEN s.created_at END DESC,
    s.created_at DESC,s.id ASC
  OFFSET p_offset LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.set_account_suspension(uuid,uuid,boolean,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_admin_audit_page(uuid,text,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_account_suspension(uuid,uuid,boolean,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_audit_page(uuid,text,integer,integer)
  TO service_role;

COMMIT;
