BEGIN;

ALTER TABLE public.orders
  ADD COLUMN checkout_started_at timestamptz;

CREATE UNIQUE INDEX orders_tap_charge_id_unique
  ON public.orders(tap_charge_id)
  WHERE tap_charge_id IS NOT NULL;

CREATE FUNCTION public.create_quoted_order(
  p_conversation_id uuid,
  p_actor_id uuid,
  p_service_name_ar text,
  p_service_name_en text,
  p_service_description_ar text,
  p_service_description_en text,
  p_amount numeric,
  p_service_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_conversation public.conversations%rowtype;
  v_provider_user_id uuid;
  v_order_id uuid;
  v_fee numeric;
BEGIN
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount < 1 OR p_amount > 1000000 OR p_amount <> round(p_amount,2) THEN
    RAISE EXCEPTION 'Invalid order amount';
  END IF;
  IF char_length(btrim(coalesce(p_service_name_ar,''))) NOT BETWEEN 1 AND 200
     OR char_length(btrim(coalesce(p_service_name_en,''))) NOT BETWEEN 1 AND 200
     OR char_length(coalesce(p_service_description_ar,'')) > 5000
     OR char_length(coalesce(p_service_description_en,'')) > 5000 THEN
    RAISE EXCEPTION 'Invalid order details';
  END IF;

  SELECT c.* INTO v_conversation
    FROM public.conversations c
    WHERE c.id = p_conversation_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;

  SELECT user_id INTO v_provider_user_id
    FROM public.providers
    WHERE id = v_conversation.provider_id AND is_active;
  IF NOT FOUND OR p_actor_id IS NULL OR v_provider_user_id IS DISTINCT FROM p_actor_id
     OR v_conversation.seeker_id = p_actor_id
     OR NOT public.is_account_active(p_actor_id)
     OR NOT public.is_account_active(v_conversation.seeker_id) THEN
    RAISE EXCEPTION 'Provider cannot create this order' USING ERRCODE = '42501';
  END IF;

  IF p_service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.services
    WHERE id = p_service_id
      AND provider_id = v_conversation.provider_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Service unavailable';
  END IF;

  v_fee := round(p_amount * 0.15,2);
  INSERT INTO public.orders (
    conversation_id,seeker_id,provider_id,service_id,
    service_name_ar,service_name_en,service_description_ar,service_description_en,
    amount,platform_fee,provider_amount,currency,status
  ) VALUES (
    v_conversation.id,v_conversation.seeker_id,v_conversation.provider_id,p_service_id,
    btrim(p_service_name_ar),btrim(p_service_name_en),
    coalesce(p_service_description_ar,''),coalesce(p_service_description_en,''),
    p_amount,v_fee,p_amount-v_fee,'SAR','pending'
  ) RETURNING id INTO v_order_id;

  RETURN v_order_id;
END $$;

CREATE FUNCTION public.create_direct_order(p_service_id uuid,p_actor_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_service public.services%rowtype;
  v_provider_user_id uuid;
  v_conversation_id uuid;
  v_order_id uuid;
  v_fee numeric;
BEGIN
  PERFORM id FROM public.profiles
    WHERE id = p_actor_id AND deletion_requested_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;

  SELECT * INTO v_service FROM public.services
    WHERE id = p_service_id AND is_active
    FOR SHARE;
  IF NOT FOUND OR v_service.price_type <> 'fixed' THEN
    RAISE EXCEPTION 'Service requires a confirmed quote';
  END IF;
  SELECT user_id INTO v_provider_user_id
    FROM public.providers
    WHERE id = v_service.provider_id AND is_active;
  IF NOT FOUND OR v_provider_user_id = p_actor_id OR NOT public.is_account_active(v_provider_user_id) THEN
    RAISE EXCEPTION 'Invalid service provider';
  END IF;

  SELECT id INTO v_order_id FROM public.orders
    WHERE seeker_id = p_actor_id AND service_id = p_service_id AND status = 'pending'
    ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN RETURN v_order_id; END IF;

  INSERT INTO public.conversations(seeker_id,provider_id)
    VALUES(p_actor_id,v_service.provider_id)
    ON CONFLICT(seeker_id,provider_id) DO NOTHING;
  SELECT id INTO v_conversation_id FROM public.conversations
    WHERE seeker_id = p_actor_id AND provider_id = v_service.provider_id;

  v_fee := round(v_service.price * 0.15,2);
  INSERT INTO public.orders (
    conversation_id,seeker_id,provider_id,service_id,
    service_name_ar,service_name_en,service_description_ar,service_description_en,
    amount,platform_fee,provider_amount,currency,status
  ) VALUES (
    v_conversation_id,p_actor_id,v_service.provider_id,v_service.id,
    v_service.name_ar,v_service.name_en,
    coalesce(v_service.description_ar,''),coalesce(v_service.description_en,''),
    v_service.price,v_fee,v_service.price-v_fee,'SAR','pending'
  ) RETURNING id INTO v_order_id;

  RETURN v_order_id;
END $$;

CREATE FUNCTION public.begin_order_checkout(p_order_id uuid,p_actor_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR v_order.seeker_id IS DISTINCT FROM p_actor_id
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'Order cannot start checkout'; END IF;
  IF v_order.checkout_started_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.orders SET checkout_started_at = now() WHERE id = p_order_id;
  RETURN true;
END $$;

CREATE FUNCTION public.record_tap_charge(p_order_id uuid,p_actor_id uuid,p_charge_id text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR v_order.seeker_id IS DISTINCT FROM p_actor_id
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status <> 'pending' OR v_order.checkout_started_at IS NULL
     OR p_charge_id IS NULL OR p_charge_id !~ '^chg_[A-Za-z0-9_-]+$'
     OR (v_order.tap_charge_id IS NOT NULL AND v_order.tap_charge_id <> p_charge_id) THEN
    RAISE EXCEPTION 'Charge cannot be recorded';
  END IF;
  UPDATE public.orders SET tap_charge_id = p_charge_id WHERE id = p_order_id;
END $$;

CREATE FUNCTION public.settle_tap_charge(
  p_order_id uuid,
  p_charge_id text,
  p_transaction_id text,
  p_amount numeric,
  p_currency text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF p_charge_id IS NULL OR p_charge_id !~ '^chg_[A-Za-z0-9_-]+$'
     OR p_amount IS DISTINCT FROM v_order.amount
     OR p_currency IS DISTINCT FROM v_order.currency
     OR p_currency <> 'SAR'
     OR (v_order.tap_charge_id IS NOT NULL AND v_order.tap_charge_id <> p_charge_id) THEN
    RAISE EXCEPTION 'Payment does not match order';
  END IF;
  IF v_order.status IN ('paid','awaiting_confirmation','completed')
     AND v_order.tap_charge_id = p_charge_id THEN
    RETURN v_order.status;
  END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'Order cannot accept payment'; END IF;
  UPDATE public.orders
    SET status = 'paid',
        tap_charge_id = p_charge_id,
        tap_transaction_id = coalesce(nullif(p_transaction_id,''),p_charge_id),
        paid_at = now()
    WHERE id = p_order_id;
  RETURN 'paid';
END $$;

CREATE FUNCTION public.complete_order(p_order_id uuid,p_actor_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.providers
    WHERE id = v_order.provider_id AND user_id = p_actor_id
  ) OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status IN ('awaiting_confirmation','completed') THEN RETURN v_order.status; END IF;
  IF v_order.status <> 'paid' THEN RAISE EXCEPTION 'Only paid orders can be delivered'; END IF;
  UPDATE public.orders
    SET status = 'awaiting_confirmation',completed_at = now()
    WHERE id = p_order_id;
  RETURN 'awaiting_confirmation';
END $$;

CREATE FUNCTION public.confirm_order(p_order_id uuid,p_actor_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR v_order.seeker_id IS DISTINCT FROM p_actor_id
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status = 'completed' THEN RETURN 'completed'; END IF;
  IF v_order.status <> 'awaiting_confirmation' THEN
    RAISE EXCEPTION 'Order is not ready for confirmation';
  END IF;
  INSERT INTO public.service_history(
    order_id,seeker_id,provider_id,service_id,
    service_name_ar,service_name_en,service_description_ar,service_description_en,
    amount,status,completed_at
  ) VALUES (
    v_order.id,v_order.seeker_id,v_order.provider_id,v_order.service_id,
    v_order.service_name_ar,v_order.service_name_en,
    v_order.service_description_ar,v_order.service_description_en,
    v_order.amount,'completed',now()
  );
  UPDATE public.orders SET status = 'completed' WHERE id = p_order_id;
  UPDATE public.providers
    SET completed_projects = completed_projects + 1
    WHERE id = v_order.provider_id;
  RETURN 'completed';
END $$;

CREATE FUNCTION public.cancel_pending_order(p_order_id uuid,p_actor_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR (
    v_order.seeker_id IS DISTINCT FROM p_actor_id
    AND NOT EXISTS (
      SELECT 1 FROM public.providers
      WHERE id = v_order.provider_id AND user_id = p_actor_id
    )
  ) OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF v_order.status <> 'pending' OR v_order.checkout_started_at IS NOT NULL
     OR v_order.tap_charge_id IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout has started or order is no longer pending';
  END IF;
  UPDATE public.orders SET status = 'cancelled',cancelled_at = now()
    WHERE id = p_order_id;
  RETURN 'cancelled';
END $$;

CREATE FUNCTION public.request_provider_withdrawal(
  p_provider_id uuid,
  p_actor_id uuid,
  p_amount numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider public.providers%rowtype;
  v_earned numeric;
  v_reserved numeric;
  v_request_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount < 1 OR p_amount > 1000000 OR p_amount <> round(p_amount,2) THEN
    RAISE EXCEPTION 'Invalid withdrawal amount';
  END IF;

  SELECT * INTO v_provider FROM public.providers
    WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR v_provider.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  IF NOT public.is_account_active(p_actor_id) THEN RAISE EXCEPTION 'Account unavailable'; END IF;
  IF v_provider.tap_destination_id IS NULL
     OR v_provider.tap_destination_id LIKE 'tap_placeholder_%'
     OR v_provider.tap_onboarding_completed IS DISTINCT FROM true
     OR v_provider.tap_account_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Payment account verification required';
  END IF;

  SELECT coalesce(sum(provider_amount),0) INTO v_earned
    FROM public.orders
    WHERE provider_id = p_provider_id AND status = 'completed';
  SELECT coalesce(sum(amount),0) INTO v_reserved
    FROM public.withdrawal_requests
    WHERE provider_id = p_provider_id
      AND status IN ('pending','approved','completed');
  IF p_amount > v_earned-v_reserved THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;

  INSERT INTO public.withdrawal_requests(provider_id,amount,status)
    VALUES(p_provider_id,p_amount,'pending')
    RETURNING id INTO v_request_id;
  RETURN v_request_id;
END $$;

REVOKE ALL ON FUNCTION public.create_quoted_order(uuid,uuid,text,text,text,text,numeric,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_direct_order(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_order_checkout(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_tap_charge(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_tap_charge(uuid,text,text,numeric,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_order(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_order(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_pending_order(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_provider_withdrawal(uuid,uuid,numeric)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.create_quoted_order(uuid,uuid,text,text,text,text,numeric,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_direct_order(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_order_checkout(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_tap_charge(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_tap_charge(uuid,text,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_order(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_order(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_pending_order(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_provider_withdrawal(uuid,uuid,numeric) TO service_role;

COMMIT;
