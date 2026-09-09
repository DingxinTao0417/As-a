BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN location text,
  ADD COLUMN bio text;

UPDATE public.profiles profile
SET location = nullif(btrim(auth_user.raw_user_meta_data->>'location'),''),
    bio = nullif(btrim(auth_user.raw_user_meta_data->>'bio'),'')
FROM auth.users auth_user
WHERE auth_user.id = profile.id
  AND (auth_user.raw_user_meta_data ? 'location' OR auth_user.raw_user_meta_data ? 'bio');

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_length CHECK (char_length(full_name) <= 200),
  ADD CONSTRAINT profiles_phone_length CHECK (phone IS NULL OR char_length(phone) <= 50),
  ADD CONSTRAINT profiles_location_length CHECK (location IS NULL OR char_length(location) <= 200),
  ADD CONSTRAINT profiles_bio_length CHECK (bio IS NULL OR char_length(bio) <= 5000);

CREATE FUNCTION public.update_own_profile(
  p_actor_id uuid,
  p_full_name text,
  p_phone text,
  p_location text,
  p_bio text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_profile public.profiles%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR char_length(btrim(coalesce(p_full_name,''))) NOT BETWEEN 1 AND 200
     OR char_length(btrim(coalesce(p_phone,''))) > 50
     OR char_length(btrim(coalesce(p_location,''))) > 200
     OR char_length(btrim(coalesce(p_bio,''))) > 5000 THEN
    RAISE EXCEPTION 'Invalid profile details';
  END IF;

  UPDATE public.profiles
  SET full_name = btrim(p_full_name),
      phone = nullif(btrim(coalesce(p_phone,'')),''),
      location = nullif(btrim(coalesce(p_location,'')),''),
      bio = nullif(btrim(coalesce(p_bio,'')),''),
      updated_at = now()
  WHERE id = p_actor_id
  RETURNING * INTO v_profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active account required' USING ERRCODE='42501'; END IF;

  RETURN jsonb_build_object(
    'id',v_profile.id,
    'email',v_profile.email,
    'full_name',v_profile.full_name,
    'phone',v_profile.phone,
    'location',v_profile.location,
    'bio',v_profile.bio,
    'avatar_url',v_profile.avatar_url,
    'role',v_profile.role,
    'created_at',v_profile.created_at,
    'updated_at',v_profile.updated_at
  );
END $$;

REVOKE ALL ON FUNCTION public.update_own_profile(uuid,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(uuid,text,text,text,text)
  TO service_role;

COMMIT;
