BEGIN;

CREATE FUNCTION public.export_user_data_snapshot(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider_ids uuid[];
  v_order_ids uuid[];
  v_conversation_ids uuid[];
  v_result jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_provider_ids
    FROM public.providers WHERE user_id = p_actor_id;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_order_ids
    FROM public.orders
    WHERE seeker_id = p_actor_id OR provider_id = ANY(v_provider_ids);
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_conversation_ids
    FROM public.conversations
    WHERE seeker_id = p_actor_id OR provider_id = ANY(v_provider_ids);

  SELECT jsonb_build_object(
    'schema_version',1,
    'profile',(
      SELECT to_jsonb(profile) - ARRAY['suspended_by']
      FROM public.profiles profile WHERE profile.id = p_actor_id
    ),
    'provider_profiles',coalesce((
      SELECT jsonb_agg(to_jsonb(provider) ORDER BY provider.created_at,provider.id)
      FROM public.providers provider WHERE provider.id = ANY(v_provider_ids)
    ),'[]'::jsonb),
    'services',coalesce((
      SELECT jsonb_agg(to_jsonb(service) ORDER BY service.created_at,service.id)
      FROM public.services service WHERE service.provider_id = ANY(v_provider_ids)
    ),'[]'::jsonb),
    'orders_as_seeker',coalesce((
      SELECT jsonb_agg(to_jsonb(customer_order) ORDER BY customer_order.created_at,customer_order.id)
      FROM public.orders customer_order WHERE customer_order.seeker_id = p_actor_id
    ),'[]'::jsonb),
    'orders_as_provider',coalesce((
      SELECT jsonb_agg(to_jsonb(provider_order) ORDER BY provider_order.created_at,provider_order.id)
      FROM public.orders provider_order WHERE provider_order.provider_id = ANY(v_provider_ids)
    ),'[]'::jsonb),
    'conversations',coalesce((
      SELECT jsonb_agg(to_jsonb(conversation) ORDER BY conversation.created_at,conversation.id)
      FROM public.conversations conversation WHERE conversation.id = ANY(v_conversation_ids)
    ),'[]'::jsonb),
    'messages_sent_and_received',coalesce((
      SELECT jsonb_agg(to_jsonb(message) ORDER BY message.created_at,message.id)
      FROM public.messages message WHERE message.conversation_id = ANY(v_conversation_ids)
    ),'[]'::jsonb),
    'reviews_authored',coalesce((
      SELECT jsonb_agg(to_jsonb(review) ORDER BY review.created_at,review.id)
      FROM public.reviews review WHERE review.reviewer_id = p_actor_id
    ),'[]'::jsonb),
    'reviews_received',coalesce((
      SELECT jsonb_agg(to_jsonb(review) ORDER BY review.created_at,review.id)
      FROM public.reviews review
      JOIN public.orders reviewed_order ON reviewed_order.id = review.order_id
      WHERE reviewed_order.provider_id = ANY(v_provider_ids)
    ),'[]'::jsonb),
    'favorites',coalesce((
      SELECT jsonb_agg(to_jsonb(favorite) ORDER BY favorite.created_at,favorite.id)
      FROM public.favorites favorite WHERE favorite.user_id = p_actor_id
    ),'[]'::jsonb),
    'service_history_as_seeker',coalesce((
      SELECT jsonb_agg(to_jsonb(history) ORDER BY history.created_at,history.id)
      FROM public.service_history history WHERE history.seeker_id = p_actor_id
    ),'[]'::jsonb),
    'service_history_as_provider',coalesce((
      SELECT jsonb_agg(to_jsonb(history) ORDER BY history.created_at,history.id)
      FROM public.service_history history WHERE history.provider_id = ANY(v_provider_ids)
    ),'[]'::jsonb),
    'withdrawal_requests',coalesce((
      SELECT jsonb_agg(to_jsonb(withdrawal) ORDER BY withdrawal.requested_at,withdrawal.id)
      FROM public.withdrawal_requests withdrawal WHERE withdrawal.provider_id = ANY(v_provider_ids)
    ),'[]'::jsonb),
    'order_deliveries',coalesce((
      SELECT jsonb_agg(to_jsonb(delivery) ORDER BY delivery.submitted_at,delivery.id)
      FROM public.order_deliveries delivery WHERE delivery.order_id = ANY(v_order_ids)
    ),'[]'::jsonb),
    'payment_attempts',coalesce((
      SELECT jsonb_agg(to_jsonb(attempt) ORDER BY attempt.created_at,attempt.id)
      FROM public.payment_attempts attempt
      JOIN public.orders payment_order ON payment_order.id = attempt.order_id
      WHERE payment_order.seeker_id = p_actor_id
    ),'[]'::jsonb),
    'payment_events',coalesce((
      SELECT jsonb_agg(to_jsonb(event) ORDER BY event.received_at,event.id)
      FROM public.payment_events event WHERE event.linked_order_id = ANY(v_order_ids)
    ),'[]'::jsonb),
    'ledger_entries',coalesce((
      SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry.created_at,entry.id)
      FROM public.ledger_entries entry WHERE entry.provider_id = ANY(v_provider_ids)
    ),'[]'::jsonb),
    'admin_actions_targeting_account',coalesce((
      SELECT jsonb_agg(to_jsonb(log) ORDER BY log.created_at,log.id)
      FROM public.admin_audit_log log
      WHERE log.target_id = p_actor_id
        OR log.target_id = ANY(v_provider_ids)
        OR log.target_id = ANY(v_order_ids)
        OR EXISTS (
          SELECT 1 FROM public.services owned_service
          WHERE owned_service.id = log.target_id
            AND owned_service.provider_id = ANY(v_provider_ids)
        )
        OR EXISTS (
          SELECT 1 FROM public.withdrawal_requests owned_withdrawal
          WHERE owned_withdrawal.id = log.target_id
            AND owned_withdrawal.provider_id = ANY(v_provider_ids)
        )
    ),'[]'::jsonb),
    'admin_actions_performed',coalesce((
      SELECT jsonb_agg(to_jsonb(log) ORDER BY log.created_at,log.id)
      FROM public.admin_audit_log log WHERE log.actor_id = p_actor_id
    ),'[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.export_user_data_snapshot(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.export_user_data_snapshot(uuid)
  TO service_role;

COMMIT;
