BEGIN;

CREATE FUNCTION public.get_refund_eligible_order_page(
  p_actor_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid refund-eligible order query' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_total FROM public.orders order_record
  WHERE order_record.seeker_id=p_actor_id
    AND order_record.status IN ('paid','revision_requested','awaiting_confirmation','completed')
    AND order_record.tap_charge_id IS NOT NULL;
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT order_record.id,order_record.service_name_ar,order_record.service_name_en,
      order_record.amount,order_record.refunded_amount,order_record.refund_status,
      order_record.status,order_record.currency,order_record.created_at,
      coalesce((
        SELECT sum(refund.amount) FROM public.refund_requests refund
        WHERE refund.order_id=order_record.id
          AND refund.status IN ('requested','approved','processing','unknown')
      ),0) AS active_refund_amount,
      greatest(order_record.amount-order_record.refunded_amount-coalesce((
        SELECT sum(refund.amount) FROM public.refund_requests refund
        WHERE refund.order_id=order_record.id
          AND refund.status IN ('requested','approved','processing','unknown')
      ),0),0) AS available_refund_amount
    FROM public.orders order_record
    WHERE order_record.seeker_id=p_actor_id
      AND order_record.status IN ('paid','revision_requested','awaiting_confirmation','completed')
      AND order_record.tap_charge_id IS NOT NULL
      AND (
        p_before_created_at IS NULL
        OR order_record.created_at<p_before_created_at
        OR (order_record.created_at=p_before_created_at AND order_record.id<p_before_id)
      )
    ORDER BY order_record.created_at DESC,order_record.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('orders',v_rows,'total',v_total);
END $$;

CREATE FUNCTION public.get_refund_request_page(
  p_actor_id uuid,p_admin_view boolean,p_status text,
  p_before_requested_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_open bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR p_admin_view IS NULL
    OR (p_admin_view AND NOT EXISTS(
      SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin
    ))
    OR (p_status IS NOT NULL AND p_status NOT IN (
      'active','requested','approved','rejected','cancelled','processing','succeeded','failed','unknown'
    ))
    OR ((p_before_requested_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid refund request query' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.refund_requests refund
  WHERE (p_admin_view OR refund.requester_id=p_actor_id)
    AND (p_status IS NULL OR refund.status=p_status
      OR (p_status='active' AND refund.status IN ('requested','approved','processing','unknown')));
  SELECT count(*) INTO v_open FROM public.refund_requests refund
  WHERE (p_admin_view OR refund.requester_id=p_actor_id)
    AND refund.status IN ('requested','approved','processing','unknown');
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.requested_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT refund.id,refund.order_id,refund.requester_id,refund.charge_id,refund.amount,
      refund.provider_amount,refund.platform_amount,refund.currency,refund.reason,refund.status,
      refund.review_note,refund.requested_at,refund.updated_at,
      jsonb_build_object(
        'service_name_ar',order_record.service_name_ar,'service_name_en',order_record.service_name_en,
        'amount',order_record.amount,'refunded_amount',order_record.refunded_amount,'status',order_record.status
      ) AS "order",
      CASE WHEN p_admin_view THEN jsonb_build_object(
        'full_name',requester.full_name,'email',requester.email
      ) ELSE NULL END AS requester
    FROM public.refund_requests refund
    JOIN public.orders order_record ON order_record.id=refund.order_id
    JOIN public.profiles requester ON requester.id=refund.requester_id
    WHERE (p_admin_view OR refund.requester_id=p_actor_id)
      AND (p_status IS NULL OR refund.status=p_status
        OR (p_status='active' AND refund.status IN ('requested','approved','processing','unknown')))
      AND (
        p_before_requested_at IS NULL
        OR refund.requested_at<p_before_requested_at
        OR (refund.requested_at=p_before_requested_at AND refund.id<p_before_id)
      )
    ORDER BY refund.requested_at DESC,refund.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('refunds',v_rows,'total',v_total,'open_count',v_open);
END $$;

REVOKE ALL ON FUNCTION public.get_refund_eligible_order_page(uuid,timestamptz,uuid,integer),
  public.get_refund_request_page(uuid,boolean,text,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_refund_eligible_order_page(uuid,timestamptz,uuid,integer),
  public.get_refund_request_page(uuid,boolean,text,timestamptz,uuid,integer)
TO service_role;

COMMIT;
