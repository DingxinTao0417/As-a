BEGIN;

CREATE FUNCTION public.get_admin_provider_page(
  p_actor_id uuid,p_query text,p_filter text,
  p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS TABLE(
  id uuid,name_ar text,name_en text,title_ar text,title_en text,bio_ar text,bio_en text,
  category text,skills text[],rating numeric,reviews_count integer,completed_projects integer,
  is_verified boolean,is_active boolean,avatar_url text,portfolio_urls text[],
  tap_account_status text,created_at timestamptz,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR char_length(coalesce(p_query,''))>100
    OR p_filter NOT IN ('all','verified','unverified')
    OR ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid administrator provider query' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  WITH filtered AS MATERIALIZED(
    SELECT provider.*
    FROM public.providers provider
    WHERE (p_filter='all'
      OR (p_filter='verified' AND provider.is_verified)
      OR (p_filter='unverified' AND NOT provider.is_verified))
      AND (
        nullif(btrim(coalesce(p_query,'')),'') IS NULL
        OR provider.id::text ILIKE '%'||btrim(p_query)||'%'
        OR provider.name_ar ILIKE '%'||btrim(p_query)||'%'
        OR provider.name_en ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(provider.title_ar,'') ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(provider.title_en,'') ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(provider.category,'') ILIKE '%'||btrim(p_query)||'%'
      )
  )
  SELECT provider.id,provider.name_ar,provider.name_en,provider.title_ar,provider.title_en,
    provider.bio_ar,provider.bio_en,coalesce(provider.category,''),provider.skills,provider.rating,
    provider.reviews_count,provider.completed_projects,provider.is_verified,provider.is_active,
    provider.avatar_url,provider.portfolio_urls,provider.tap_account_status,provider.created_at,
    (SELECT count(*) FROM filtered)
  FROM filtered provider
  WHERE p_before_created_at IS NULL
    OR provider.created_at<p_before_created_at
    OR (provider.created_at=p_before_created_at AND provider.id<p_before_id)
  ORDER BY provider.created_at DESC,provider.id DESC
  LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.get_admin_provider_page(uuid,text,text,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_provider_page(uuid,text,text,timestamptz,uuid,integer)
TO service_role;

COMMIT;
