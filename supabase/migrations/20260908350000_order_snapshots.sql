BEGIN;

ALTER TABLE public.orders
  ADD COLUMN service_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.orders order_row
SET
  service_snapshot = jsonb_build_object(
    'schema_version',1,
    'source','legacy_order_fields',
    'service_id',order_row.service_id,
    'name_ar',order_row.service_name_ar,
    'name_en',order_row.service_name_en,
    'description_ar',order_row.service_description_ar,
    'description_en',order_row.service_description_en
  ),
  pricing_snapshot = jsonb_build_object(
    'schema_version',1,
    'source','legacy_order_fields',
    'rule_version','legacy-commission-unverified',
    'gross_amount',order_row.amount,
    'platform_fee',order_row.platform_fee,
    'provider_amount',order_row.provider_amount,
    'currency',order_row.currency,
    'tax_amount',NULL,
    'unit_price',NULL,
    'quantity',NULL
  );

ALTER TABLE public.orders
  ADD CONSTRAINT orders_service_snapshot_matches_columns CHECK (
    service_snapshot ?& ARRAY['schema_version','source','name_ar','name_en','description_ar','description_en']
    AND service_snapshot->>'name_ar' IS NOT DISTINCT FROM service_name_ar
    AND service_snapshot->>'name_en' IS NOT DISTINCT FROM service_name_en
    AND service_snapshot->>'description_ar' IS NOT DISTINCT FROM service_description_ar
    AND service_snapshot->>'description_en' IS NOT DISTINCT FROM service_description_en
  ),
  ADD CONSTRAINT orders_pricing_snapshot_matches_columns CHECK (coalesce(
    jsonb_typeof(pricing_snapshot->'gross_amount')='number'
    AND jsonb_typeof(pricing_snapshot->'platform_fee')='number'
    AND jsonb_typeof(pricing_snapshot->'provider_amount')='number'
    AND pricing_snapshot->>'currency'=currency
    AND (pricing_snapshot->>'gross_amount')::numeric=amount
    AND (pricing_snapshot->>'platform_fee')::numeric=platform_fee
    AND (pricing_snapshot->>'provider_amount')::numeric=provider_amount,
    false
  ));

CREATE FUNCTION public.initialize_order_snapshots()
RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.service_snapshot='{}'::jsonb THEN
    NEW.service_snapshot:=jsonb_build_object(
      'schema_version',1,
      'source','legacy_order_fields',
      'service_id',NEW.service_id,
      'name_ar',NEW.service_name_ar,
      'name_en',NEW.service_name_en,
      'description_ar',NEW.service_description_ar,
      'description_en',NEW.service_description_en
    );
  END IF;
  IF NEW.pricing_snapshot='{}'::jsonb THEN
    NEW.pricing_snapshot:=jsonb_build_object(
      'schema_version',1,
      'source','legacy_order_fields',
      'rule_version','legacy-commission-unverified',
      'gross_amount',NEW.amount,
      'platform_fee',NEW.platform_fee,
      'provider_amount',NEW.provider_amount,
      'currency',NEW.currency,
      'tax_amount',NULL,
      'unit_price',NULL,
      'quantity',NULL
    );
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.initialize_order_snapshots() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER initialize_order_snapshots
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.initialize_order_snapshots();

