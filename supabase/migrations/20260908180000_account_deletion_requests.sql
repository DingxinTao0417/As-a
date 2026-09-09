BEGIN;

CREATE TABLE public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','cancelled','processing','completed','failed')),
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}',
  current_step text,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 2000),
  requested_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX account_deletion_active_user_unique
  ON public.account_deletion_requests(user_id)
  WHERE status IN ('requested','processing');
CREATE INDEX account_deletion_status_requested_idx
  ON public.account_deletion_requests(status,requested_at);

-- Older code used deletion_requested_at only after immediately anonymizing the
-- account. Preserve those records as processing items for manual adoption.
INSERT INTO public.account_deletion_requests(
  user_id,status,eligibility_snapshot,current_step,requested_at,processing_started_at
)
SELECT
  id,'processing','{"legacy_immediate_anonymization":true}',
  'legacy_account_requires_review',deletion_requested_at,deletion_requested_at
FROM public.profiles
WHERE deletion_requested_at IS NOT NULL;

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;
CREATE POLICY deletion_request_owner_read ON public.account_deletion_requests
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR public.is_app_admin());

DROP FUNCTION public.request_account_deletion();

CREATE FUNCTION public.request_account_deletion(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_profile public.profiles%rowtype;
  v_provider_ids uuid[];
  v_available numeric;
  v_reserved numeric;
  v_existing public.account_deletion_requests%rowtype;
  v_request public.account_deletion_requests%rowtype;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.profiles
    WHERE id = p_actor_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  PERFORM id FROM public.providers
    WHERE user_id = p_actor_id ORDER BY id FOR UPDATE;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_provider_ids
    FROM public.providers WHERE user_id = p_actor_id;

  SELECT * INTO v_existing FROM public.account_deletion_requests
    WHERE user_id = p_actor_id AND status IN ('requested','processing')
    ORDER BY requested_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN to_jsonb(v_existing); END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders order_record
    WHERE order_record.status IN ('pending','paid','revision_requested','awaiting_confirmation')
      AND (order_record.seeker_id = p_actor_id OR order_record.provider_id = ANY(v_provider_ids))
  ) THEN
    RAISE EXCEPTION 'Active orders prevent account deletion';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.withdrawal_requests withdrawal
    WHERE withdrawal.provider_id = ANY(v_provider_ids)
      AND withdrawal.status IN ('pending','approved')
  ) THEN
    RAISE EXCEPTION 'Open withdrawals prevent account deletion';
  END IF;
  SELECT
    coalesce(sum(available_delta),0),coalesce(sum(reserved_delta),0)
  INTO v_available,v_reserved
  FROM public.ledger_entries WHERE provider_id = ANY(v_provider_ids);
  IF v_available <> 0 OR v_reserved <> 0 THEN
    RAISE EXCEPTION 'Unsettled provider balance prevents account deletion';
  END IF;

  v_snapshot := jsonb_build_object(
    'active_orders',0,
    'open_withdrawals',0,
    'available_balance',v_available,
    'reserved_balance',v_reserved,
    'checked_at',now()
  );
  INSERT INTO public.account_deletion_requests(user_id,eligibility_snapshot)
    VALUES(p_actor_id,v_snapshot)
    RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END $$;

CREATE FUNCTION public.cancel_account_deletion(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request public.account_deletion_requests%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.account_deletion_requests
    WHERE user_id = p_actor_id AND status = 'requested'
    ORDER BY requested_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No cancellable deletion request'; END IF;
  UPDATE public.account_deletion_requests
    SET status = 'cancelled',cancelled_at = now(),updated_at = now()
    WHERE id = v_request.id
    RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END $$;

CREATE FUNCTION public.get_account_deletion_status(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request public.account_deletion_requests%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.account_deletion_requests
    WHERE user_id = p_actor_id
    ORDER BY requested_at DESC,id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_request);
END $$;

CREATE FUNCTION public.export_user_data_snapshot_v2(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (public.export_user_data_snapshot(p_actor_id) || jsonb_build_object(
    'schema_version',2,
    'account_deletion_requests',coalesce((
      SELECT jsonb_agg(to_jsonb(request_record) ORDER BY request_record.requested_at,request_record.id)
      FROM public.account_deletion_requests request_record
      WHERE request_record.user_id = p_actor_id
    ),'[]'::jsonb)
  ));
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_account_deletion_status(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.export_user_data_snapshot_v2(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_account_deletion_status(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.export_user_data_snapshot_v2(uuid)
  TO service_role;

COMMIT;
