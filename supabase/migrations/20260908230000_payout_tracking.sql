BEGIN;

ALTER TABLE public.withdrawal_requests DROP CONSTRAINT withdrawal_requests_status_check;
ALTER TABLE public.withdrawal_requests ADD CONSTRAINT withdrawal_requests_status_check
  CHECK (status IN ('pending','approved','processing','unknown','paid','failed','completed','rejected'));
ALTER TABLE public.withdrawal_requests
  ADD COLUMN payout_method text CHECK (payout_method IS NULL OR payout_method IN ('tap_auto','tap_dashboard')),
  ADD COLUMN external_reference text,
  ADD COLUMN failure_reason text CHECK (failure_reason IS NULL OR char_length(failure_reason)<=1000);

CREATE TABLE public.payout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_request_id uuid NOT NULL REFERENCES public.withdrawal_requests(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('tap_auto','tap_dashboard')),
  external_reference text NOT NULL CHECK (char_length(external_reference) BETWEEN 3 AND 200),
  status text NOT NULL DEFAULT 'awaiting_external'
    CHECK (status IN ('awaiting_external','processing','unknown','paid','failed')),
  evidence_reference text,
  note text CHECK (note IS NULL OR char_length(note)<=1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payout_attempts_active_withdrawal_unique
  ON public.payout_attempts(withdrawal_request_id)
  WHERE status IN ('awaiting_external','processing','unknown');
CREATE UNIQUE INDEX payout_attempts_external_reference_unique
  ON public.payout_attempts(method,external_reference);

ALTER TABLE public.payout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payout_attempts TO authenticated;
GRANT ALL ON public.payout_attempts TO service_role;
CREATE POLICY payout_attempt_participant_read ON public.payout_attempts
  FOR SELECT TO authenticated USING (public.owns_provider(provider_id) OR public.is_app_admin());

ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN (
    'set_admin','verify_provider','set_service_active','review_withdrawal','review_service',
    'suspend_user','restore_user','support_ticket_status','refund_review','dispute_review','payout_tracking'
  ));

CREATE FUNCTION public.begin_payout_tracking(
  p_actor_id uuid,p_withdrawal_id uuid,p_method text,p_external_reference text,p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_withdrawal public.withdrawal_requests%rowtype;
  v_attempt public.payout_attempts%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin)
     OR p_method NOT IN ('tap_auto','tap_dashboard')
     OR char_length(btrim(coalesce(p_external_reference,''))) NOT BETWEEN 3 AND 200
     OR char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid payout tracking request';
  END IF;
  SELECT * INTO v_withdrawal FROM public.withdrawal_requests WHERE id=p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  PERFORM id FROM public.providers WHERE id=v_withdrawal.provider_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.payout_attempts
    WHERE withdrawal_request_id=p_withdrawal_id AND status IN ('awaiting_external','processing','unknown')
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.method<>p_method OR v_attempt.external_reference<>btrim(p_external_reference) THEN
      RAISE EXCEPTION 'Payout tracking already exists with another reference';
    END IF;
    RETURN to_jsonb(v_attempt);
  END IF;
  IF v_withdrawal.status<>'approved' THEN RAISE EXCEPTION 'Withdrawal is not approved'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.refund_requests refund
    JOIN public.orders order_record ON order_record.id=refund.order_id
    WHERE order_record.provider_id=v_withdrawal.provider_id
      AND refund.status IN ('requested','approved','processing','unknown')
  ) OR EXISTS (
    SELECT 1 FROM public.disputes dispute
    JOIN public.orders order_record ON order_record.id=dispute.order_id
    WHERE order_record.provider_id=v_withdrawal.provider_id
      AND dispute.status IN ('open','under_review')
  ) THEN RAISE EXCEPTION 'Open refund or dispute prevents payout'; END IF;

  INSERT INTO public.payout_attempts(
    withdrawal_request_id,provider_id,created_by,method,external_reference,note
  ) VALUES (
    v_withdrawal.id,v_withdrawal.provider_id,p_actor_id,p_method,btrim(p_external_reference),btrim(p_note)
  ) RETURNING * INTO v_attempt;
  UPDATE public.withdrawal_requests SET status='processing',payout_method=p_method,
    external_reference=btrim(p_external_reference),processed_at=now() WHERE id=v_withdrawal.id;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(p_actor_id,'payout_tracking',v_withdrawal.id,
      jsonb_build_object('status',v_withdrawal.status),
      jsonb_build_object('status','processing','method',p_method,'external_reference',btrim(p_external_reference)));
  RETURN to_jsonb(v_attempt);
END $$;

