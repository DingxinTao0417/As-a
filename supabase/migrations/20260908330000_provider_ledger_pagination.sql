BEGIN;

CREATE FUNCTION public.get_provider_ledger_page(
  p_actor_id uuid,
  p_provider_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
) RETURNS TABLE(
  id uuid,entry_type text,reference_key text,available_delta numeric,reserved_delta numeric,
  paid_delta numeric,note text,created_at timestamptz,order_id uuid,withdrawal_request_id uuid,
  service_name_ar text,service_name_en text,withdrawal_status text,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL))
     OR NOT EXISTS (
       SELECT 1 FROM public.providers provider
       WHERE provider.id=p_provider_id AND provider.user_id=p_actor_id
     ) THEN
    RAISE EXCEPTION 'Provider ledger unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT entry.id,entry.entry_type,entry.reference_key,entry.available_delta,entry.reserved_delta,
    entry.paid_delta,entry.note,entry.created_at,entry.order_id,entry.withdrawal_request_id,
    order_record.service_name_ar,order_record.service_name_en,withdrawal.status,
    (SELECT count(*) FROM public.ledger_entries counted WHERE counted.provider_id=p_provider_id)
  FROM public.ledger_entries entry
  LEFT JOIN public.orders order_record ON order_record.id=entry.order_id
  LEFT JOIN public.withdrawal_requests withdrawal ON withdrawal.id=entry.withdrawal_request_id
  WHERE entry.provider_id=p_provider_id
    AND (
      p_before_created_at IS NULL
      OR entry.created_at<p_before_created_at
      OR (entry.created_at=p_before_created_at AND entry.id<p_before_id)
    )
  ORDER BY entry.created_at DESC,entry.id DESC
  LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.get_provider_ledger_page(uuid,uuid,timestamptz,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_ledger_page(uuid,uuid,timestamptz,uuid,integer)
  TO service_role;

COMMIT;
