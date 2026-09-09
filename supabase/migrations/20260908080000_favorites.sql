BEGIN;

CREATE FUNCTION public.set_provider_favorite(
  p_actor_id uuid,
  p_provider_id uuid,
  p_favorite boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider_user_id uuid;
BEGIN
  PERFORM id FROM public.profiles
    WHERE id = p_actor_id AND deletion_requested_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501'; END IF;

  IF p_favorite THEN
    SELECT user_id INTO v_provider_user_id FROM public.providers
      WHERE id = p_provider_id AND is_active;
    IF NOT FOUND OR v_provider_user_id = p_actor_id OR NOT public.is_account_active(v_provider_user_id) THEN
      RAISE EXCEPTION 'Provider unavailable' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.favorites(user_id,provider_id)
      VALUES(p_actor_id,p_provider_id)
      ON CONFLICT(user_id,provider_id) DO NOTHING;
  ELSE
    DELETE FROM public.favorites
      WHERE user_id = p_actor_id AND provider_id = p_provider_id;
  END IF;
  RETURN p_favorite;
END $$;

REVOKE ALL ON FUNCTION public.set_provider_favorite(uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_provider_favorite(uuid,uuid,boolean)
  TO service_role;

COMMIT;
