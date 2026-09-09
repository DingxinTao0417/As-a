BEGIN;

ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK(action IN (
  'set_admin','verify_provider','set_service_active','review_withdrawal','review_service',
  'suspend_user','restore_user','support_ticket_status','refund_review','dispute_review',
  'payout_tracking','payment_event_relink','provider_verification_review','ai_knowledge_publish',
  'payment_attempt_recovery'
));

CREATE FUNCTION public.recover_payment_attempt_charge(
  p_actor_id uuid,p_attempt_id uuid,p_charge jsonb,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_attempt public.payment_attempts%rowtype;v_order public.orders%rowtype;
  v_event_id uuid;v_result jsonb;v_before jsonb;v_after jsonb;
  v_charge_id text;v_status text;v_currency text;v_amount numeric;v_event_key text;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR p_charge IS NULL OR jsonb_typeof(p_charge)<>'object'
    OR jsonb_typeof(p_charge->'amount')<>'number' THEN
    RAISE EXCEPTION 'Invalid payment recovery request' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_attempt FROM public.payment_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.status NOT IN ('creating','pending','unknown') THEN
    RAISE EXCEPTION 'Payment attempt is not open';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_attempt.order_id FOR UPDATE;
  v_charge_id:=p_charge->>'id';
  v_status:=upper(coalesce(p_charge->>'status',''));
  v_currency:=upper(coalesce(p_charge->>'currency',''));
  v_amount:=(p_charge->>'amount')::numeric;
  IF v_charge_id!~'^chg_[A-Za-z0-9_-]+$'
    OR v_status NOT IN ('INITIATED','AUTHORIZED','IN_PROGRESS','CAPTURED','VOID','CANCELLED',
      'ABANDONED','TIMEDOUT','TIMED_OUT','UNKNOWN','FAILED','DECLINED','RESTRICTED')
    OR v_amount IS DISTINCT FROM v_attempt.amount
    OR v_amount IS DISTINCT FROM v_order.amount
    OR v_currency IS DISTINCT FROM v_attempt.currency
    OR v_currency IS DISTINCT FROM v_order.currency
    OR p_charge#>>'{metadata,order_id}' IS DISTINCT FROM v_order.id::text
    OR p_charge#>>'{metadata,payment_attempt_id}' IS DISTINCT FROM v_attempt.id::text
    OR (v_attempt.external_charge_id IS NOT NULL AND v_attempt.external_charge_id<>v_charge_id) THEN
    RAISE EXCEPTION 'Charge does not match payment attempt';
  END IF;
  v_before:=to_jsonb(v_attempt);
  v_event_key:='recovery:'||v_charge_id||':'||v_status||':'||coalesce(p_charge#>>'{transaction,created}','unknown');
  v_event_id:=public.record_payment_event(
    'reconciliation',v_event_key,v_charge_id,v_status,v_order.id::text,v_attempt.id::text,
    v_amount,v_currency,true,jsonb_build_object(
      'transaction',p_charge#>>'{reference,transaction}',
      'gateway',p_charge#>>'{reference,gateway}',
      'payment',p_charge#>>'{reference,payment}',
      'created',p_charge#>>'{transaction,created}'
    )
  );
  v_result:=public.process_payment_event(v_event_id);
  SELECT to_jsonb(attempt) INTO v_after FROM public.payment_attempts attempt WHERE id=v_attempt.id;
  IF NOT EXISTS(
    SELECT 1 FROM public.admin_audit_log audit
    WHERE audit.action='payment_attempt_recovery' AND audit.target_id=v_attempt.id
      AND audit.after_data->>'external_charge_id'=v_charge_id
  ) THEN
    INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(p_actor_id,'payment_attempt_recovery',v_attempt.id,v_before,
      v_after||jsonb_build_object('event_id',v_event_id,'reason',btrim(p_reason),
        'processing_status',v_result->>'processing_status','processing_result',v_result->>'result'));
  END IF;
  RETURN v_result||jsonb_build_object('event_id',v_event_id,'external_status',v_status);
END $$;

REVOKE ALL ON FUNCTION public.recover_payment_attempt_charge(uuid,uuid,jsonb,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_payment_attempt_charge(uuid,uuid,jsonb,text)
TO service_role;

COMMIT;
