BEGIN;

CREATE FUNCTION public.get_admin_service_page(
  p_actor_id uuid,p_query text,p_status text,
  p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_pending bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR char_length(coalesce(p_query,''))>100
    OR p_status NOT IN ('all','draft','pending_review','approved','rejected','suspended')
    OR ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid administrator service query' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.services service_record JOIN public.providers provider ON provider.id=service_record.provider_id
  WHERE (p_status='all' OR service_record.moderation_status=p_status)
    AND (
      nullif(btrim(coalesce(p_query,'')),'') IS NULL
      OR service_record.id::text ILIKE '%'||btrim(p_query)||'%'
      OR service_record.name_ar ILIKE '%'||btrim(p_query)||'%'
      OR service_record.name_en ILIKE '%'||btrim(p_query)||'%'
      OR service_record.category ILIKE '%'||btrim(p_query)||'%'
      OR provider.name_ar ILIKE '%'||btrim(p_query)||'%'
      OR provider.name_en ILIKE '%'||btrim(p_query)||'%'
    );
  SELECT count(*) INTO v_pending FROM public.services WHERE moderation_status='pending_review';
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT service_record.id,service_record.name_ar,service_record.name_en,
      service_record.description_ar,service_record.description_en,service_record.category,
      service_record.price,service_record.price_type,service_record.delivery_time,
      service_record.is_active,service_record.moderation_status,service_record.moderation_note,
      service_record.image_urls,service_record.features,service_record.created_at,
      jsonb_build_object(
        'name_ar',provider.name_ar,'name_en',provider.name_en,'avatar_url',provider.avatar_url
      ) AS providers
    FROM public.services service_record
    JOIN public.providers provider ON provider.id=service_record.provider_id
    WHERE (p_status='all' OR service_record.moderation_status=p_status)
      AND (
        nullif(btrim(coalesce(p_query,'')),'') IS NULL
        OR service_record.id::text ILIKE '%'||btrim(p_query)||'%'
        OR service_record.name_ar ILIKE '%'||btrim(p_query)||'%'
        OR service_record.name_en ILIKE '%'||btrim(p_query)||'%'
        OR service_record.category ILIKE '%'||btrim(p_query)||'%'
        OR provider.name_ar ILIKE '%'||btrim(p_query)||'%'
        OR provider.name_en ILIKE '%'||btrim(p_query)||'%'
      )
      AND (
        p_before_created_at IS NULL
        OR service_record.created_at<p_before_created_at
        OR (service_record.created_at=p_before_created_at AND service_record.id<p_before_id)
      )
    ORDER BY service_record.created_at DESC,service_record.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('services',v_rows,'total',v_total,'pending_count',v_pending);
END $$;

REVOKE ALL ON FUNCTION public.get_admin_service_page(uuid,text,text,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_service_page(uuid,text,text,timestamptz,uuid,integer)
TO service_role;

COMMIT;
