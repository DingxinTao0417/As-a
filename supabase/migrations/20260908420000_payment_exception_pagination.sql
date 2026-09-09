BEGIN;

CREATE FUNCTION public.get_admin_payment_exception_page(
  p_actor_id uuid,p_status text,p_before_received_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_pending bigint;v_quarantined bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR p_status NOT IN ('all','pending','quarantined')
    OR ((p_before_received_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid payment exception query' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_total FROM public.payment_events event
  WHERE event.processing_status IN ('pending','quarantined')
    AND (p_status='all' OR event.processing_status=p_status);
  SELECT count(*) INTO v_pending FROM public.payment_events WHERE processing_status='pending';
  SELECT count(*) INTO v_quarantined FROM public.payment_events WHERE processing_status='quarantined';
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.received_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT event.id,event.source,event.external_charge_id,event.external_status,
      event.claimed_order_id,event.claimed_payment_attempt_id,event.linked_order_id,
      event.linked_payment_attempt_id,event.amount,event.currency,event.processing_status,
      event.processing_result,event.received_at
    FROM public.payment_events event
    WHERE event.processing_status IN ('pending','quarantined')
      AND (p_status='all' OR event.processing_status=p_status)
      AND (
        p_before_received_at IS NULL
        OR event.received_at<p_before_received_at
        OR (event.received_at=p_before_received_at AND event.id<p_before_id)
      )
    ORDER BY event.received_at DESC,event.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object(
    'events',v_rows,'total',v_total,'pending_count',v_pending,'quarantined_count',v_quarantined
  );
END $$;

REVOKE ALL ON FUNCTION public.get_admin_payment_exception_page(uuid,text,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_payment_exception_page(uuid,text,timestamptz,uuid,integer)
TO service_role;

COMMIT;
