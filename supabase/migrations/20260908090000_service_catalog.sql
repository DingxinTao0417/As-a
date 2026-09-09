BEGIN;

CREATE FUNCTION public.search_service_catalog(
  p_query text,
  p_category text,
  p_sort text,
  p_offset integer,
  p_limit integer
) RETURNS TABLE(
  id uuid,
  name_ar text,
  name_en text,
  description_ar text,
  description_en text,
  category text,
  price numeric,
  price_type text,
  delivery_time text,
  features text[],
  image_urls text[],
  provider_id uuid,
  provider_name_ar text,
  provider_name_en text,
  provider_avatar_url text,
  provider_rating numeric,
  provider_reviews_count integer,
  provider_is_verified boolean,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_sort NOT IN ('newest','rating','price-low','price-high')
     OR p_offset < 0 OR p_limit NOT BETWEEN 1 AND 50
     OR char_length(coalesce(p_query,'')) > 100
     OR (p_category IS NOT NULL AND p_category NOT IN ('development','design','marketing','writing','video','music','business','consulting')) THEN
    RAISE EXCEPTION 'Invalid catalog query';
  END IF;

  RETURN QUERY
  SELECT
    s.id,s.name_ar,s.name_en,s.description_ar,s.description_en,s.category,
    s.price,s.price_type,s.delivery_time,s.features,s.image_urls,s.provider_id,
    p.name_ar,p.name_en,p.avatar_url,p.rating,p.reviews_count,p.is_verified,
    s.created_at,count(*) OVER()
  FROM public.services s
  JOIN public.providers p ON p.id = s.provider_id
  JOIN public.profiles profile ON profile.id = p.user_id
  WHERE s.is_active
    AND s.moderation_status = 'approved'
    AND s.provider_publish_intent
    AND p.is_active
    AND profile.deletion_requested_at IS NULL
    AND (p_category IS NULL OR s.category = p_category)
    AND (
      nullif(btrim(coalesce(p_query,'')),'') IS NULL
      OR s.name_ar ILIKE '%' || btrim(p_query) || '%'
      OR s.name_en ILIKE '%' || btrim(p_query) || '%'
      OR coalesce(s.description_ar,'') ILIKE '%' || btrim(p_query) || '%'
      OR coalesce(s.description_en,'') ILIKE '%' || btrim(p_query) || '%'
    )
  ORDER BY
    CASE WHEN p_sort = 'rating' THEN p.rating END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-low' THEN s.price END ASC,
    CASE WHEN p_sort = 'price-high' THEN s.price END DESC,
    CASE WHEN p_sort = 'newest' THEN s.created_at END DESC,
    s.created_at DESC,
    s.id ASC
  OFFSET p_offset LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.search_service_catalog(text,text,text,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_service_catalog(text,text,text,integer,integer)
  TO service_role;

COMMIT;
