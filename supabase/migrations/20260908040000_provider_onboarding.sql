BEGIN;

CREATE FUNCTION public.register_provider_profile(
  p_actor_id uuid,
  p_name_ar text,
  p_name_en text,
  p_title_ar text,
  p_title_en text,
  p_bio_ar text,
  p_bio_en text,
  p_starting_price numeric,
  p_skills text[],
  p_categories text[],
  p_avatar_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider_id uuid;
BEGIN
  PERFORM id FROM public.profiles
    WHERE id = p_actor_id
      AND role = 'provider'
      AND deletion_requested_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider account required' USING ERRCODE = '42501'; END IF;

  IF char_length(btrim(coalesce(p_name_ar,''))) NOT BETWEEN 1 AND 100
     OR char_length(btrim(coalesce(p_name_en,''))) NOT BETWEEN 1 AND 100
     OR char_length(btrim(coalesce(p_title_ar,''))) NOT BETWEEN 1 AND 160
     OR char_length(btrim(coalesce(p_title_en,''))) NOT BETWEEN 1 AND 160
     OR char_length(coalesce(p_bio_ar,'')) > 5000
     OR char_length(coalesce(p_bio_en,'')) > 5000
     OR p_starting_price IS NULL
     OR p_starting_price::text IN ('NaN','Infinity','-Infinity')
     OR p_starting_price < 0
     OR p_starting_price > 10000
     OR p_starting_price <> round(p_starting_price,2)
     OR cardinality(p_skills) NOT BETWEEN 1 AND 30
     OR cardinality(p_categories) NOT BETWEEN 1 AND 10
     OR EXISTS (SELECT 1 FROM unnest(p_skills) value WHERE char_length(btrim(value)) NOT BETWEEN 1 AND 80)
     OR EXISTS (SELECT 1 FROM unnest(p_categories) value WHERE char_length(btrim(value)) NOT BETWEEN 1 AND 80)
     OR char_length(coalesce(p_avatar_url,'')) > 2048 THEN
    RAISE EXCEPTION 'Invalid provider profile';
  END IF;

  INSERT INTO public.providers(
    user_id,name_ar,name_en,title_ar,title_en,bio_ar,bio_en,avatar_url,
    display_name,title,bio,category,hourly_rate,starting_price,skills,categories
  ) VALUES (
    p_actor_id,btrim(p_name_ar),btrim(p_name_en),btrim(p_title_ar),btrim(p_title_en),
    nullif(btrim(coalesce(p_bio_ar,'')),''),nullif(btrim(coalesce(p_bio_en,'')),''),
    nullif(btrim(coalesce(p_avatar_url,'')),''),btrim(p_name_en),btrim(p_title_en),
    nullif(btrim(coalesce(p_bio_en,'')),''),btrim(p_categories[1]),
    p_starting_price,p_starting_price,
    ARRAY(SELECT DISTINCT btrim(value) FROM unnest(p_skills) value),
    ARRAY(SELECT DISTINCT btrim(value) FROM unnest(p_categories) value)
  )
  ON CONFLICT(user_id) DO UPDATE SET
    name_ar = EXCLUDED.name_ar,
    name_en = EXCLUDED.name_en,
    title_ar = EXCLUDED.title_ar,
    title_en = EXCLUDED.title_en,
    bio_ar = EXCLUDED.bio_ar,
    bio_en = EXCLUDED.bio_en,
    avatar_url = EXCLUDED.avatar_url,
    display_name = EXCLUDED.display_name,
    title = EXCLUDED.title,
    bio = EXCLUDED.bio,
    category = EXCLUDED.category,
    hourly_rate = EXCLUDED.hourly_rate,
    starting_price = EXCLUDED.starting_price,
    skills = EXCLUDED.skills,
    categories = EXCLUDED.categories,
    updated_at = now()
  RETURNING id INTO v_provider_id;

  RETURN v_provider_id;
END $$;

REVOKE ALL ON FUNCTION public.register_provider_profile(
  uuid,text,text,text,text,text,text,numeric,text[],text[],text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_provider_profile(
  uuid,text,text,text,text,text,text,numeric,text[],text[],text
) TO service_role;

COMMIT;
