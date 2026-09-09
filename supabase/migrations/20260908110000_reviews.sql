BEGIN;

CREATE FUNCTION public.save_order_review(
  p_actor_id uuid,
  p_order_id uuid,
  p_rating integer,
  p_comment text
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
  v_review_id uuid;
BEGIN
  IF p_rating NOT BETWEEN 1 AND 5 OR char_length(coalesce(p_comment,'')) > 5000 THEN
    RAISE EXCEPTION 'Invalid review';
  END IF;
  SELECT * INTO v_order FROM public.orders
    WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.seeker_id IS DISTINCT FROM p_actor_id
     OR v_order.status <> 'completed' OR v_order.service_id IS NULL
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Completed order not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.reviews(order_id,service_id,reviewer_id,rating,comment,service_name)
    VALUES(
      v_order.id,v_order.service_id,p_actor_id,p_rating,
      nullif(btrim(coalesce(p_comment,'')),''),v_order.service_name_en
    )
    ON CONFLICT(order_id) DO UPDATE SET
      rating = EXCLUDED.rating,
      comment = EXCLUDED.comment
    WHERE public.reviews.reviewer_id = p_actor_id
    RETURNING id INTO v_review_id;
  IF v_review_id IS NULL THEN
    RAISE EXCEPTION 'Review belongs to another user' USING ERRCODE = '42501';
  END IF;
  RETURN v_review_id;
END $$;

CREATE FUNCTION public.delete_order_review(p_actor_id uuid,p_review_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.reviews
    WHERE id = p_review_id
      AND reviewer_id = p_actor_id
      AND public.is_account_active(p_actor_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found' USING ERRCODE = '42501'; END IF;
END $$;

CREATE FUNCTION public.get_service_review_page(
  p_service_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
) RETURNS TABLE(
  id uuid,
  rating integer,
  comment text,
  created_at timestamptz,
  service_name text,
  reviewer_id uuid,
  reviewer_name text,
  reviewer_avatar text,
  total_count bigint,
  average_rating numeric,
  five_count bigint,
  four_count bigint,
  three_count bigint,
  two_count bigint,
  one_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 50
     OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid review page';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.services s
    JOIN public.providers p ON p.id = s.provider_id
    WHERE s.id = p_service_id AND s.is_active AND p.is_active
      AND public.is_account_active(p.user_id)
  ) THEN RAISE EXCEPTION 'Service unavailable'; END IF;

  RETURN QUERY
  WITH summary AS (
    SELECT count(*) AS total_count,
      coalesce(round(avg(r.rating)::numeric,2),0) AS average_rating,
      count(*) FILTER (WHERE r.rating = 5) AS five_count,
      count(*) FILTER (WHERE r.rating = 4) AS four_count,
      count(*) FILTER (WHERE r.rating = 3) AS three_count,
      count(*) FILTER (WHERE r.rating = 2) AS two_count,
      count(*) FILTER (WHERE r.rating = 1) AS one_count
    FROM public.reviews r WHERE r.service_id = p_service_id
  ), page AS (
    SELECT r.* FROM public.reviews r
    WHERE r.service_id = p_service_id
      AND (
        p_before_created_at IS NULL
        OR r.created_at < p_before_created_at
        OR (r.created_at = p_before_created_at AND r.id < p_before_id)
      )
    ORDER BY r.created_at DESC,r.id DESC
    LIMIT p_limit
  )
  SELECT p.id,p.rating,p.comment,p.created_at,p.service_name,p.reviewer_id,
    profile.full_name,profile.avatar_url,
    s.total_count,s.average_rating,s.five_count,s.four_count,s.three_count,s.two_count,s.one_count
  FROM page p
  CROSS JOIN summary s
  LEFT JOIN public.public_profiles profile ON profile.id = p.reviewer_id
  ORDER BY p.created_at DESC,p.id DESC;
END $$;

REVOKE ALL ON FUNCTION public.save_order_review(uuid,uuid,integer,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delete_order_review(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_service_review_page(uuid,timestamptz,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_order_review(uuid,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_order_review(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_service_review_page(uuid,timestamptz,uuid,integer) TO service_role;

COMMIT;
