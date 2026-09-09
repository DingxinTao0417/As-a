BEGIN;

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_provider_ids uuid[];v_available numeric;v_reserved numeric;
  v_existing public.account_deletion_requests%rowtype;
  v_request public.account_deletion_requests%rowtype;v_snapshot jsonb;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=p_actor_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE='42501';
  END IF;
  PERFORM id FROM public.providers WHERE user_id=p_actor_id ORDER BY id FOR UPDATE;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_provider_ids
  FROM public.providers WHERE user_id=p_actor_id;
  SELECT * INTO v_existing FROM public.account_deletion_requests
  WHERE user_id=p_actor_id AND status IN ('requested','processing')
  ORDER BY requested_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN to_jsonb(v_existing); END IF;
  IF EXISTS(
    SELECT 1 FROM public.orders order_record
    WHERE order_record.status IN ('pending','paid','revision_requested','awaiting_confirmation')
      AND (order_record.seeker_id=p_actor_id OR order_record.provider_id=ANY(v_provider_ids))
  ) THEN RAISE EXCEPTION 'Active orders prevent account deletion'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.withdrawal_requests withdrawal
    WHERE withdrawal.provider_id=ANY(v_provider_ids) AND withdrawal.status IN ('pending','approved')
  ) THEN RAISE EXCEPTION 'Open withdrawals prevent account deletion'; END IF;
  SELECT coalesce(sum(available_delta),0),coalesce(sum(reserved_delta),0)
  INTO v_available,v_reserved FROM public.ledger_entries WHERE provider_id=ANY(v_provider_ids);
  IF v_available<>0 OR v_reserved<>0 THEN
    RAISE EXCEPTION 'Unsettled provider balance prevents account deletion';
  END IF;
  v_snapshot:=jsonb_build_object(
    'active_orders',0,'open_withdrawals',0,'available_balance',v_available,
    'reserved_balance',v_reserved,'checked_at',now()
  );
  INSERT INTO public.account_deletion_requests(user_id,eligibility_snapshot)
  VALUES(p_actor_id,v_snapshot) RETURNING * INTO v_request;
  RETURN to_jsonb(v_request);
END $$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_actor_id uuid,p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  PERFORM 1 FROM public.conversations conversation
  JOIN public.providers provider ON provider.id=conversation.provider_id
  WHERE conversation.id=p_conversation_id
    AND p_actor_id IN(conversation.seeker_id,provider.user_id);
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501';
  END IF;
  UPDATE public.messages SET is_read=true
  WHERE conversation_id=p_conversation_id AND sender_id<>p_actor_id AND NOT is_read;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count>0 THEN
    UPDATE public.conversations SET last_message_at=last_message_at WHERE id=p_conversation_id;
  END IF;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.apply_admin_action(
  p_actor_id uuid,p_action text,p_target_id uuid,p_value text,p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior jsonb;updated jsonb;
BEGIN
  PERFORM id FROM public.profiles WHERE is_admin OR id IN(p_actor_id,p_target_id) ORDER BY id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin AND deletion_requested_at IS NULL) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  IF p_action<>'set_admin' OR p_actor_id=p_target_id OR p_value IS NULL OR p_value NOT IN('true','false')
    OR char_length(coalesce(p_note,''))>1000 THEN
    RAISE EXCEPTION 'Unsupported administrator action';
  END IF;
  SELECT jsonb_build_object('is_admin',is_admin) INTO prior
  FROM public.profiles WHERE id=p_target_id AND deletion_requested_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active user not found'; END IF;
  UPDATE public.profiles SET is_admin=p_value::boolean WHERE id=p_target_id;
  updated:=jsonb_build_object(
    'is_admin',p_value::boolean,'note',nullif(btrim(coalesce(p_note,'')),'')
  );
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
  VALUES(p_actor_id,p_action,p_target_id,prior,updated);
END $$;

CREATE OR REPLACE FUNCTION public.sync_provider_tap_destination_status(
  p_actor_id uuid,p_provider_id uuid,p_destination_id text,p_external_status text,
  p_charges_enabled boolean,p_payouts_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_status text;
BEGIN
  IF p_destination_id IS NULL OR p_destination_id LIKE 'tap_placeholder_%'
    OR char_length(p_destination_id) NOT BETWEEN 1 AND 100
    OR p_charges_enabled IS NULL OR p_payouts_enabled IS NULL
    OR p_payouts_enabled AND NOT p_charges_enabled THEN
    RAISE EXCEPTION 'Invalid Tap destination status';
  END IF;
  v_status:=CASE lower(btrim(coalesce(p_external_status,'')))
    WHEN 'active' THEN 'active' WHEN 'pending' THEN 'pending'
    WHEN 'restricted' THEN 'restricted' WHEN 'inactive' THEN 'inactive'
    WHEN 'disabled' THEN 'disabled' ELSE 'unknown'
  END;
  IF p_charges_enabled IS DISTINCT FROM (v_status='active') THEN
    RAISE EXCEPTION 'Inconsistent Tap destination status';
  END IF;
  PERFORM 1 FROM public.providers
  WHERE id=p_provider_id AND user_id=p_actor_id AND tap_destination_id=p_destination_id AND is_active
  FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Provider destination not found' USING ERRCODE='42501';
  END IF;
  UPDATE public.providers SET
    tap_account_status=v_status,tap_charges_enabled=p_charges_enabled,
    tap_payouts_enabled=p_payouts_enabled,tap_onboarding_completed=p_payouts_enabled,
    tap_status_checked_at=now(),tap_status_source='tap_destination_api',updated_at=now()
  WHERE id=p_provider_id;
  RETURN jsonb_build_object(
    'status',v_status,'charges_enabled',p_charges_enabled,
    'payouts_enabled',p_payouts_enabled,'checked_at',now()
  );
END $$;

REVOKE ALL ON FUNCTION public.request_account_deletion(uuid),
  public.mark_conversation_read(uuid,uuid),
  public.apply_admin_action(uuid,text,uuid,text,text),
  public.sync_provider_tap_destination_status(uuid,uuid,text,text,boolean,boolean)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid),
  public.mark_conversation_read(uuid,uuid),
  public.apply_admin_action(uuid,text,uuid,text,text),
  public.sync_provider_tap_destination_status(uuid,uuid,text,text,boolean,boolean)
TO service_role;

COMMIT;
