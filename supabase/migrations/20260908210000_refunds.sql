BEGIN;

ALTER TABLE public.orders
  ADD COLUMN refunded_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
  ADD COLUMN refund_status text NOT NULL DEFAULT 'none' CHECK (
    refund_status IN ('none','requested','approved','processing','partial','refunded','failed','unknown')
  );

CREATE TABLE public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  charge_id text NOT NULL,
  currency text NOT NULL CHECK (currency = 'SAR'),
  amount numeric(12,2) NOT NULL CHECK (amount >= 1),
  provider_amount numeric(12,2) NOT NULL CHECK (provider_amount >= 0),
  platform_amount numeric(12,2) NOT NULL CHECK (platform_amount >= 0),
  ledger_hold_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (ledger_hold_amount >= 0),
  order_status_before text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  status text NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested','approved','rejected','cancelled','processing','succeeded','failed','unknown')
  ),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 3 AND 1000),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(requester_id,client_request_id),
  CHECK (amount = provider_amount + platform_amount),
  CHECK (ledger_hold_amount <= provider_amount)
);
CREATE INDEX refund_requests_order_status_idx
  ON public.refund_requests(order_id,status,requested_at);
CREATE INDEX refund_requests_queue_idx
  ON public.refund_requests(status,requested_at);

CREATE TABLE public.refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_request_id uuid NOT NULL REFERENCES public.refund_requests(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','processing','succeeded','failed','unknown')),
  external_refund_id text,
  failure_reason text CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refund_attempts_external_unique
  ON public.refund_attempts(external_refund_id) WHERE external_refund_id IS NOT NULL;
CREATE UNIQUE INDEX refund_attempts_active_request_unique
  ON public.refund_attempts(refund_request_id)
  WHERE status IN ('creating','processing','unknown');

CREATE TABLE public.refund_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('checkout','webhook','reconciliation')),
  event_key text NOT NULL UNIQUE CHECK (char_length(event_key) BETWEEN 1 AND 300),
  external_refund_id text NOT NULL CHECK (char_length(external_refund_id) BETWEEN 3 AND 200),
  external_status text NOT NULL CHECK (char_length(external_status) BETWEEN 1 AND 64),
  claimed_refund_request_id text,
  claimed_refund_attempt_id text,
  linked_refund_request_id uuid REFERENCES public.refund_requests(id) ON DELETE RESTRICT,
  linked_refund_attempt_id uuid REFERENCES public.refund_attempts(id) ON DELETE RESTRICT,
  charge_id text,
  amount numeric(18,3),
  currency text,
  signature_valid boolean NOT NULL,
  reference_data jsonb NOT NULL DEFAULT '{}',
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending','processed','quarantined')),
  processing_result text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX refund_events_exception_idx ON public.refund_events(processing_status,received_at DESC);
CREATE INDEX refund_events_external_idx ON public.refund_events(external_refund_id,received_at DESC);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_requests,public.refund_attempts,public.refund_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.refund_requests TO authenticated;
GRANT ALL ON public.refund_requests,public.refund_attempts,public.refund_events TO service_role;
CREATE POLICY refund_request_participant_read ON public.refund_requests
  FOR SELECT TO authenticated USING (
    public.is_account_active((SELECT auth.uid())) AND EXISTS (
      SELECT 1 FROM public.orders order_record
      WHERE order_record.id = order_id AND (
        order_record.seeker_id = (SELECT auth.uid())
        OR public.owns_provider(order_record.provider_id)
        OR public.is_app_admin()
      )
    )
  );

