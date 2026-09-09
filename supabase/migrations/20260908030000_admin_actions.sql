BEGIN;

CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('set_admin','verify_provider','set_service_active','review_withdrawal')),
  target_id uuid NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_created_idx ON public.admin_audit_log(created_at DESC);
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT SELECT,INSERT ON public.admin_audit_log TO service_role;

CREATE POLICY audit_admin_read ON public.admin_audit_log
  FOR SELECT TO authenticated USING (public.is_app_admin());

CREATE FUNCTION public.apply_admin_action(
  p_actor_id uuid,
  p_action text,
  p_target_id uuid,
  p_value text,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  prior jsonb;
  updated jsonb;
BEGIN
  PERFORM id FROM public.profiles
    WHERE is_admin OR id IN (p_actor_id,p_target_id)
    ORDER BY id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_actor_id AND is_admin AND deletion_requested_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'set_admin' THEN
    IF p_actor_id = p_target_id OR p_value IS NULL OR p_value NOT IN ('true','false') THEN
      RAISE EXCEPTION 'Invalid administrator change';
    END IF;
    SELECT jsonb_build_object('is_admin',is_admin)
      INTO prior FROM public.profiles
      WHERE id = p_target_id AND deletion_requested_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active user not found'; END IF;
    UPDATE public.profiles SET is_admin = p_value::boolean WHERE id = p_target_id;
    updated := jsonb_build_object('is_admin',p_value::boolean);

  ELSIF p_action = 'verify_provider' THEN
    IF p_value IS NULL OR p_value NOT IN ('true','false') THEN
      RAISE EXCEPTION 'Invalid verification value';
    END IF;
    SELECT jsonb_build_object('is_verified',is_verified)
      INTO prior FROM public.providers WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Provider not found'; END IF;
    UPDATE public.providers SET is_verified = p_value::boolean WHERE id = p_target_id;
    updated := jsonb_build_object('is_verified',p_value::boolean);

  ELSIF p_action = 'set_service_active' THEN
    IF p_value IS NULL OR p_value NOT IN ('true','false') THEN
      RAISE EXCEPTION 'Invalid service status';
    END IF;
    SELECT jsonb_build_object('is_active',is_active)
      INTO prior FROM public.services WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service not found'; END IF;
    IF p_value = 'true' AND NOT EXISTS (
      SELECT 1 FROM public.services s
      JOIN public.providers p ON p.id = s.provider_id
      WHERE s.id = p_target_id
        AND p.is_active
        AND public.is_account_active(p.user_id)
        AND cardinality(s.image_urls) > 0
    ) THEN
      RAISE EXCEPTION 'Active provider and at least one service image required';
    END IF;
    UPDATE public.services SET is_active = p_value::boolean WHERE id = p_target_id;
    updated := jsonb_build_object('is_active',p_value::boolean);

  ELSIF p_action = 'review_withdrawal' THEN
    IF p_value IS NULL OR p_value NOT IN ('approved','rejected') THEN
      RAISE EXCEPTION 'Invalid withdrawal decision';
    END IF;
    IF p_value = 'rejected' AND (p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 3 AND 1000) THEN
      RAISE EXCEPTION 'Rejection reason required';
    END IF;
    IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
      RAISE EXCEPTION 'Withdrawal note is too long';
    END IF;
    SELECT jsonb_build_object('status',status,'notes',notes)
      INTO prior FROM public.withdrawal_requests
      WHERE id = p_target_id AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal already processed or not found'; END IF;
    UPDATE public.withdrawal_requests
      SET status = p_value,
          notes = nullif(btrim(coalesce(p_note,'')),''),
          processed_at = now()
      WHERE id = p_target_id;
    updated := jsonb_build_object(
      'status',p_value,
      'notes',nullif(btrim(coalesce(p_note,'')),'')
    );
  ELSE
    RAISE EXCEPTION 'Unsupported administrator action';
  END IF;

  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(p_actor_id,p_action,p_target_id,prior,updated);
END $$;

REVOKE ALL ON FUNCTION public.apply_admin_action(uuid,text,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_admin_action(uuid,text,uuid,text,text)
  TO service_role;

COMMIT;