CREATE FUNCTION public.record_payout_tracking_result(
  p_actor_id uuid,p_attempt_id uuid,p_status text,p_evidence_reference text,p_note text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_attempt public.payout_attempts%rowtype;
  v_withdrawal public.withdrawal_requests%rowtype;
  v_provider_user_id uuid;
  v_withdrawal_reserved numeric;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin)
     OR p_status NOT IN ('paid','failed','unknown')
     OR char_length(btrim(coalesce(p_evidence_reference,''))) NOT BETWEEN 3 AND 500
     OR char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid payout result';
  END IF;
  SELECT * INTO v_attempt FROM public.payout_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout attempt not found'; END IF;
  SELECT * INTO v_withdrawal FROM public.withdrawal_requests WHERE id=v_attempt.withdrawal_request_id FOR UPDATE;
  PERFORM id FROM public.providers WHERE id=v_withdrawal.provider_id FOR UPDATE;
  IF v_attempt.status IN ('paid','failed') THEN
    IF v_attempt.status<>p_status OR v_attempt.evidence_reference<>btrim(p_evidence_reference) THEN
      RAISE EXCEPTION 'Payout result conflicts with terminal result';
    END IF;
    RETURN v_attempt.status;
  END IF;
  IF v_withdrawal.status NOT IN ('processing','unknown') THEN RAISE EXCEPTION 'Withdrawal is not awaiting a payout result'; END IF;
  SELECT coalesce(sum(reserved_delta),0) INTO v_withdrawal_reserved
    FROM public.ledger_entries WHERE withdrawal_request_id=v_withdrawal.id;
  IF v_withdrawal_reserved<>v_withdrawal.amount THEN RAISE EXCEPTION 'Withdrawal reservation does not match payout'; END IF;

  UPDATE public.payout_attempts SET status=p_status,evidence_reference=btrim(p_evidence_reference),
    note=btrim(p_note),updated_at=now() WHERE id=p_attempt_id;
  IF p_status='paid' THEN
    INSERT INTO public.ledger_entries(
      provider_id,withdrawal_request_id,entry_type,reference_key,reserved_delta,paid_delta,note
    ) VALUES (
      v_withdrawal.provider_id,v_withdrawal.id,'payout','payout:'||v_attempt.id||':paid',
      -v_withdrawal.amount,v_withdrawal.amount,btrim(p_note)
    );
    UPDATE public.withdrawal_requests SET status='paid',processed_at=now(),failure_reason=NULL WHERE id=v_withdrawal.id;
  ELSIF p_status='failed' THEN
    INSERT INTO public.ledger_entries(
      provider_id,withdrawal_request_id,entry_type,reference_key,available_delta,reserved_delta,note
    ) VALUES (
      v_withdrawal.provider_id,v_withdrawal.id,'withdrawal_release','payout:'||v_attempt.id||':failed-release',
      v_withdrawal.amount,-v_withdrawal.amount,btrim(p_note)
    );
    UPDATE public.withdrawal_requests SET status='failed',processed_at=now(),failure_reason=btrim(p_note) WHERE id=v_withdrawal.id;
  ELSE
    UPDATE public.withdrawal_requests SET status='unknown',failure_reason=NULL WHERE id=v_withdrawal.id;
  END IF;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(p_actor_id,'payout_tracking',v_withdrawal.id,
      jsonb_build_object('status',v_withdrawal.status,'attempt_status',v_attempt.status),
      jsonb_build_object('status',p_status,'evidence_reference',btrim(p_evidence_reference),'note',btrim(p_note)));
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id=v_withdrawal.provider_id;
  PERFORM public.create_notification(v_provider_user_id,'payout:'||v_attempt.id||':status:'||p_status,
    'withdrawal','تحديث السحب','Withdrawal updated','حالة السحب: '||p_status,
    'Withdrawal status: '||p_status,'/dashboard');
  RETURN p_status;
END $$;

CREATE FUNCTION public.prevent_deletion_with_open_payout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.withdrawal_requests withdrawal
    JOIN public.providers provider ON provider.id=withdrawal.provider_id
    WHERE provider.user_id=NEW.user_id AND withdrawal.status IN ('pending','approved','processing','unknown')
  ) THEN RAISE EXCEPTION 'Open payout prevents account deletion'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deletion_payout_guard BEFORE INSERT ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_deletion_with_open_payout();
REVOKE ALL ON FUNCTION public.prevent_deletion_with_open_payout() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.export_user_data_snapshot_v7(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (public.export_user_data_snapshot_v6(p_actor_id) || jsonb_build_object(
    'schema_version',7,
    'payout_attempts',coalesce((
      SELECT jsonb_agg(to_jsonb(attempt) ORDER BY attempt.created_at,attempt.id)
      FROM public.payout_attempts attempt
      JOIN public.providers provider ON provider.id=attempt.provider_id
      WHERE provider.user_id=p_actor_id
    ),'[]'::jsonb),
    'admin_actions_targeting_payouts',coalesce((
      SELECT jsonb_agg(to_jsonb(log) ORDER BY log.created_at,log.id)
      FROM public.admin_audit_log log
      JOIN public.withdrawal_requests withdrawal ON withdrawal.id=log.target_id
      JOIN public.providers provider ON provider.id=withdrawal.provider_id
      WHERE log.action='payout_tracking' AND provider.user_id=p_actor_id
    ),'[]'::jsonb)
  ));
$$;

REVOKE ALL ON FUNCTION public.begin_payout_tracking(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_payout_tracking_result(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.export_user_data_snapshot_v7(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_payout_tracking(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payout_tracking_result(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.export_user_data_snapshot_v7(uuid) TO service_role;

COMMIT;