ALTER TABLE public.ledger_entries DROP CONSTRAINT ledger_entries_entry_type_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'order_settlement','withdrawal_reservation','withdrawal_release','payout',
    'refund','refund_hold','refund_release','refund_settlement',
    'dispute_hold','dispute_release','adjustment'
  ));
ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN (
    'set_admin','verify_provider','set_service_active','review_withdrawal',
    'review_service','suspend_user','restore_user','support_ticket_status','refund_review'
  ));
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('message','order','withdrawal','support','refund'));

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,p_event_key text,p_type text,p_title_ar text,p_title_en text,
  p_body_ar text,p_body_en text,p_link text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_account_active(p_user_id) THEN RETURN NULL; END IF;
  IF char_length(coalesce(p_event_key,'')) NOT BETWEEN 1 AND 300
     OR p_type NOT IN ('message','order','withdrawal','support','refund')
     OR char_length(coalesce(p_title_ar,'')) NOT BETWEEN 1 AND 300
     OR char_length(coalesce(p_title_en,'')) NOT BETWEEN 1 AND 300
     OR char_length(coalesce(p_body_ar,'')) NOT BETWEEN 1 AND 1000
     OR char_length(coalesce(p_body_en,'')) NOT BETWEEN 1 AND 1000
     OR (p_link IS NOT NULL AND (
       char_length(p_link) NOT BETWEEN 1 AND 1000 OR left(p_link,1) <> '/'
       OR left(p_link,2) = '//' OR p_link ~ '[[:space:]]'
     )) THEN RAISE EXCEPTION 'Invalid notification'; END IF;
  INSERT INTO public.notifications(user_id,event_key,type,title_ar,title_en,body_ar,body_en,link)
    VALUES(p_user_id,p_event_key,p_type,p_title_ar,p_title_en,p_body_ar,p_body_en,p_link)
    ON CONFLICT(user_id,event_key) DO NOTHING RETURNING id INTO v_id;
  IF NOT FOUND THEN SELECT id INTO v_id FROM public.notifications WHERE user_id=p_user_id AND event_key=p_event_key; END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION public.refresh_order_refund_status(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.orders order_record SET refund_status = CASE
    WHEN order_record.refunded_amount = order_record.amount THEN 'refunded'
    WHEN EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id=p_order_id AND status='unknown') THEN 'unknown'
    WHEN EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id=p_order_id AND status='processing') THEN 'processing'
    WHEN EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id=p_order_id AND status='approved') THEN 'approved'
    WHEN EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id=p_order_id AND status='requested') THEN 'requested'
    WHEN order_record.refunded_amount > 0 THEN 'partial'
    WHEN EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id=p_order_id AND status='failed') THEN 'failed'
    ELSE 'none' END
  WHERE order_record.id=p_order_id;