CREATE OR REPLACE FUNCTION public.create_quoted_order(
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
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_conversation public.conversations%rowtype;
  v_provider_user_id uuid;
  v_service public.services%rowtype;
  v_order public.orders%rowtype;
  v_fee numeric;
  v_service_snapshot jsonb;
  v_pricing_snapshot jsonb;
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
  WHERE conversation.id=p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;

  SELECT user_id INTO v_provider_user_id
  FROM public.providers
  WHERE id=v_conversation.provider_id AND is_active;
  IF NOT FOUND OR p_actor_id IS NULL OR v_provider_user_id IS DISTINCT FROM p_actor_id
     OR v_conversation.seeker_id=p_actor_id
     OR NOT public.is_account_active(p_actor_id)
     OR NOT public.is_account_active(v_conversation.seeker_id) THEN
    RAISE EXCEPTION 'Provider cannot create this order' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_order FROM public.orders
  WHERE provider_id=v_conversation.provider_id AND quote_request_id=p_client_request_id;
  IF FOUND THEN
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
    RETURN v_order.id;
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT * INTO v_service FROM public.services
    WHERE id=p_service_id AND provider_id=v_conversation.provider_id AND is_active
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service unavailable'; END IF;
  END IF;

  v_fee:=round(p_amount*0.15,2);
  v_service_snapshot:=jsonb_build_object(
    'schema_version',1,
    'source','provider_quote',
    'service_id',p_service_id,
    'name_ar',btrim(p_service_name_ar),
    'name_en',btrim(p_service_name_en),
    'description_ar',coalesce(p_service_description_ar,''),
    'description_en',coalesce(p_service_description_en,''),
    'catalog',CASE WHEN p_service_id IS NULL THEN NULL ELSE jsonb_build_object(
      'name_ar',v_service.name_ar,
      'name_en',v_service.name_en,
      'description_ar',v_service.description_ar,
      'description_en',v_service.description_en,
      'category',v_service.category,
      'price',v_service.price,
      'price_type',v_service.price_type,
      'delivery_time',v_service.delivery_time,
      'features',to_jsonb(v_service.features),
      'image_urls',to_jsonb(v_service.image_urls)
    ) END
  );
  v_pricing_snapshot:=jsonb_build_object(
    'schema_version',1,
    'source','provider_quote',
    'rule_version','legacy-commission-15-v1',
    'gross_amount',p_amount,
    'platform_fee',v_fee,
    'provider_amount',p_amount-v_fee,
    'currency','SAR',
    'commission_rate','0.15',
    'tax_amount',NULL,
    'unit_price',NULL,
    'quantity',NULL,
    'catalog_price_type',CASE WHEN p_service_id IS NULL THEN NULL ELSE v_service.price_type END
  );

  INSERT INTO public.orders(
    conversation_id,seeker_id,provider_id,service_id,quote_request_id,
    service_name_ar,service_name_en,service_description_ar,service_description_en,
    amount,platform_fee,provider_amount,currency,status,service_snapshot,pricing_snapshot
  ) VALUES(
    v_conversation.id,v_conversation.seeker_id,v_conversation.provider_id,p_service_id,p_client_request_id,
    btrim(p_service_name_ar),btrim(p_service_name_en),
    coalesce(p_service_description_ar,''),coalesce(p_service_description_en,''),
    p_amount,v_fee,p_amount-v_fee,'SAR','pending',v_service_snapshot,v_pricing_snapshot
  )
  ON CONFLICT(provider_id,quote_request_id) WHERE quote_request_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    SELECT * INTO v_order FROM public.orders
    WHERE provider_id=v_conversation.provider_id AND quote_request_id=p_client_request_id;
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

CREATE OR REPLACE FUNCTION public.create_direct_order(p_service_id uuid,p_actor_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_service public.services%rowtype;
  v_provider_user_id uuid;
  v_conversation_id uuid;
  v_order_id uuid;
  v_fee numeric;
BEGIN
  PERFORM id FROM public.profiles
  WHERE id=p_actor_id AND deletion_requested_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;

  SELECT * INTO v_service FROM public.services
  WHERE id=p_service_id AND is_active
  FOR SHARE;
  IF NOT FOUND OR v_service.price_type<>'fixed' THEN
    RAISE EXCEPTION 'Service requires a confirmed quote';
  END IF;
  SELECT user_id INTO v_provider_user_id
  FROM public.providers
  WHERE id=v_service.provider_id AND is_active;
  IF NOT FOUND OR v_provider_user_id=p_actor_id OR NOT public.is_account_active(v_provider_user_id) THEN
    RAISE EXCEPTION 'Invalid service provider';
  END IF;

  SELECT id INTO v_order_id FROM public.orders
  WHERE seeker_id=p_actor_id AND service_id=p_service_id
    AND status='pending' AND quote_request_id IS NULL
  ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN RETURN v_order_id; END IF;

  INSERT INTO public.conversations(seeker_id,provider_id)
  VALUES(p_actor_id,v_service.provider_id)
  ON CONFLICT(seeker_id,provider_id) DO NOTHING;
  SELECT id INTO v_conversation_id FROM public.conversations
  WHERE seeker_id=p_actor_id AND provider_id=v_service.provider_id;

  v_fee:=round(v_service.price*0.15,2);
  INSERT INTO public.orders(
    conversation_id,seeker_id,provider_id,service_id,
    service_name_ar,service_name_en,service_description_ar,service_description_en,
    amount,platform_fee,provider_amount,currency,status,service_snapshot,pricing_snapshot
  ) VALUES(
    v_conversation_id,p_actor_id,v_service.provider_id,v_service.id,
    v_service.name_ar,v_service.name_en,
    coalesce(v_service.description_ar,''),coalesce(v_service.description_en,''),
    v_service.price,v_fee,v_service.price-v_fee,'SAR','pending',
    jsonb_build_object(
      'schema_version',1,
      'source','service_catalog',
      'service_id',v_service.id,
      'name_ar',v_service.name_ar,
      'name_en',v_service.name_en,
      'description_ar',coalesce(v_service.description_ar,''),
      'description_en',coalesce(v_service.description_en,''),
      'category',v_service.category,
      'price',v_service.price,
      'price_type',v_service.price_type,
      'delivery_time',v_service.delivery_time,
      'features',to_jsonb(v_service.features),
      'image_urls',to_jsonb(v_service.image_urls)
    ),
    jsonb_build_object(
      'schema_version',1,
      'source','service_catalog',
      'rule_version','legacy-commission-15-v1',
      'gross_amount',v_service.price,
      'platform_fee',v_fee,
      'provider_amount',v_service.price-v_fee,
      'currency','SAR',
      'commission_rate','0.15',
      'tax_amount',NULL,
      'unit_price',v_service.price,
      'quantity',1,
      'catalog_price_type',v_service.price_type
    )
  )
  ON CONFLICT(seeker_id,service_id)
    WHERE status='pending' AND service_id IS NOT NULL AND quote_request_id IS NULL
    DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id FROM public.orders
    WHERE seeker_id=p_actor_id AND service_id=p_service_id
      AND status='pending' AND quote_request_id IS NULL;
  END IF;
  RETURN v_order_id;
END $$;

CREATE OR REPLACE FUNCTION public.export_admin_order_report(
  p_actor_id uuid,p_query text,p_status text,p_max_rows integer DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count integer;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin)
     OR char_length(coalesce(p_query,''))>100 OR p_max_rows NOT BETWEEN 1 AND 10000
     OR (p_status IS NOT NULL AND p_status NOT IN ('pending','paid','revision_requested','awaiting_confirmation','completed','cancelled','refunded')) THEN
    RAISE EXCEPTION 'Invalid admin report query';
  END IF;
  SELECT count(*) INTO v_count FROM public.orders order_record
  JOIN public.profiles seeker ON seeker.id=order_record.seeker_id
  WHERE (p_status IS NULL OR order_record.status=p_status)
    AND (nullif(btrim(coalesce(p_query,'')),'') IS NULL OR order_record.id::text ILIKE '%'||btrim(p_query)||'%'
      OR order_record.service_name_ar ILIKE '%'||btrim(p_query)||'%' OR order_record.service_name_en ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(seeker.email,'') ILIKE '%'||btrim(p_query)||'%' OR coalesce(order_record.tap_charge_id,'') ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(order_record.tap_transaction_id,'') ILIKE '%'||btrim(p_query)||'%');
  IF v_count>p_max_rows THEN RAISE EXCEPTION 'Report exceeds row limit'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(report_row) ORDER BY report_row.created_at,report_row.id),'[]'::jsonb) INTO v_rows
  FROM(
    SELECT order_record.id,order_record.service_name_ar,order_record.service_name_en,order_record.amount,
      order_record.currency,order_record.status,order_record.refunded_amount,order_record.refund_status,
      order_record.dispute_status,order_record.tap_charge_id,order_record.tap_transaction_id,
      order_record.service_snapshot,order_record.pricing_snapshot,
      order_record.created_at,order_record.paid_at,seeker.email AS seeker_email,
      provider.name_ar AS provider_name_ar,provider.name_en AS provider_name_en
    FROM public.orders order_record JOIN public.profiles seeker ON seeker.id=order_record.seeker_id
    JOIN public.providers provider ON provider.id=order_record.provider_id
    WHERE (p_status IS NULL OR order_record.status=p_status)
      AND (nullif(btrim(coalesce(p_query,'')),'') IS NULL OR order_record.id::text ILIKE '%'||btrim(p_query)||'%'
        OR order_record.service_name_ar ILIKE '%'||btrim(p_query)||'%' OR order_record.service_name_en ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(seeker.email,'') ILIKE '%'||btrim(p_query)||'%' OR coalesce(order_record.tap_charge_id,'') ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(order_record.tap_transaction_id,'') ILIKE '%'||btrim(p_query)||'%')
  ) report_row;
  RETURN jsonb_build_object('generated_at',now(),'row_count',v_count,'orders',v_rows);
END $$;

CREATE FUNCTION public.export_user_data_snapshot_v9(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT public.export_user_data_snapshot_v8(p_actor_id)
    || jsonb_build_object('schema_version',9)
$$;
REVOKE ALL ON FUNCTION public.export_user_data_snapshot_v9(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.export_user_data_snapshot_v9(uuid) TO service_role;

COMMIT;
