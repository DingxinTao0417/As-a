BEGIN;

CREATE INDEX payment_attempts_reconciliation_idx
  ON public.payment_attempts(status,updated_at,id)
  WHERE status IN ('creating','pending','unknown');

CREATE FUNCTION public.get_admin_payment_reconciliation_page(
  p_actor_id uuid,
  p_after_updated_at timestamptz,
  p_after_id uuid,
  p_limit integer
) RETURNS TABLE(
  id uuid,order_id uuid,status text,external_status text,external_charge_id text,
  amount numeric,currency text,last_checked_at timestamptz,created_at timestamptz,updated_at timestamptz,
  service_name_ar text,service_name_en text,seeker_email text,last_event_at timestamptz,
  last_event_status text,last_event_result text,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_after_updated_at IS NULL) <> (p_after_id IS NULL))
     OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT attempt.id,attempt.order_id,attempt.status,attempt.external_status,attempt.external_charge_id,
    attempt.amount,attempt.currency,attempt.last_checked_at,attempt.created_at,attempt.updated_at,
    order_record.service_name_ar,order_record.service_name_en,seeker.email,
    latest_event.received_at,latest_event.processing_status,latest_event.processing_result,
    (SELECT count(*) FROM public.payment_attempts counted WHERE counted.status IN ('creating','pending','unknown'))
  FROM public.payment_attempts attempt
  JOIN public.orders order_record ON order_record.id=attempt.order_id
  JOIN public.profiles seeker ON seeker.id=order_record.seeker_id
  LEFT JOIN LATERAL (
    SELECT event.received_at,event.processing_status,event.processing_result
    FROM public.payment_events event
    WHERE event.linked_payment_attempt_id=attempt.id
    ORDER BY event.received_at DESC,event.id DESC LIMIT 1
  ) latest_event ON true
  WHERE attempt.status IN ('creating','pending','unknown')
    AND (
      p_after_updated_at IS NULL
      OR attempt.updated_at>p_after_updated_at
      OR (attempt.updated_at=p_after_updated_at AND attempt.id>p_after_id)
    )
  ORDER BY attempt.updated_at,attempt.id
  LIMIT p_limit;
END $$;

CREATE FUNCTION public.get_payment_attempt_for_reconciliation(p_actor_id uuid,p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_attempt public.payment_attempts%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_attempt FROM public.payment_attempts WHERE id=p_attempt_id;
  IF NOT FOUND OR v_attempt.status NOT IN ('creating','pending','unknown') THEN
    RAISE EXCEPTION 'Payment attempt is not open';
  END IF;
  RETURN jsonb_build_object(
    'id',v_attempt.id,'order_id',v_attempt.order_id,'status',v_attempt.status,
    'external_charge_id',v_attempt.external_charge_id,'amount',v_attempt.amount,'currency',v_attempt.currency
  );
END $$;

REVOKE ALL ON FUNCTION public.get_admin_payment_reconciliation_page(uuid,timestamptz,uuid,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_payment_attempt_for_reconciliation(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_payment_reconciliation_page(uuid,timestamptz,uuid,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_attempt_for_reconciliation(uuid,uuid)
  TO service_role;

COMMIT;
