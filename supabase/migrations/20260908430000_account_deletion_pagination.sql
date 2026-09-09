BEGIN;

CREATE FUNCTION public.get_admin_account_deletion_page(
  p_actor_id uuid,p_status text,p_after_requested_at timestamptz,p_after_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_requested bigint;v_processing bigint;v_failed bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR p_status NOT IN ('all','open','requested','processing','failed','cancelled','completed')
    OR ((p_after_requested_at IS NULL)<>(p_after_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid account deletion queue query' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_total FROM public.account_deletion_requests request
  WHERE p_status='all' OR request.status=p_status
    OR (p_status='open' AND request.status IN ('requested','processing','failed'));
  SELECT count(*) INTO v_requested FROM public.account_deletion_requests WHERE status='requested';
  SELECT count(*) INTO v_processing FROM public.account_deletion_requests WHERE status='processing';
  SELECT count(*) INTO v_failed FROM public.account_deletion_requests WHERE status='failed';
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.requested_at,page_row.id),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT request.id,request.user_id,request.status,request.eligibility_snapshot,
      request.current_step,request.last_error,request.requested_at,request.updated_at,
      jsonb_build_object('email',profile.email,'full_name',profile.full_name) AS "user"
    FROM public.account_deletion_requests request
    JOIN public.profiles profile ON profile.id=request.user_id
    WHERE (p_status='all' OR request.status=p_status
      OR (p_status='open' AND request.status IN ('requested','processing','failed')))
      AND (
        p_after_requested_at IS NULL
        OR request.requested_at>p_after_requested_at
        OR (request.requested_at=p_after_requested_at AND request.id>p_after_id)
      )
    ORDER BY request.requested_at,request.id LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object(
    'requests',v_rows,'total',v_total,'requested_count',v_requested,
    'processing_count',v_processing,'failed_count',v_failed
  );
END $$;

REVOKE ALL ON FUNCTION public.get_admin_account_deletion_page(uuid,text,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_account_deletion_page(uuid,text,timestamptz,uuid,integer)
TO service_role;

COMMIT;
