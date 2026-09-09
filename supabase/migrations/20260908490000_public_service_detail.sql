BEGIN;

CREATE FUNCTION public.get_public_service_detail(p_service_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_service public.services%rowtype;v_provider public.providers%rowtype;v_related jsonb;
BEGIN
  SELECT service_record.* INTO v_service
  FROM public.services service_record
  JOIN public.providers provider ON provider.id=service_record.provider_id
  WHERE service_record.id=p_service_id
    AND service_record.is_active
    AND service_record.moderation_status='approved'
    AND service_record.provider_publish_intent
    AND provider.is_active
    AND public.is_account_active(provider.user_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_provider FROM public.providers WHERE id=v_service.provider_id;
  SELECT coalesce(jsonb_agg(to_jsonb(related_row) ORDER BY related_row.created_at DESC,related_row.id DESC),'[]'::jsonb)
  INTO v_related
  FROM(
    SELECT related.id,related.name_ar,related.name_en,related.category,related.price,
      related.price_type,related.provider_id,related.created_at,
      jsonb_build_object(
        'name_ar',provider.name_ar,'name_en',provider.name_en,'avatar_url',provider.avatar_url,
        'rating',provider.rating
      ) AS providers
    FROM public.services related
    JOIN public.providers provider ON provider.id=related.provider_id
    WHERE related.id<>v_service.id
      AND related.category=v_service.category
      AND related.is_active
      AND related.moderation_status='approved'
      AND related.provider_publish_intent
      AND provider.is_active
      AND public.is_account_active(provider.user_id)
    ORDER BY related.created_at DESC,related.id DESC LIMIT 4
  ) related_row;
  RETURN jsonb_build_object(
    'service',jsonb_build_object(
      'id',v_service.id,'name_ar',v_service.name_ar,'name_en',v_service.name_en,
      'description_ar',v_service.description_ar,'description_en',v_service.description_en,
      'category',v_service.category,'price',v_service.price,'price_type',v_service.price_type,
      'delivery_time',v_service.delivery_time,'features',v_service.features,
      'image_urls',v_service.image_urls,'is_active',true,'provider_id',v_service.provider_id,
      'created_at',v_service.created_at,'providers',jsonb_build_object(
      'id',v_provider.id,'name_ar',v_provider.name_ar,'name_en',v_provider.name_en,
      'title_ar',v_provider.title_ar,'title_en',v_provider.title_en,'avatar_url',v_provider.avatar_url,
      'rating',v_provider.rating,'reviews_count',v_provider.reviews_count,
      'completed_projects',v_provider.completed_projects,'is_verified',v_provider.is_verified,
      'bio_ar',v_provider.bio_ar,'bio_en',v_provider.bio_en,'response_time',v_provider.response_time
    )),
    'related_services',v_related
  );
END $$;

REVOKE ALL ON FUNCTION public.get_public_service_detail(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_service_detail(uuid) TO service_role;

COMMIT;