END $$;
REVOKE ALL ON FUNCTION public.refresh_order_refund_status(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_order_refund_status(uuid) TO service_role;

CREATE FUNCTION public.request_order_refund(
  p_actor_id uuid,p_order_id uuid,p_client_request_id uuid,p_amount numeric,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
  v_existing public.refund_requests%rowtype;
  v_request public.refund_requests%rowtype;
  v_reserved numeric;
  v_provider_refund numeric;
  v_ledger_hold numeric;
  v_provider_user_id uuid;
  v_admin record;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_client_request_id IS NULL
     OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount < 1 OR p_amount <> round(p_amount,2)
     OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'Invalid refund request';
  END IF;
  SELECT * INTO v_existing FROM public.refund_requests
    WHERE requester_id=p_actor_id AND client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.reason IS DISTINCT FROM btrim(p_reason) THEN
      RAISE EXCEPTION 'Refund request ID was reused with different content';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.seeker_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Order is not eligible for a refund' USING ERRCODE='42501';
  END IF;
  IF v_order.status NOT IN ('paid','revision_requested','awaiting_confirmation','completed')
     OR v_order.tap_charge_id IS NULL THEN
    RAISE EXCEPTION 'Order is not eligible for a refund';
  END IF;
  PERFORM id FROM public.providers WHERE id=v_order.provider_id FOR UPDATE;
  SELECT coalesce(sum(amount),0) INTO v_reserved FROM public.refund_requests
    WHERE order_id=p_order_id AND status IN ('requested','approved','processing','succeeded','unknown');
  IF p_amount > v_order.amount-greatest(v_reserved,v_order.refunded_amount) THEN
    RAISE EXCEPTION 'Refund exceeds remaining charge amount';
  END IF;

  v_provider_refund := round(p_amount * v_order.provider_amount / v_order.amount,2);
  v_ledger_hold := CASE WHEN v_order.status='completed' THEN v_provider_refund ELSE 0 END;
  INSERT INTO public.refund_requests(
    order_id,requester_id,client_request_id,charge_id,currency,amount,
    provider_amount,platform_amount,ledger_hold_amount,order_status_before,reason
  ) VALUES (
    v_order.id,p_actor_id,p_client_request_id,v_order.tap_charge_id,v_order.currency,p_amount,
    v_provider_refund,p_amount-v_provider_refund,v_ledger_hold,v_order.status,btrim(p_reason)
  ) RETURNING * INTO v_request;
  IF v_ledger_hold > 0 THEN
    INSERT INTO public.ledger_entries(
      provider_id,order_id,entry_type,reference_key,available_delta,reserved_delta,note
    ) VALUES (
      v_order.provider_id,v_order.id,'refund_hold','refund:' || v_request.id || ':hold',
      -v_ledger_hold,v_ledger_hold,'Refund request reserve'
    );
  END IF;
  PERFORM public.refresh_order_refund_status(v_order.id);
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id=v_order.provider_id;
  PERFORM public.create_notification(v_provider_user_id,'refund:' || v_request.id || ':requested',
    'refund','طلب استرداد جديد','New refund request',
    'تم إنشاء طلب استرداد مرتبط بأحد طلباتك.','A refund request was created for one of your orders.',
    '/dashboard');
  FOR v_admin IN SELECT id FROM public.profiles WHERE is_admin AND public.is_account_active(id) LOOP
    PERFORM public.create_notification(v_admin.id,'refund:' || v_request.id || ':requested',
      'refund','طلب استرداد للمراجعة','Refund awaiting review',
      'يوجد طلب استرداد جديد يحتاج إلى مراجعة.','A new refund request requires review.',
      '/admin/refunds');
  END LOOP;
  RETURN to_jsonb(v_request);
END $$;

CREATE FUNCTION public.review_order_refund(
  p_actor_id uuid,p_refund_id uuid,p_decision text,p_note text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request public.refund_requests%rowtype;
  v_order public.orders%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin)
     OR p_decision NOT IN ('approved','rejected')
     OR char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid refund review';
  END IF;
  SELECT * INTO v_request FROM public.refund_requests WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request not found'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_request.order_id FOR UPDATE;
  PERFORM id FROM public.providers WHERE id=v_order.provider_id FOR UPDATE;
  IF v_request.status=p_decision THEN RETURN p_decision; END IF;
  IF v_request.status <> 'requested' THEN RAISE EXCEPTION 'Refund request already reviewed'; END IF;

  UPDATE public.refund_requests SET status=p_decision,reviewed_by=p_actor_id,
    review_note=btrim(p_note),reviewed_at=now(),updated_at=now() WHERE id=p_refund_id;
  IF p_decision='rejected' AND v_request.ledger_hold_amount > 0 THEN
    INSERT INTO public.ledger_entries(
      provider_id,order_id,entry_type,reference_key,available_delta,reserved_delta,note
    ) VALUES (
      v_order.provider_id,v_order.id,'refund_release','refund:' || v_request.id || ':release',
      v_request.ledger_hold_amount,-v_request.ledger_hold_amount,btrim(p_note)
    );
  END IF;
  PERFORM public.refresh_order_refund_status(v_order.id);
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(p_actor_id,'refund_review',p_refund_id,
      jsonb_build_object('status',v_request.status),
      jsonb_build_object('status',p_decision,'note',btrim(p_note)));
  PERFORM public.create_notification(v_request.requester_id,'refund:' || v_request.id || ':review:' || p_decision,
    'refund','مراجعة طلب الاسترداد','Refund request reviewed',
    'قرار مراجعة طلب الاسترداد: ' || p_decision,'Refund review decision: ' || p_decision,'/history');
  RETURN p_decision;
END $$;

CREATE FUNCTION public.cancel_order_refund(p_actor_id uuid,p_refund_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request public.refund_requests%rowtype;
  v_order public.orders%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_request FROM public.refund_requests WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_request.requester_id<>p_actor_id THEN
    RAISE EXCEPTION 'Refund request not found' USING ERRCODE='42501';
  END IF;
  IF v_request.status='cancelled' THEN RETURN 'cancelled'; END IF;
  IF v_request.status<>'requested' THEN RAISE EXCEPTION 'Refund request can no longer be cancelled'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_request.order_id FOR UPDATE;
  PERFORM id FROM public.providers WHERE id=v_order.provider_id FOR UPDATE;
  UPDATE public.refund_requests SET status='cancelled',updated_at=now(),completed_at=now() WHERE id=p_refund_id;
  IF v_request.ledger_hold_amount>0 THEN
    INSERT INTO public.ledger_entries(
      provider_id,order_id,entry_type,reference_key,available_delta,reserved_delta,note
    ) VALUES (
      v_order.provider_id,v_order.id,'refund_release','refund:' || v_request.id || ':cancel-release',
      v_request.ledger_hold_amount,-v_request.ledger_hold_amount,'Refund request cancelled by customer'
    );
  END IF;
  PERFORM public.refresh_order_refund_status(v_order.id);
  RETURN 'cancelled';
END $$;

CREATE FUNCTION public.begin_refund_attempt(p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_request public.refund_requests%rowtype;
  v_attempt public.refund_attempts%rowtype;
BEGIN
  SELECT * INTO v_request FROM public.refund_requests WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('approved','processing','unknown') THEN
    RAISE EXCEPTION 'Refund is not approved';
  END IF;
  SELECT * INTO v_attempt FROM public.refund_attempts WHERE refund_request_id=p_refund_id
    AND status IN ('creating','processing','unknown') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN to_jsonb(v_attempt) || jsonb_build_object('is_new',false); END IF;
  IF v_request.status <> 'approved' THEN RAISE EXCEPTION 'Refund attempt requires reconciliation'; END IF;
  INSERT INTO public.refund_attempts(refund_request_id,status) VALUES(p_refund_id,'creating') RETURNING * INTO v_attempt;
  UPDATE public.refund_requests SET status='processing',updated_at=now() WHERE id=p_refund_id;
  PERFORM public.refresh_order_refund_status(v_request.order_id);
  RETURN to_jsonb(v_attempt) || jsonb_build_object('is_new',true);
END $$;

CREATE FUNCTION public.record_refund_attempt_result(
  p_attempt_id uuid,p_external_refund_id text,p_status text,p_failure_reason text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_attempt public.refund_attempts%rowtype;
  v_request public.refund_requests%rowtype;
  v_order public.orders%rowtype;
  v_provider_user_id uuid;
BEGIN
  IF p_status NOT IN ('succeeded','failed','unknown')
     OR p_external_refund_id IS NULL OR char_length(p_external_refund_id) NOT BETWEEN 3 AND 200
     OR p_failure_reason IS NOT NULL AND char_length(p_failure_reason) > 1000 THEN
    RAISE EXCEPTION 'Invalid refund result';
  END IF;
  SELECT * INTO v_attempt FROM public.refund_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund attempt not found'; END IF;
  SELECT * INTO v_request FROM public.refund_requests WHERE id=v_attempt.refund_request_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id=v_request.order_id FOR UPDATE;
  PERFORM id FROM public.providers WHERE id=v_order.provider_id FOR UPDATE;
  IF v_attempt.status IN ('succeeded','failed') THEN
    IF v_attempt.status<>p_status OR v_attempt.external_refund_id IS DISTINCT FROM p_external_refund_id THEN
      RAISE EXCEPTION 'Refund result conflicts with terminal attempt';
    END IF;
    RETURN v_attempt.status;
  END IF;

  UPDATE public.refund_attempts SET status=p_status,external_refund_id=p_external_refund_id,
    failure_reason=nullif(btrim(coalesce(p_failure_reason,'')),''),updated_at=now() WHERE id=p_attempt_id;
  IF p_status='succeeded' THEN
    IF v_request.ledger_hold_amount > 0 THEN
      INSERT INTO public.ledger_entries(
        provider_id,order_id,entry_type,reference_key,reserved_delta,note
      ) VALUES (
        v_order.provider_id,v_order.id,'refund_settlement','refund:' || v_request.id || ':settlement',
        -v_request.ledger_hold_amount,'Refund completed'
      );
    END IF;
    UPDATE public.refund_requests SET status='succeeded',completed_at=now(),updated_at=now() WHERE id=v_request.id;
    UPDATE public.orders SET refunded_amount=refunded_amount+v_request.amount,
      status=CASE WHEN refunded_amount+v_request.amount=amount THEN 'refunded' ELSE status END
      WHERE id=v_order.id;
  ELSIF p_status='failed' THEN
    IF v_request.ledger_hold_amount > 0 THEN
      INSERT INTO public.ledger_entries(
        provider_id,order_id,entry_type,reference_key,available_delta,reserved_delta,note
      ) VALUES (
        v_order.provider_id,v_order.id,'refund_release','refund:' || v_request.id || ':failed-release',
        v_request.ledger_hold_amount,-v_request.ledger_hold_amount,
        coalesce(nullif(btrim(coalesce(p_failure_reason,'')),''),'Refund failed')
      );
    END IF;
    UPDATE public.refund_requests SET status='failed',completed_at=now(),updated_at=now() WHERE id=v_request.id;
  ELSE
    UPDATE public.refund_requests SET status='unknown',updated_at=now() WHERE id=v_request.id;
  END IF;
  PERFORM public.refresh_order_refund_status(v_order.id);
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id=v_order.provider_id;
  PERFORM public.create_notification(v_request.requester_id,'refund:' || v_request.id || ':status:' || p_status,
    'refund','تحديث الاسترداد','Refund updated','حالة طلب الاسترداد: ' || p_status,
    'Refund request status: ' || p_status,'/history');
  PERFORM public.create_notification(v_provider_user_id,'refund:' || v_request.id || ':status:' || p_status,
    'refund','تحديث الاسترداد','Refund updated','حالة طلب الاسترداد: ' || p_status,
    'Refund request status: ' || p_status,'/dashboard');
  RETURN p_status;
END $$;

CREATE FUNCTION public.record_refund_event(
  p_source text,p_event_key text,p_external_refund_id text,p_external_status text,
  p_claimed_refund_request_id text,p_claimed_refund_attempt_id text,p_charge_id text,
  p_amount numeric,p_currency text,p_signature_valid boolean,p_reference_data jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_event_id uuid;
  v_attempt_id uuid;
  v_request_id uuid;
BEGIN
  IF p_source NOT IN ('checkout','webhook','reconciliation')
     OR char_length(coalesce(p_event_key,'')) NOT BETWEEN 1 AND 300
     OR char_length(coalesce(p_external_refund_id,'')) NOT BETWEEN 3 AND 200
     OR char_length(coalesce(p_external_status,'')) NOT BETWEEN 1 AND 64
     OR p_reference_data IS NULL THEN RAISE EXCEPTION 'Invalid refund event'; END IF;
  INSERT INTO public.refund_events(
    source,event_key,external_refund_id,external_status,
    claimed_refund_request_id,claimed_refund_attempt_id,charge_id,amount,currency,
    signature_valid,reference_data
  ) VALUES (
    p_source,p_event_key,p_external_refund_id,p_external_status,
    nullif(p_claimed_refund_request_id,''),nullif(p_claimed_refund_attempt_id,''),p_charge_id,
    p_amount,p_currency,p_signature_valid,p_reference_data
  ) ON CONFLICT(event_key) DO NOTHING RETURNING id INTO v_event_id;
  IF NOT FOUND THEN SELECT id INTO v_event_id FROM public.refund_events WHERE event_key=p_event_key; RETURN v_event_id; END IF;

  SELECT attempt.id,attempt.refund_request_id INTO v_attempt_id,v_request_id
    FROM public.refund_attempts attempt
    WHERE (attempt.external_refund_id=p_external_refund_id OR attempt.id::text=p_claimed_refund_attempt_id)
      AND (attempt.external_refund_id IS NULL OR attempt.external_refund_id=p_external_refund_id)
    ORDER BY (attempt.external_refund_id=p_external_refund_id) DESC,attempt.created_at DESC LIMIT 1;
  IF v_request_id IS NOT NULL AND p_claimed_refund_request_id IS NOT NULL
     AND v_request_id::text<>p_claimed_refund_request_id THEN
    v_attempt_id:=NULL; v_request_id:=NULL;
  END IF;
  UPDATE public.refund_events SET linked_refund_request_id=v_request_id,
    linked_refund_attempt_id=v_attempt_id WHERE id=v_event_id;
  RETURN v_event_id;
END $$;

CREATE FUNCTION public.process_refund_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_event public.refund_events%rowtype;
  v_attempt public.refund_attempts%rowtype;
  v_request public.refund_requests%rowtype;
  v_result_status text;
BEGIN
  SELECT * INTO v_event FROM public.refund_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund event not found'; END IF;
  IF v_event.processing_status<>'pending' THEN
    RETURN jsonb_build_object('processing_status',v_event.processing_status,'result',v_event.processing_result);
  END IF;
  IF NOT v_event.signature_valid OR v_event.linked_refund_attempt_id IS NULL OR v_event.linked_refund_request_id IS NULL THEN
    UPDATE public.refund_events SET processing_status='quarantined',processing_result='unmatched refund event',processed_at=now() WHERE id=p_event_id;
    RETURN jsonb_build_object('processing_status','quarantined','result','unmatched refund event');
  END IF;
  SELECT * INTO v_attempt FROM public.refund_attempts WHERE id=v_event.linked_refund_attempt_id FOR UPDATE;
  SELECT * INTO v_request FROM public.refund_requests WHERE id=v_event.linked_refund_request_id FOR UPDATE;
  IF v_attempt.refund_request_id<>v_request.id OR v_event.external_refund_id !~ '^(re|rfnd)_[A-Za-z0-9_-]+$'
     OR v_event.amount IS DISTINCT FROM v_request.amount OR v_event.currency IS DISTINCT FROM v_request.currency
     OR v_event.charge_id IS DISTINCT FROM v_request.charge_id THEN
    UPDATE public.refund_events SET processing_status='quarantined',processing_result='refund details do not match request',processed_at=now() WHERE id=p_event_id;
    RETURN jsonb_build_object('processing_status','quarantined','result','refund details do not match request');
  END IF;
  v_result_status:=CASE
    WHEN v_event.external_status='REFUNDED' THEN 'succeeded'
    WHEN v_event.external_status IN ('DECLINED','FAILED','RESTRICTED','REJECTED') THEN 'failed'
    WHEN v_event.external_status IN ('PENDING','ACCEPTED','UNKNOWN','TIMED_OUT','TIMEDOUT') THEN 'unknown'
    ELSE NULL END;
  IF v_result_status IS NULL THEN
    UPDATE public.refund_events SET processing_status='quarantined',processing_result='unsupported refund status',processed_at=now() WHERE id=p_event_id;
    RETURN jsonb_build_object('processing_status','quarantined','result','unsupported refund status');
  END IF;
  PERFORM public.record_refund_attempt_result(v_attempt.id,v_event.external_refund_id,v_result_status,
    CASE WHEN v_result_status='failed' THEN 'Tap refund was not accepted' ELSE NULL END);
  UPDATE public.refund_events SET processing_status='processed',processing_result=v_result_status,processed_at=now() WHERE id=p_event_id;
  RETURN jsonb_build_object('processing_status','processed','result',v_result_status);
END $$;

CREATE FUNCTION public.prevent_progress_during_refund() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid;
BEGIN
  v_order_id := (to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='orders' THEN 'id' ELSE 'order_id' END)::uuid;
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id=v_order_id AND status IN ('requested','approved','processing','unknown')) THEN
    RAISE EXCEPTION 'Open refund prevents order progress';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block_delivery_during_refund BEFORE INSERT ON public.order_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_progress_during_refund();
CREATE TRIGGER block_confirmation_during_refund BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW WHEN (NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.prevent_progress_during_refund();
REVOKE ALL ON FUNCTION public.prevent_progress_during_refund() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prevent_deletion_with_open_refund() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.refund_requests refund
    JOIN public.orders order_record ON order_record.id=refund.order_id
    JOIN public.providers provider ON provider.id=order_record.provider_id
    WHERE refund.status IN ('requested','approved','processing','unknown')
      AND (order_record.seeker_id=NEW.user_id OR provider.user_id=NEW.user_id)
  ) THEN RAISE EXCEPTION 'Open refund prevents account deletion'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deletion_refund_guard BEFORE INSERT ON public.account_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_deletion_with_open_refund();
REVOKE ALL ON FUNCTION public.prevent_deletion_with_open_refund() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.export_user_data_snapshot_v5(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (public.export_user_data_snapshot_v4(p_actor_id) || jsonb_build_object(
    'schema_version',5,
    'refund_requests',coalesce((
      SELECT jsonb_agg(to_jsonb(refund) ORDER BY refund.requested_at,refund.id)
      FROM public.refund_requests refund
      JOIN public.orders order_record ON order_record.id=refund.order_id
      WHERE order_record.seeker_id=p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider
        WHERE provider.id=order_record.provider_id AND provider.user_id=p_actor_id
      )
    ),'[]'::jsonb),
    'refund_attempts',coalesce((
      SELECT jsonb_agg(to_jsonb(attempt) ORDER BY attempt.created_at,attempt.id)
      FROM public.refund_attempts attempt
      JOIN public.refund_requests refund ON refund.id=attempt.refund_request_id
      JOIN public.orders order_record ON order_record.id=refund.order_id
      WHERE order_record.seeker_id=p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider
        WHERE provider.id=order_record.provider_id AND provider.user_id=p_actor_id
      )
    ),'[]'::jsonb),
    'refund_events',coalesce((
      SELECT jsonb_agg(to_jsonb(event_record) ORDER BY event_record.received_at,event_record.id)
      FROM public.refund_events event_record
      JOIN public.refund_requests refund ON refund.id=event_record.linked_refund_request_id
      JOIN public.orders order_record ON order_record.id=refund.order_id
      WHERE order_record.seeker_id=p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider
        WHERE provider.id=order_record.provider_id AND provider.user_id=p_actor_id
      )
    ),'[]'::jsonb),
    'admin_actions_targeting_refunds',coalesce((
      SELECT jsonb_agg(to_jsonb(log) ORDER BY log.created_at,log.id)
      FROM public.admin_audit_log log
      JOIN public.refund_requests refund ON refund.id=log.target_id
      JOIN public.orders order_record ON order_record.id=refund.order_id
      WHERE order_record.seeker_id=p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider
        WHERE provider.id=order_record.provider_id AND provider.user_id=p_actor_id
      )
    ),'[]'::jsonb)
  ));
$$;

REVOKE ALL ON FUNCTION public.request_order_refund(uuid,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_order_refund(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_order_refund(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_refund_attempt(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_refund_attempt_result(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_refund_event(text,text,text,text,text,text,text,numeric,text,boolean,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.process_refund_event(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.export_user_data_snapshot_v5(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_order_refund(uuid,uuid,uuid,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_order_refund(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order_refund(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_refund_attempt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_refund_attempt_result(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_refund_event(text,text,text,text,text,text,text,numeric,text,boolean,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_refund_event(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.export_user_data_snapshot_v5(uuid) TO service_role;

COMMIT;
