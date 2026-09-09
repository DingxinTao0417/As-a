BEGIN;

ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN (
    'set_admin','verify_provider','set_service_active','review_withdrawal','review_service',
    'suspend_user','restore_user','support_ticket_status','refund_review','dispute_review',
    'payout_tracking','payment_event_relink'
  ));

CREATE FUNCTION public.relink_payment_event(
  p_actor_id uuid,
  p_event_id uuid,
  p_order_id uuid,
  p_attempt_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_event public.payment_events%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_before jsonb;
  v_result jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000
     OR NOT EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_event FROM public.payment_events WHERE id=p_event_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.payment_attempts WHERE id=p_attempt_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF v_event.id IS NULL OR v_attempt.id IS NULL OR v_order.id IS NULL
     OR v_event.processing_status <> 'quarantined'
     OR NOT v_event.signature_valid
     OR v_attempt.order_id IS DISTINCT FROM v_order.id
     OR v_attempt.external_charge_id IS NULL
     OR v_attempt.external_charge_id IS DISTINCT FROM v_event.external_charge_id
     OR v_attempt.amount IS DISTINCT FROM v_order.amount
     OR v_attempt.currency IS DISTINCT FROM v_order.currency
     OR v_event.amount IS DISTINCT FROM v_order.amount
     OR v_event.currency IS DISTINCT FROM v_order.currency
     OR v_order.currency <> 'SAR'
     OR (v_order.tap_charge_id IS NOT NULL AND v_order.tap_charge_id <> v_event.external_charge_id) THEN
    RAISE EXCEPTION 'Payment event cannot be linked to this attempt';
  END IF;

  v_before:=jsonb_build_object(
    'linked_order_id',v_event.linked_order_id,
    'linked_payment_attempt_id',v_event.linked_payment_attempt_id,
    'processing_status',v_event.processing_status,
    'processing_result',v_event.processing_result
  );
  UPDATE public.payment_events
  SET linked_order_id=v_order.id,
      linked_payment_attempt_id=v_attempt.id,
      processing_status='pending',
      processing_result='Relinked for review: '||btrim(p_reason),
      processed_at=NULL
  WHERE id=v_event.id;

  v_result:=public.process_payment_event(v_event.id);
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
  VALUES(
    p_actor_id,'payment_event_relink',v_event.id,v_before,
    jsonb_build_object(
      'order_id',v_order.id,'attempt_id',v_attempt.id,'reason',btrim(p_reason),
      'processing_result',v_result
    )
  );
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.relink_payment_event(uuid,uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.relink_payment_event(uuid,uuid,uuid,uuid,text)
  TO service_role;

COMMIT;
