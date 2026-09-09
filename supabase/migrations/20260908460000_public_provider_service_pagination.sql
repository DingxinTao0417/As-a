BEGIN;

CREATE FUNCTION public.get_public_provider_service_page(
  p_provider_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_rows jsonb;
BEGIN
  IF ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 50
    OR NOT EXISTS(
      SELECT 1 FROM public.providers provider
      WHERE provider.id=p_provider_id AND provider.is_active
        AND public.is_account_active(provider.user_id)
    ) THEN RAISE EXCEPTION 'Provider unavailable' USING ERRCODE='42501'; END IF;

  SELECT count(*) INTO v_total FROM public.services service_record
  WHERE service_record.provider_id=p_provider_id
    AND service_record.is_active
    AND service_record.moderation_status='approved'
    AND service_record.provider_publish_intent;
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT service_record.id,service_record.name_ar,service_record.name_en,
      service_record.description_ar,service_record.description_en,service_record.category,
      service_record.price,service_record.price_type,service_record.delivery_time,
      service_record.features,service_record.image_urls,service_record.created_at
    FROM public.services service_record
    WHERE service_record.provider_id=p_provider_id
      AND service_record.is_active
      AND service_record.moderation_status='approved'
      AND service_record.provider_publish_intent
      AND (
        p_before_created_at IS NULL
        OR service_record.created_at<p_before_created_at
        OR (service_record.created_at=p_before_created_at AND service_record.id<p_before_id)
      )
    ORDER BY service_record.created_at DESC,service_record.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('services',v_rows,'total',v_total);
END $$;

REVOKE ALL ON FUNCTION public.get_public_provider_service_page(uuid,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_provider_service_page(uuid,timestamptz,uuid,integer)
TO service_role;

COMMIT;
