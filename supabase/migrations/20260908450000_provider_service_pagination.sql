BEGIN;

CREATE FUNCTION public.get_provider_service_page(
  p_actor_id uuid,p_provider_id uuid,p_query text,p_sort text,p_direction text,p_language text,
  p_cursor_created_at timestamptz,p_cursor_price numeric,p_cursor_name text,p_cursor_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(
      SELECT 1 FROM public.providers provider WHERE provider.id=p_provider_id AND provider.user_id=p_actor_id
    )
    OR char_length(coalesce(p_query,''))>100
    OR p_sort NOT IN ('created_at','price','name')
    OR p_direction NOT IN ('asc','desc')
    OR p_language NOT IN ('ar','en')
    OR p_limit NOT BETWEEN 1 AND 100
    OR (
      (p_cursor_id IS NULL AND (p_cursor_created_at IS NOT NULL OR p_cursor_price IS NOT NULL OR p_cursor_name IS NOT NULL))
      OR (p_cursor_id IS NOT NULL AND (
        (p_sort='created_at' AND (p_cursor_created_at IS NULL OR p_cursor_price IS NOT NULL OR p_cursor_name IS NOT NULL))
        OR (p_sort='price' AND (p_cursor_created_at IS NOT NULL OR p_cursor_price IS NULL OR p_cursor_name IS NOT NULL))
        OR (p_sort='name' AND (p_cursor_created_at IS NOT NULL OR p_cursor_price IS NOT NULL OR p_cursor_name IS NULL))
      ))
    ) THEN RAISE EXCEPTION 'Invalid provider service query' USING ERRCODE='42501'; END IF;

  SELECT count(*) INTO v_total FROM public.services service_record
  WHERE service_record.provider_id=p_provider_id
    AND (
      nullif(btrim(coalesce(p_query,'')),'') IS NULL
      OR service_record.name_ar ILIKE '%'||btrim(p_query)||'%'
      OR service_record.name_en ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(service_record.description_ar,'') ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(service_record.description_en,'') ILIKE '%'||btrim(p_query)||'%'
      OR service_record.category ILIKE '%'||btrim(p_query)||'%'
    );

  SELECT coalesce(jsonb_agg(to_jsonb(page_row)
    ORDER BY
      CASE WHEN p_sort='created_at' AND p_direction='asc' THEN page_row.created_at END ASC,
      CASE WHEN p_sort='created_at' AND p_direction='desc' THEN page_row.created_at END DESC,
      CASE WHEN p_sort='price' AND p_direction='asc' THEN page_row.price END ASC,
      CASE WHEN p_sort='price' AND p_direction='desc' THEN page_row.price END DESC,
      CASE WHEN p_sort='name' AND p_direction='asc' THEN page_row.sort_name END ASC,
      CASE WHEN p_sort='name' AND p_direction='desc' THEN page_row.sort_name END DESC,
      CASE WHEN p_direction='asc' THEN page_row.id END ASC,
      CASE WHEN p_direction='desc' THEN page_row.id END DESC
  ),'[]'::jsonb) INTO v_rows
  FROM(
    SELECT service_record.id,service_record.name_ar,service_record.name_en,
      service_record.description_ar,service_record.description_en,service_record.category,
      service_record.price,service_record.price_type,service_record.delivery_time,
      service_record.features,service_record.image_urls,service_record.is_active,
      service_record.moderation_status,service_record.moderation_note,
      service_record.provider_publish_intent,service_record.created_at,
      CASE WHEN p_language='ar' THEN service_record.name_ar ELSE service_record.name_en END AS sort_name
    FROM public.services service_record
    WHERE service_record.provider_id=p_provider_id
      AND (
        nullif(btrim(coalesce(p_query,'')),'') IS NULL
        OR service_record.name_ar ILIKE '%'||btrim(p_query)||'%'
        OR service_record.name_en ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(service_record.description_ar,'') ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(service_record.description_en,'') ILIKE '%'||btrim(p_query)||'%'
        OR service_record.category ILIKE '%'||btrim(p_query)||'%'
      )
      AND (
        p_cursor_id IS NULL
        OR (p_sort='created_at' AND (
          (p_direction='asc' AND (service_record.created_at>p_cursor_created_at OR (service_record.created_at=p_cursor_created_at AND service_record.id>p_cursor_id)))
          OR (p_direction='desc' AND (service_record.created_at<p_cursor_created_at OR (service_record.created_at=p_cursor_created_at AND service_record.id<p_cursor_id)))
        ))
        OR (p_sort='price' AND (
          (p_direction='asc' AND (service_record.price>p_cursor_price OR (service_record.price=p_cursor_price AND service_record.id>p_cursor_id)))
          OR (p_direction='desc' AND (service_record.price<p_cursor_price OR (service_record.price=p_cursor_price AND service_record.id<p_cursor_id)))
        ))
        OR (p_sort='name' AND (
          (p_direction='asc' AND ((CASE WHEN p_language='ar' THEN service_record.name_ar ELSE service_record.name_en END)>p_cursor_name
            OR ((CASE WHEN p_language='ar' THEN service_record.name_ar ELSE service_record.name_en END)=p_cursor_name AND service_record.id>p_cursor_id)))
          OR (p_direction='desc' AND ((CASE WHEN p_language='ar' THEN service_record.name_ar ELSE service_record.name_en END)<p_cursor_name
            OR ((CASE WHEN p_language='ar' THEN service_record.name_ar ELSE service_record.name_en END)=p_cursor_name AND service_record.id<p_cursor_id)))
        ))
      )
    ORDER BY
      CASE WHEN p_sort='created_at' AND p_direction='asc' THEN service_record.created_at END ASC,
      CASE WHEN p_sort='created_at' AND p_direction='desc' THEN service_record.created_at END DESC,
      CASE WHEN p_sort='price' AND p_direction='asc' THEN service_record.price END ASC,
      CASE WHEN p_sort='price' AND p_direction='desc' THEN service_record.price END DESC,
      CASE WHEN p_sort='name' AND p_direction='asc' THEN CASE WHEN p_language='ar' THEN service_record.name_ar ELSE service_record.name_en END END ASC,
      CASE WHEN p_sort='name' AND p_direction='desc' THEN CASE WHEN p_language='ar' THEN service_record.name_ar ELSE service_record.name_en END END DESC,
      CASE WHEN p_direction='asc' THEN service_record.id END ASC,
      CASE WHEN p_direction='desc' THEN service_record.id END DESC
    LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('services',v_rows,'total',v_total);
END $$;

REVOKE ALL ON FUNCTION public.get_provider_service_page(
  uuid,uuid,text,text,text,text,timestamptz,numeric,text,uuid,integer
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_service_page(
  uuid,uuid,text,text,text,text,timestamptz,numeric,text,uuid,integer
) TO service_role;

COMMIT;
