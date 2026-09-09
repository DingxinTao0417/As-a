BEGIN;

CREATE FUNCTION public.get_public_provider_detail(p_provider_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_provider public.providers%rowtype;
BEGIN
  SELECT provider.* INTO v_provider FROM public.providers provider
  WHERE provider.id=p_provider_id AND provider.is_active
    AND public.is_account_active(provider.user_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id',v_provider.id,'name_ar',v_provider.name_ar,'name_en',v_provider.name_en,
    'title_ar',v_provider.title_ar,'title_en',v_provider.title_en,
    'bio_ar',v_provider.bio_ar,'bio_en',v_provider.bio_en,'avatar_url',v_provider.avatar_url,
    'rating',v_provider.rating,'reviews_count',v_provider.reviews_count,
    'completed_projects',v_provider.completed_projects,'skills',v_provider.skills,
    'categories',v_provider.categories,'is_verified',v_provider.is_verified
  );
END $$;

REVOKE ALL ON FUNCTION public.get_public_provider_detail(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_provider_detail(uuid) TO service_role;

COMMIT;
