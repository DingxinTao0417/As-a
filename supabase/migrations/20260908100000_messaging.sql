BEGIN;

ALTER TABLE public.messages
  ADD COLUMN client_request_id uuid;

CREATE UNIQUE INDEX messages_client_request_unique
  ON public.messages(conversation_id,sender_id,client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE FUNCTION public.open_provider_conversation(p_actor_id uuid,p_provider_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider_user_id uuid;
  v_conversation_id uuid;
BEGIN
  PERFORM id FROM public.profiles
    WHERE id = p_actor_id AND deletion_requested_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501'; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers
    WHERE id = p_provider_id AND is_active;
  IF NOT FOUND OR v_provider_user_id = p_actor_id OR NOT public.is_account_active(v_provider_user_id) THEN
    RAISE EXCEPTION 'Provider unavailable' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.conversations(seeker_id,provider_id)
    VALUES(p_actor_id,p_provider_id)
    ON CONFLICT(seeker_id,provider_id) DO NOTHING;
  SELECT id INTO v_conversation_id FROM public.conversations
    WHERE seeker_id = p_actor_id AND provider_id = p_provider_id
    FOR UPDATE;
  UPDATE public.conversations
    SET is_archived_by_seeker = false
    WHERE id = v_conversation_id;
  RETURN v_conversation_id;
END $$;

CREATE FUNCTION public.send_conversation_message(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_client_request_id uuid,
  p_content text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_conversation public.conversations%rowtype;
  v_provider_user_id uuid;
  v_message public.messages%rowtype;
BEGIN
  IF p_client_request_id IS NULL
     OR char_length(btrim(coalesce(p_content,''))) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Invalid message';
  END IF;
  SELECT c.* INTO v_conversation FROM public.conversations c
    WHERE c.id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers
    WHERE id = v_conversation.provider_id AND is_active;
  IF NOT FOUND OR p_actor_id NOT IN (v_conversation.seeker_id,v_provider_user_id)
     OR NOT public.is_account_active(v_conversation.seeker_id)
     OR NOT public.is_account_active(v_provider_user_id) THEN
    RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.messages(conversation_id,sender_id,client_request_id,content,is_read)
    VALUES(v_conversation.id,p_actor_id,p_client_request_id,btrim(p_content),false)
    ON CONFLICT(conversation_id,sender_id,client_request_id)
      WHERE client_request_id IS NOT NULL DO NOTHING
    RETURNING * INTO v_message;
  IF NOT FOUND THEN
    SELECT * INTO v_message FROM public.messages
      WHERE conversation_id = v_conversation.id
        AND sender_id = p_actor_id
        AND client_request_id = p_client_request_id;
    IF v_message.content <> btrim(p_content) THEN
      RAISE EXCEPTION 'Message request identifier was reused with different content';
    END IF;
  END IF;

  IF p_actor_id = v_conversation.seeker_id THEN
    UPDATE public.conversations SET
      last_message_at = greatest(last_message_at,v_message.created_at),
      is_archived_by_provider = false
      WHERE id = v_conversation.id;
  ELSE
    UPDATE public.conversations SET
      last_message_at = greatest(last_message_at,v_message.created_at),
      is_archived_by_seeker = false
      WHERE id = v_conversation.id;
  END IF;

  RETURN to_jsonb(v_message);
END $$;

CREATE FUNCTION public.send_service_card_message(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_client_request_id uuid,
  p_service_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_service public.services%rowtype;
  v_provider_user_id uuid;
  v_content text;
BEGIN
  SELECT s.* INTO v_service
    FROM public.services s
    JOIN public.conversations c ON c.provider_id = s.provider_id
    WHERE s.id = p_service_id
      AND s.is_active
      AND c.id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service card unavailable' USING ERRCODE = '42501'; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id = v_service.provider_id;
  IF NOT FOUND OR v_provider_user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Service card unavailable' USING ERRCODE = '42501';
  END IF;
  v_content := jsonb_build_object(
    '__type','service_card',
    'id',v_service.id,
    'name_ar',v_service.name_ar,
    'name_en',v_service.name_en,
    'description_ar',coalesce(v_service.description_ar,''),
    'description_en',coalesce(v_service.description_en,''),
    'price',v_service.price,
    'price_type',v_service.price_type,
    'category',v_service.category,
    'image_url',coalesce(v_service.image_urls[1],'')
  )::text;
  RETURN public.send_conversation_message(
    p_actor_id,p_conversation_id,p_client_request_id,v_content
  );
END $$;

CREATE FUNCTION public.set_conversation_preference(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_preference text,
  p_enabled boolean DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_conversation public.conversations%rowtype;
  v_provider_user_id uuid;
  v_cleared_at timestamptz;
BEGIN
  SELECT c.* INTO v_conversation FROM public.conversations c
    WHERE c.id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers
    WHERE id = v_conversation.provider_id;
  IF p_actor_id NOT IN (v_conversation.seeker_id,v_provider_user_id)
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_preference NOT IN ('pinned','archived','cleared')
     OR (p_preference <> 'cleared' AND p_enabled IS NULL) THEN
    RAISE EXCEPTION 'Invalid conversation preference';
  END IF;

  IF p_preference = 'cleared' THEN
    v_cleared_at := clock_timestamp();
    IF p_actor_id = v_conversation.seeker_id THEN
      UPDATE public.conversations SET seeker_cleared_at = v_cleared_at WHERE id = p_conversation_id;
    ELSE
      UPDATE public.conversations SET provider_cleared_at = v_cleared_at WHERE id = p_conversation_id;
    END IF;
    RETURN v_cleared_at;
  END IF;

  IF p_actor_id = v_conversation.seeker_id THEN
    IF p_preference = 'pinned' THEN
      UPDATE public.conversations SET is_pinned_by_seeker = p_enabled WHERE id = p_conversation_id;
    ELSE
      UPDATE public.conversations SET is_archived_by_seeker = p_enabled WHERE id = p_conversation_id;
    END IF;
  ELSE
    IF p_preference = 'pinned' THEN
      UPDATE public.conversations SET is_pinned_by_provider = p_enabled WHERE id = p_conversation_id;
    ELSE
      UPDATE public.conversations SET is_archived_by_provider = p_enabled WHERE id = p_conversation_id;
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.mark_conversation_read(p_actor_id uuid,p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider_user_id uuid;
  v_count integer;
BEGIN
  SELECT p.user_id INTO v_provider_user_id
    FROM public.conversations c
    JOIN public.providers p ON p.id = c.provider_id
    WHERE c.id = p_conversation_id
      AND p_actor_id IN (c.seeker_id,p.user_id);
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501';
  END IF;
  UPDATE public.messages SET is_read = true
    WHERE conversation_id = p_conversation_id
      AND sender_id <> p_actor_id
      AND NOT is_read;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

CREATE FUNCTION public.get_conversation_messages(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
) RETURNS SETOF public.messages
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_conversation public.conversations%rowtype;
  v_provider_user_id uuid;
  v_cleared_at timestamptz;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid message page';
  END IF;
  SELECT c.* INTO v_conversation FROM public.conversations c
    WHERE c.id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers
    WHERE id = v_conversation.provider_id;
  IF p_actor_id = v_conversation.seeker_id THEN
    v_cleared_at := v_conversation.seeker_cleared_at;
  ELSIF p_actor_id = v_provider_user_id THEN
    v_cleared_at := v_conversation.provider_cleared_at;
  ELSE
    RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.* FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND (v_cleared_at IS NULL OR m.created_at > v_cleared_at)
      AND (
        p_before_created_at IS NULL
        OR m.created_at < p_before_created_at
        OR (m.created_at = p_before_created_at AND m.id < p_before_id)
      )
    ORDER BY m.created_at DESC,m.id DESC
    LIMIT p_limit;
END $$;

CREATE FUNCTION public.get_conversation_unread_counts(p_actor_id uuid)
RETURNS TABLE(conversation_id uuid,unread_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT c.id,count(m.id) FILTER (WHERE NOT m.is_read AND m.sender_id <> p_actor_id)
  FROM public.conversations c
  JOIN public.providers p ON p.id = c.provider_id
  LEFT JOIN public.messages m ON m.conversation_id = c.id
  WHERE public.is_account_active(p_actor_id)
    AND p_actor_id IN (c.seeker_id,p.user_id)
  GROUP BY c.id;
$$;

REVOKE ALL ON FUNCTION public.send_conversation_message(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.open_provider_conversation(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.send_service_card_message(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_conversation_preference(uuid,uuid,text,boolean)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_conversation_messages(uuid,uuid,timestamptz,uuid,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_conversation_unread_counts(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.send_conversation_message(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_provider_conversation(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_service_card_message(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_conversation_preference(uuid,uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages(uuid,uuid,timestamptz,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_conversation_unread_counts(uuid) TO service_role;

COMMIT;
