BEGIN;

ALTER TABLE public.orders
  ADD COLUMN quote_request_id uuid;

CREATE UNIQUE INDEX orders_provider_quote_request_unique
  ON public.orders(provider_id,quote_request_id)
  WHERE quote_request_id IS NOT NULL;

CREATE UNIQUE INDEX orders_direct_pending_unique
  ON public.orders(seeker_id,service_id)
  WHERE status = 'pending' AND service_id IS NOT NULL AND quote_request_id IS NULL;

DROP FUNCTION public.create_quoted_order(uuid,uuid,text,text,text,text,numeric,uuid);

CREATE FUNCTION public.create_quoted_order(
  p_conversation_id uuid,
  p_actor_id uuid,
  p_client_request_id uuid,
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
  v_order public.orders%rowtype;
  v_fee numeric;
BEGIN
  IF p_client_request_id IS NULL
     OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount < 1 OR p_amount > 1000000 OR p_amount <> round(p_amount,2) THEN
    RAISE EXCEPTION 'Invalid order amount or request identifier';
  END IF;
  IF char_length(btrim(coalesce(p_service_name_ar,''))) NOT BETWEEN 1 AND 200
     OR char_length(btrim(coalesce(p_service_name_en,''))) NOT BETWEEN 1 AND 200
     OR char_length(coalesce(p_service_description_ar,'')) > 5000
     OR char_length(coalesce(p_service_description_en,'')) > 5000 THEN
    RAISE EXCEPTION 'Invalid order details';
  END IF;

  SELECT conversation.* INTO v_conversation
  FROM public.conversations conversation
  WHERE conversation.id = p_conversation_id
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
    conversation_id,seeker_id,provider_id,service_id,quote_request_id,
    service_name_ar,service_name_en,service_description_ar,service_description_en,
    amount,platform_fee,provider_amount,currency,status
  ) VALUES (
    v_conversation.id,v_conversation.seeker_id,v_conversation.provider_id,p_service_id,p_client_request_id,
    btrim(p_service_name_ar),btrim(p_service_name_en),
    coalesce(p_service_description_ar,''),coalesce(p_service_description_en,''),
    p_amount,v_fee,p_amount-v_fee,'SAR','pending'
  )
  ON CONFLICT (provider_id,quote_request_id) WHERE quote_request_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    SELECT * INTO v_order FROM public.orders
    WHERE provider_id = v_conversation.provider_id
      AND quote_request_id = p_client_request_id;
    IF v_order.conversation_id IS DISTINCT FROM v_conversation.id
       OR v_order.seeker_id IS DISTINCT FROM v_conversation.seeker_id
       OR v_order.service_id IS DISTINCT FROM p_service_id
       OR v_order.service_name_ar IS DISTINCT FROM btrim(p_service_name_ar)
       OR v_order.service_name_en IS DISTINCT FROM btrim(p_service_name_en)
       OR v_order.service_description_ar IS DISTINCT FROM coalesce(p_service_description_ar,'')
       OR v_order.service_description_en IS DISTINCT FROM coalesce(p_service_description_en,'')
       OR v_order.amount IS DISTINCT FROM p_amount THEN
      RAISE EXCEPTION 'Quote request identifier was reused with different content';
    END IF;
  END IF;

  RETURN v_order.id;
END $$;

REVOKE ALL ON FUNCTION public.create_quoted_order(uuid,uuid,uuid,text,text,text,text,numeric,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_quoted_order(uuid,uuid,uuid,text,text,text,text,numeric,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_direct_order(p_service_id uuid,p_actor_id uuid)
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
  WHERE seeker_id = p_actor_id
    AND service_id = p_service_id
    AND status = 'pending'
    AND quote_request_id IS NULL
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
  )
  ON CONFLICT (seeker_id,service_id)
    WHERE status = 'pending' AND service_id IS NOT NULL AND quote_request_id IS NULL
    DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id FROM public.orders
    WHERE seeker_id = p_actor_id
      AND service_id = p_service_id
      AND status = 'pending'
      AND quote_request_id IS NULL;
  END IF;
  RETURN v_order_id;
END $$;

COMMIT;
