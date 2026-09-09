BEGIN;

CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  withdrawal_request_id uuid REFERENCES public.withdrawal_requests(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN (
    'order_settlement','withdrawal_reservation','withdrawal_release',
    'payout','refund','dispute_hold','dispute_release','adjustment'
  )),
  reference_key text NOT NULL UNIQUE CHECK (char_length(reference_key) BETWEEN 1 AND 300),
  available_delta numeric(12,2) NOT NULL DEFAULT 0,
  reserved_delta numeric(12,2) NOT NULL DEFAULT 0,
  paid_delta numeric(12,2) NOT NULL DEFAULT 0,
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (available_delta <> 0 OR reserved_delta <> 0 OR paid_delta <> 0),
  CHECK (available_delta = round(available_delta,2)),
  CHECK (reserved_delta = round(reserved_delta,2)),
  CHECK (paid_delta = round(paid_delta,2))
);

CREATE INDEX ledger_entries_provider_created_idx
  ON public.ledger_entries(provider_id,created_at,id);
CREATE INDEX ledger_entries_order_idx
  ON public.ledger_entries(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX ledger_entries_withdrawal_idx
  ON public.ledger_entries(withdrawal_request_id) WHERE withdrawal_request_id IS NOT NULL;

CREATE FUNCTION public.sync_withdrawal_ledger() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    INSERT INTO public.ledger_entries(
      provider_id,withdrawal_request_id,entry_type,reference_key,
      available_delta,reserved_delta,note
    ) VALUES (
      NEW.provider_id,NEW.id,'withdrawal_release',
      'withdrawal:' || NEW.id || ':release',NEW.amount,-NEW.amount,NEW.notes
    ) ON CONFLICT(reference_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- Completed orders are the only existing source that can be reconstructed from
-- the current schema without guessing an external transfer result.
INSERT INTO public.ledger_entries(
  provider_id,order_id,entry_type,reference_key,available_delta,note,created_at
)
SELECT
  provider_id,id,'order_settlement','order:' || id || ':settlement',provider_amount,
  'Backfilled from a completed order',coalesce(completed_at,created_at)
FROM public.orders
WHERE status = 'completed';

-- Existing withdrawal states do not prove that Tap paid the destination. Keep
-- all non-rejected amounts reserved until an adoption review supplies evidence.
INSERT INTO public.ledger_entries(
  provider_id,withdrawal_request_id,entry_type,reference_key,
  available_delta,reserved_delta,note,created_at
)
SELECT
  provider_id,id,'withdrawal_reservation','withdrawal:' || id || ':reservation',
  -amount,amount,'Backfilled as reserved; external payout result requires review',requested_at
FROM public.withdrawal_requests
WHERE status IN ('pending','approved','completed');

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ledger_entries FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.ledger_entries TO service_role;

CREATE TRIGGER withdrawal_ledger_sync
AFTER UPDATE OF status ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_withdrawal_ledger();
REVOKE ALL ON FUNCTION public.sync_withdrawal_ledger() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_provider_balance(p_provider_id uuid,p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_available numeric;
  v_reserved numeric;
  v_paid numeric;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.providers p
       WHERE p.id = p_provider_id AND (
         p.user_id = p_actor_id OR EXISTS (
           SELECT 1 FROM public.profiles WHERE id = p_actor_id AND is_admin
         )
       )
     ) THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;

  SELECT
    coalesce(sum(available_delta),0),
    coalesce(sum(reserved_delta),0),
    coalesce(sum(paid_delta),0)
  INTO v_available,v_reserved,v_paid
  FROM public.ledger_entries
  WHERE provider_id = p_provider_id;

  RETURN jsonb_build_object(
    'available',v_available,
    'reserved',v_reserved,
    'paid',v_paid,
    'total_earned',v_available + v_reserved + v_paid
  );
END $$;

CREATE OR REPLACE FUNCTION public.confirm_order(p_order_id uuid,p_actor_id uuid)
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
  INSERT INTO public.ledger_entries(
    provider_id,order_id,entry_type,reference_key,available_delta
  ) VALUES (
    v_order.provider_id,v_order.id,'order_settlement',
    'order:' || v_order.id || ':settlement',v_order.provider_amount
  );
  UPDATE public.orders SET status = 'completed' WHERE id = p_order_id;
  UPDATE public.providers
    SET completed_projects = completed_projects + 1
    WHERE id = v_order.provider_id;
  RETURN 'completed';
END $$;

CREATE OR REPLACE FUNCTION public.request_provider_withdrawal(
  p_provider_id uuid,
  p_actor_id uuid,
  p_amount numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider public.providers%rowtype;
  v_available numeric;
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

  SELECT coalesce(sum(available_delta),0) INTO v_available
    FROM public.ledger_entries WHERE provider_id = p_provider_id;
  IF p_amount > v_available THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;

  INSERT INTO public.withdrawal_requests(provider_id,amount,status)
    VALUES(p_provider_id,p_amount,'pending')
    RETURNING id INTO v_request_id;
  INSERT INTO public.ledger_entries(
    provider_id,withdrawal_request_id,entry_type,reference_key,
    available_delta,reserved_delta
  ) VALUES (
    p_provider_id,v_request_id,'withdrawal_reservation',
    'withdrawal:' || v_request_id || ':reservation',-p_amount,p_amount
  );
  RETURN v_request_id;
END $$;

CREATE FUNCTION public.review_withdrawal_request(
  p_actor_id uuid,
  p_request_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request public.withdrawal_requests%rowtype;
  v_before jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_actor_id AND is_admin AND deletion_requested_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved','rejected')
     OR p_note IS NOT NULL AND char_length(p_note) > 1000
     OR p_decision = 'rejected' AND char_length(btrim(coalesce(p_note,''))) < 3 THEN
    RAISE EXCEPTION 'Invalid withdrawal decision';
  END IF;

  SELECT * INTO v_request FROM public.withdrawal_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
  IF v_request.status = p_decision THEN RETURN p_decision; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'Withdrawal already processed'; END IF;

  v_before := jsonb_build_object('status',v_request.status,'notes',v_request.notes);
  IF p_decision = 'rejected' THEN
    INSERT INTO public.ledger_entries(
      provider_id,withdrawal_request_id,entry_type,reference_key,
      available_delta,reserved_delta,note
    ) VALUES (
      v_request.provider_id,v_request.id,'withdrawal_release',
      'withdrawal:' || v_request.id || ':release',
      v_request.amount,-v_request.amount,nullif(btrim(coalesce(p_note,'')),'')
    );
  END IF;

  UPDATE public.withdrawal_requests
    SET status = p_decision,
        notes = nullif(btrim(coalesce(p_note,'')),''),
        processed_at = now()
    WHERE id = p_request_id;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(
      p_actor_id,'review_withdrawal',p_request_id,v_before,
      jsonb_build_object(
        'status',p_decision,
        'notes',nullif(btrim(coalesce(p_note,'')),'')
      )
    );
  RETURN p_decision;
END $$;

REVOKE ALL ON FUNCTION public.get_provider_balance(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_withdrawal_request(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_balance(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_withdrawal_request(uuid,uuid,text,text) TO service_role;

COMMIT;
