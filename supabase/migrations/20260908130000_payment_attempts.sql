BEGIN;

CREATE TABLE public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'tap' CHECK (provider = 'tap'),
  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating','pending','captured','failed','cancelled','expired','unknown')),
  external_status text,
  external_charge_id text,
  external_transaction_id text,
  amount numeric(12,2) NOT NULL CHECK (amount >= 1 AND amount <= 1000000),
  currency text NOT NULL CHECK (currency = 'SAR'),
  checkout_url text,
  failure_reason text CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 1000),
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX payment_attempts_external_charge_unique
  ON public.payment_attempts(provider,external_charge_id)
  WHERE external_charge_id IS NOT NULL;
CREATE UNIQUE INDEX payment_attempts_active_order_unique
  ON public.payment_attempts(order_id)
  WHERE status IN ('creating','pending','captured','unknown');
CREATE INDEX payment_attempts_order_created_idx
  ON public.payment_attempts(order_id,created_at DESC);

-- Preserve known legacy charges as attempts. A pending order with an existing
-- charge stays unknown until Tap confirms its external state.
INSERT INTO public.payment_attempts(
  order_id,status,external_status,external_charge_id,external_transaction_id,
  amount,currency,last_checked_at,created_at,updated_at
)
SELECT
  id,
  CASE WHEN status IN ('paid','awaiting_confirmation','completed') THEN 'captured' ELSE 'unknown' END,
  CASE WHEN status IN ('paid','awaiting_confirmation','completed') THEN 'CAPTURED' ELSE NULL END,
  tap_charge_id,tap_transaction_id,amount,currency,paid_at,coalesce(checkout_started_at,created_at),now()
FROM public.orders
WHERE tap_charge_id IS NOT NULL;

CREATE TABLE public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'tap' CHECK (provider = 'tap'),
  source text NOT NULL CHECK (source IN ('checkout','webhook','reconciliation')),
  event_key text NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 300),
  external_charge_id text NOT NULL CHECK (char_length(external_charge_id) BETWEEN 1 AND 200),
  external_status text NOT NULL CHECK (char_length(external_status) BETWEEN 1 AND 64),
  claimed_order_id text,
  claimed_payment_attempt_id text,
  linked_order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  linked_payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  amount numeric(18,3),
  currency text,
  signature_valid boolean NOT NULL,
  reference_data jsonb NOT NULL DEFAULT '{}',
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processed','quarantined')),
  processing_result text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider,event_key)
);

CREATE INDEX payment_events_exceptions_idx
  ON public.payment_events(processing_status,received_at DESC);
CREATE INDEX payment_events_charge_idx
  ON public.payment_events(provider,external_charge_id,received_at DESC);

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_attempts,public.payment_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.payment_attempts,public.payment_events TO service_role;

CREATE FUNCTION public.begin_payment_attempt(p_order_id uuid,p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR v_order.seeker_id IS DISTINCT FROM p_actor_id
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'Order cannot start checkout'; END IF;

  SELECT * INTO v_attempt
    FROM public.payment_attempts
    WHERE order_id = p_order_id
      AND status IN ('creating','pending','captured','unknown')
    ORDER BY created_at DESC,id DESC
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'id',v_attempt.id,
      'status',v_attempt.status,
      'external_charge_id',v_attempt.external_charge_id,
      'checkout_url',v_attempt.checkout_url,
      'is_new',false
    );
  END IF;

  INSERT INTO public.payment_attempts(order_id,amount,currency)
    VALUES(v_order.id,v_order.amount,v_order.currency)
    RETURNING * INTO v_attempt;
  UPDATE public.orders SET checkout_started_at = now() WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'id',v_attempt.id,
    'status',v_attempt.status,
    'external_charge_id',NULL,
    'checkout_url',NULL,
    'is_new',true
  );
END $$;

CREATE FUNCTION public.get_order_payment_attempt(p_order_id uuid,p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_attempt public.payment_attempts%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.orders
       WHERE id = p_order_id AND seeker_id = p_actor_id
     ) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT * INTO v_attempt
    FROM public.payment_attempts
    WHERE order_id = p_order_id
    ORDER BY
      CASE WHEN status IN ('creating','pending','captured','unknown') THEN 0 ELSE 1 END,
      created_at DESC,id DESC
    LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'id',v_attempt.id,
    'status',v_attempt.status,
    'external_charge_id',v_attempt.external_charge_id,
    'checkout_url',v_attempt.checkout_url
  );
END $$;

