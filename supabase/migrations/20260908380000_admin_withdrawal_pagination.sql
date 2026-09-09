BEGIN;

CREATE FUNCTION public.get_admin_withdrawal_page(
  p_actor_id uuid,p_status text,p_before_requested_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_pending bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR (p_status IS NOT NULL AND p_status NOT IN ('pending','approved','processing','unknown','paid','failed','completed','rejected'))
    OR ((p_before_requested_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid administrator withdrawal query' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.withdrawal_requests withdrawal
  WHERE p_status IS NULL OR withdrawal.status=p_status;
  SELECT count(*) INTO v_pending FROM public.withdrawal_requests WHERE status='pending';
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.requested_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT withdrawal.id,withdrawal.amount,withdrawal.status,withdrawal.requested_at,
      withdrawal.processed_at,withdrawal.notes,withdrawal.payout_method,
      withdrawal.external_reference,withdrawal.failure_reason,
      jsonb_build_object(
        'name_ar',provider.name_ar,'name_en',provider.name_en,'avatar_url',provider.avatar_url
      ) AS providers,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',attempt.id,'method',attempt.method,'external_reference',attempt.external_reference,
          'status',attempt.status,'evidence_reference',attempt.evidence_reference,'note',attempt.note,
          'created_at',attempt.created_at,'updated_at',attempt.updated_at
        ) ORDER BY attempt.created_at DESC,attempt.id DESC)
        FROM public.payout_attempts attempt
        WHERE attempt.withdrawal_request_id=withdrawal.id
      ),'[]'::jsonb) AS payout_attempts
    FROM public.withdrawal_requests withdrawal
    JOIN public.providers provider ON provider.id=withdrawal.provider_id
    WHERE (p_status IS NULL OR withdrawal.status=p_status)
      AND (
        p_before_requested_at IS NULL
        OR withdrawal.requested_at<p_before_requested_at
        OR (withdrawal.requested_at=p_before_requested_at AND withdrawal.id<p_before_id)
      )
    ORDER BY withdrawal.requested_at DESC,withdrawal.id DESC
    LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object(
    'withdrawals',v_rows,'total',v_total,'pending_count',v_pending
  );
END $$;

CREATE FUNCTION public.get_provider_withdrawal_page(
  p_actor_id uuid,p_provider_id uuid,p_before_requested_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(
      SELECT 1 FROM public.providers provider
      WHERE provider.id=p_provider_id AND provider.user_id=p_actor_id
    )
    OR ((p_before_requested_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid provider withdrawal query' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.withdrawal_requests
  WHERE provider_id=p_provider_id;
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.requested_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT withdrawal.id,withdrawal.amount,withdrawal.status,withdrawal.requested_at,
      withdrawal.processed_at,withdrawal.notes,withdrawal.payout_method,
      withdrawal.external_reference,withdrawal.failure_reason,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',attempt.id,'method',attempt.method,'external_reference',attempt.external_reference,
          'status',attempt.status,'evidence_reference',attempt.evidence_reference,'note',attempt.note,
          'created_at',attempt.created_at,'updated_at',attempt.updated_at
        ) ORDER BY attempt.created_at DESC,attempt.id DESC)
        FROM public.payout_attempts attempt
        WHERE attempt.withdrawal_request_id=withdrawal.id
      ),'[]'::jsonb) AS payout_attempts
    FROM public.withdrawal_requests withdrawal
    WHERE withdrawal.provider_id=p_provider_id
      AND (
        p_before_requested_at IS NULL
        OR withdrawal.requested_at<p_before_requested_at
        OR (withdrawal.requested_at=p_before_requested_at AND withdrawal.id<p_before_id)
      )
    ORDER BY withdrawal.requested_at DESC,withdrawal.id DESC
    LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('withdrawals',v_rows,'total',v_total);
END $$;

REVOKE ALL ON FUNCTION public.get_admin_withdrawal_page(uuid,text,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_provider_withdrawal_page(uuid,uuid,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_withdrawal_page(uuid,text,timestamptz,uuid,integer)
TO service_role;
GRANT EXECUTE ON FUNCTION public.get_provider_withdrawal_page(uuid,uuid,timestamptz,uuid,integer)
TO service_role;

COMMIT;
