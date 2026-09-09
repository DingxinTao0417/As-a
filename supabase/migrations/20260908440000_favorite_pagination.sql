BEGIN;

CREATE FUNCTION public.get_favorite_provider_page(
  p_actor_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid favorite page' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_total FROM public.favorites favorite WHERE favorite.user_id=p_actor_id;
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT favorite.id,favorite.provider_id,favorite.created_at,
      jsonb_build_object(
        'name_ar',provider.name_ar,'name_en',provider.name_en,
        'title_ar',provider.title_ar,'title_en',provider.title_en,
        'avatar_url',provider.avatar_url,'rating',provider.rating,
        'starting_price',provider.starting_price,'is_verified',provider.is_verified,
        'is_available',(provider.is_active AND public.is_account_active(provider.user_id))
      ) AS provider
    FROM public.favorites favorite
    JOIN public.providers provider ON provider.id=favorite.provider_id
    WHERE favorite.user_id=p_actor_id
      AND (
        p_before_created_at IS NULL
        OR favorite.created_at<p_before_created_at
        OR (favorite.created_at=p_before_created_at AND favorite.id<p_before_id)
      )
    ORDER BY favorite.created_at DESC,favorite.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('favorites',v_rows,'total',v_total);
END $$;

REVOKE ALL ON FUNCTION public.get_favorite_provider_page(uuid,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_favorite_provider_page(uuid,timestamptz,uuid,integer)
TO service_role;

COMMIT;