CREATE FUNCTION public.record_tap_charge_attempt(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_charge_id text,
  p_external_status text,
  p_transaction_id text,
  p_checkout_url text,
  p_amount numeric,
  p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_status text;
BEGIN
  SELECT * INTO v_attempt FROM public.payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment attempt not found'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_attempt.order_id FOR UPDATE;
  IF p_actor_id IS NULL OR v_order.seeker_id IS DISTINCT FROM p_actor_id
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Payment attempt not found';
  END IF;
  IF p_charge_id IS NULL OR p_charge_id !~ '^chg_[A-Za-z0-9_-]+$'
     OR p_amount IS DISTINCT FROM v_attempt.amount
     OR p_currency IS DISTINCT FROM v_attempt.currency
     OR (v_attempt.external_charge_id IS NOT NULL AND v_attempt.external_charge_id <> p_charge_id) THEN
    RAISE EXCEPTION 'Charge does not match payment attempt';
  END IF;
  IF p_external_status IS NULL OR char_length(p_external_status) > 64
     OR p_checkout_url IS NOT NULL AND char_length(p_checkout_url) > 4000 THEN
    RAISE EXCEPTION 'Invalid charge response';
  END IF;

  v_status := CASE p_external_status
    WHEN 'CAPTURED' THEN 'captured'
    WHEN 'INITIATED' THEN 'pending'
    WHEN 'AUTHORIZED' THEN 'pending'
    WHEN 'FAILED' THEN 'failed'
    WHEN 'DECLINED' THEN 'failed'
    WHEN 'RESTRICTED' THEN 'failed'
    WHEN 'VOID' THEN 'cancelled'
    WHEN 'CANCELLED' THEN 'cancelled'
    ELSE 'unknown'
  END;

  UPDATE public.payment_attempts
    SET external_charge_id = p_charge_id,
        external_transaction_id = nullif(p_transaction_id,''),
        external_status = p_external_status,
        checkout_url = coalesce(p_checkout_url,checkout_url),
        status = CASE WHEN status = 'captured' THEN status ELSE v_status END,
        last_checked_at = now(),
        updated_at = now()
    WHERE id = p_attempt_id
    RETURNING * INTO v_attempt;

  RETURN jsonb_build_object(
    'id',v_attempt.id,
    'status',v_attempt.status,
    'external_charge_id',v_attempt.external_charge_id,
    'checkout_url',v_attempt.checkout_url
  );
END $$;

CREATE FUNCTION public.record_payment_event(
  p_source text,
  p_event_key text,
  p_charge_id text,
  p_external_status text,
  p_claimed_order_id text,
  p_claimed_attempt_id text,
  p_amount numeric,
  p_currency text,
  p_signature_valid boolean,
  p_reference_data jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_event_id uuid;
  v_attempt_id uuid;
  v_order_id uuid;
BEGIN
  IF p_source NOT IN ('checkout','webhook','reconciliation')
     OR char_length(coalesce(p_event_key,'')) NOT BETWEEN 1 AND 300
     OR char_length(coalesce(p_charge_id,'')) NOT BETWEEN 1 AND 200
     OR char_length(coalesce(p_external_status,'')) NOT BETWEEN 1 AND 64
     OR p_reference_data IS NULL THEN
    RAISE EXCEPTION 'Invalid payment event';
  END IF;

  INSERT INTO public.payment_events(
    source,event_key,external_charge_id,external_status,
    claimed_order_id,claimed_payment_attempt_id,amount,currency,
    signature_valid,reference_data
  ) VALUES (
    p_source,p_event_key,p_charge_id,p_external_status,
    nullif(p_claimed_order_id,''),nullif(p_claimed_attempt_id,''),p_amount,p_currency,
    p_signature_valid,p_reference_data
  ) ON CONFLICT(provider,event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF NOT FOUND THEN
    SELECT id INTO v_event_id FROM public.payment_events
      WHERE provider = 'tap' AND event_key = p_event_key;
    RETURN v_event_id;
  END IF;

  SELECT pa.id,pa.order_id INTO v_attempt_id,v_order_id
    FROM public.payment_attempts pa
    WHERE (
      pa.external_charge_id = p_charge_id
      OR pa.id::text = p_claimed_attempt_id
    )
      AND (p_claimed_order_id IS NULL OR pa.order_id::text = p_claimed_order_id)
      AND (pa.external_charge_id IS NULL OR pa.external_charge_id = p_charge_id)
    ORDER BY (pa.external_charge_id = p_charge_id) DESC,pa.created_at DESC
    LIMIT 1;

  IF v_order_id IS NULL AND p_claimed_order_id IS NOT NULL THEN
    SELECT o.id INTO v_order_id FROM public.orders o
      WHERE o.id::text = p_claimed_order_id
        AND (o.tap_charge_id IS NULL OR o.tap_charge_id = p_charge_id);
    IF FOUND THEN
      SELECT pa.id INTO v_attempt_id FROM public.payment_attempts pa
        WHERE pa.order_id = v_order_id
          AND (pa.external_charge_id IS NULL OR pa.external_charge_id = p_charge_id)
          AND pa.status IN ('creating','pending','captured','unknown')
        ORDER BY pa.created_at DESC,id DESC LIMIT 1;
    END IF;
  END IF;

  UPDATE public.payment_events
    SET linked_order_id = v_order_id,
        linked_payment_attempt_id = v_attempt_id
    WHERE id = v_event_id;
  RETURN v_event_id;
END $$;

CREATE FUNCTION public.process_payment_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_event public.payment_events%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_attempt_status text;
  v_result text;
BEGIN
  SELECT * INTO v_event FROM public.payment_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment event not found'; END IF;
  IF v_event.processing_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'processing_status',v_event.processing_status,
      'result',v_event.processing_result,
      'order_status',NULL
    );
  END IF;

  IF NOT v_event.signature_valid OR v_event.linked_order_id IS NULL
     OR v_event.linked_payment_attempt_id IS NULL THEN
    UPDATE public.payment_events
      SET processing_status = 'quarantined',processing_result = 'unmatched payment event',processed_at = now()
      WHERE id = p_event_id;
    RETURN jsonb_build_object('processing_status','quarantined','result','unmatched payment event','order_status',NULL);
  END IF;

  SELECT * INTO v_attempt FROM public.payment_attempts
    WHERE id = v_event.linked_payment_attempt_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders
    WHERE id = v_event.linked_order_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.order_id IS DISTINCT FROM v_order.id
     OR v_event.external_charge_id !~ '^chg_[A-Za-z0-9_-]+$'
     OR v_event.amount IS DISTINCT FROM v_order.amount
     OR v_event.currency IS DISTINCT FROM v_order.currency
     OR v_event.currency <> 'SAR'
     OR (v_attempt.external_charge_id IS NOT NULL
         AND v_attempt.external_charge_id <> v_event.external_charge_id) THEN
    UPDATE public.payment_events
      SET processing_status = 'quarantined',processing_result = 'payment details do not match order',processed_at = now()
      WHERE id = p_event_id;
    RETURN jsonb_build_object('processing_status','quarantined','result','payment details do not match order','order_status',v_order.status);
  END IF;

  v_attempt_status := CASE v_event.external_status
    WHEN 'CAPTURED' THEN 'captured'
    WHEN 'INITIATED' THEN 'pending'
    WHEN 'AUTHORIZED' THEN 'pending'
    WHEN 'FAILED' THEN 'failed'
    WHEN 'DECLINED' THEN 'failed'
    WHEN 'RESTRICTED' THEN 'failed'
    WHEN 'VOID' THEN 'cancelled'
    WHEN 'CANCELLED' THEN 'cancelled'
    ELSE 'unknown'
  END;

  UPDATE public.payment_attempts
    SET external_charge_id = v_event.external_charge_id,
        external_transaction_id = coalesce(
          nullif(v_event.reference_data->>'transaction',''),external_transaction_id
        ),
        external_status = v_event.external_status,
        status = CASE WHEN status = 'captured' THEN status ELSE v_attempt_status END,
        last_checked_at = now(),updated_at = now()
    WHERE id = v_attempt.id;

  IF v_event.external_status = 'CAPTURED' THEN
    IF v_order.tap_charge_id IS NOT NULL
       AND v_order.tap_charge_id <> v_event.external_charge_id THEN
      UPDATE public.payment_events
        SET processing_status = 'quarantined',processing_result = 'another charge already settled',processed_at = now()
        WHERE id = p_event_id;
      RETURN jsonb_build_object('processing_status','quarantined','result','another charge already settled','order_status',v_order.status);
    END IF;

    IF v_order.status = 'pending' THEN
      UPDATE public.orders
        SET status = 'paid',
            tap_charge_id = v_event.external_charge_id,
            tap_transaction_id = coalesce(
              nullif(v_event.reference_data->>'transaction',''),v_event.external_charge_id
            ),
            paid_at = now()
        WHERE id = v_order.id;
      v_order.status := 'paid';
      v_result := 'charge settled';
    ELSIF v_order.status IN ('paid','awaiting_confirmation','completed')
          AND v_order.tap_charge_id = v_event.external_charge_id THEN
      v_result := 'charge already settled';
    ELSE
      UPDATE public.payment_events
        SET processing_status = 'quarantined',processing_result = 'order cannot accept captured charge',processed_at = now()
        WHERE id = p_event_id;
      RETURN jsonb_build_object('processing_status','quarantined','result','order cannot accept captured charge','order_status',v_order.status);
    END IF;
  ELSE
    v_result := CASE
      WHEN v_attempt.status = 'captured' THEN 'terminal charge status preserved'
      ELSE 'charge status recorded'
    END;
  END IF;

  UPDATE public.payment_events
    SET processing_status = 'processed',processing_result = v_result,processed_at = now()
    WHERE id = p_event_id;
  RETURN jsonb_build_object('processing_status','processed','result',v_result,'order_status',v_order.status);
END $$;

REVOKE ALL ON FUNCTION public.begin_payment_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_order_payment_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_tap_charge_attempt(uuid,uuid,text,text,text,text,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_payment_event(text,text,text,text,text,text,numeric,text,boolean,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.process_payment_event(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_payment_attempt(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_order_payment_attempt(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_tap_charge_attempt(uuid,uuid,text,text,text,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_event(text,text,text,text,text,text,numeric,text,boolean,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_payment_event(uuid) TO service_role;

COMMIT;
