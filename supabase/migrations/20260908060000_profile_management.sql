BEGIN;

CREATE FUNCTION public.update_profile_avatar(p_actor_id uuid,p_avatar_url text)
RETURNS text[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_profile_avatar text;
  v_provider_avatar text;
BEGIN
  IF p_avatar_url IS NULL OR char_length(btrim(p_avatar_url)) NOT BETWEEN 1 AND 2048 THEN
    RAISE EXCEPTION 'Invalid avatar URL';
  END IF;
  SELECT avatar_url INTO v_profile_avatar FROM public.profiles
    WHERE id = p_actor_id AND deletion_requested_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501'; END IF;
  SELECT avatar_url INTO v_provider_avatar FROM public.providers
    WHERE user_id = p_actor_id FOR UPDATE;

  UPDATE public.profiles
    SET avatar_url = btrim(p_avatar_url),updated_at = now()
    WHERE id = p_actor_id;
  UPDATE public.providers
    SET avatar_url = btrim(p_avatar_url),updated_at = now()
    WHERE user_id = p_actor_id;

  RETURN ARRAY(
    SELECT DISTINCT old_url
    FROM unnest(ARRAY[v_profile_avatar,v_provider_avatar]) AS old_urls(old_url)
    WHERE old_url IS NOT NULL AND old_url <> btrim(p_avatar_url)
  );
END $$;

REVOKE ALL ON FUNCTION public.update_profile_avatar(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_profile_avatar(uuid,text)
  TO service_role;

COMMIT;
