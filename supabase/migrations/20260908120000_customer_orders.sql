BEGIN;

CREATE FUNCTION public.get_customer_order_page(
  p_actor_id uuid,
  p_offset integer,
  p_limit integer
) RETURNS TABLE(
  id uuid,
  service_id uuid,
  provider_name_ar text,
  provider_name_en text,
  provider_avatar text,
  service_name_ar text,
  service_name_en text,
  service_description_ar text,
  service_description_en text,
  amount numeric,
  status text,
  display_at timestamptz,
  review_id uuid,
  review_rating integer,
  review_comment text,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_offset < 0 OR p_limit NOT BETWEEN 1 AND 50
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Invalid order page';
  END IF;
  RETURN QUERY
  SELECT o.id,o.service_id,p.name_ar,p.name_en,p.avatar_url,
    o.service_name_ar,o.service_name_en,o.service_description_ar,o.service_description_en,
    o.amount,o.status,coalesce(o.completed_at,o.paid_at,o.created_at),
    r.id,r.rating,r.comment,count(*) OVER()
  FROM public.orders o
  JOIN public.providers p ON p.id = o.provider_id
  LEFT JOIN public.reviews r ON r.order_id = o.id AND r.reviewer_id = p_actor_id
  WHERE o.seeker_id = p_actor_id
  ORDER BY o.created_at DESC,o.id DESC
  OFFSET p_offset LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.get_customer_order_page(uuid,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_order_page(uuid,integer,integer)
  TO service_role;

COMMIT;
