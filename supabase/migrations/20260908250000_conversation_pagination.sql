BEGIN;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_actor_id uuid,p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider_user_id uuid;
  v_count integer;
BEGIN
  SELECT provider.user_id INTO v_provider_user_id
  FROM public.conversations conversation
  JOIN public.providers provider ON provider.id = conversation.provider_id
  WHERE conversation.id = p_conversation_id
    AND p_actor_id IN (conversation.seeker_id,provider.user_id);
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE = '42501';
  END IF;
  UPDATE public.messages SET is_read = true
  WHERE conversation_id = p_conversation_id
    AND sender_id <> p_actor_id
    AND NOT is_read;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    -- Wake every participant's conversation subscription so unread badges refresh across tabs.
    UPDATE public.conversations
      SET last_message_at = last_message_at
      WHERE id = p_conversation_id;
  END IF;
  RETURN v_count;
END $$;

CREATE FUNCTION public.get_conversation_page(
  p_actor_id uuid,
  p_archived boolean,
  p_query text,
  p_before_pinned boolean,
  p_before_last_message_at timestamptz,
  p_before_id uuid,
  p_limit integer
) RETURNS TABLE(
  id uuid,
  provider_id uuid,
  seeker_id uuid,
  last_message_at timestamptz,
  other_party_name_ar text,
  other_party_name_en text,
  other_party_avatar text,
  is_provider boolean,
  is_pinned boolean,
  is_archived boolean,
  cleared_at timestamptz,
  unread_count bigint,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_archived IS NULL OR char_length(coalesce(p_query,'')) > 100
     OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_pinned IS NULL) <> (p_before_last_message_at IS NULL))
     OR ((p_before_pinned IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid conversation page';
  END IF;

  RETURN QUERY
  WITH actor_conversations AS (
    SELECT
      conversation.id,
      conversation.provider_id,
      conversation.seeker_id,
      conversation.last_message_at,
      CASE WHEN provider.user_id = p_actor_id THEN seeker.full_name ELSE provider.name_ar END AS other_party_name_ar,
      CASE WHEN provider.user_id = p_actor_id THEN seeker.full_name ELSE provider.name_en END AS other_party_name_en,
      CASE WHEN provider.user_id = p_actor_id THEN seeker.avatar_url ELSE provider.avatar_url END AS other_party_avatar,
      provider.user_id = p_actor_id AS is_provider,
      CASE WHEN provider.user_id = p_actor_id THEN conversation.is_pinned_by_provider ELSE conversation.is_pinned_by_seeker END AS is_pinned,
      CASE WHEN provider.user_id = p_actor_id THEN conversation.is_archived_by_provider ELSE conversation.is_archived_by_seeker END AS is_archived,
      CASE WHEN provider.user_id = p_actor_id THEN conversation.provider_cleared_at ELSE conversation.seeker_cleared_at END AS cleared_at
    FROM public.conversations conversation
    JOIN public.providers provider ON provider.id = conversation.provider_id
    LEFT JOIN public.public_profiles seeker ON seeker.id = conversation.seeker_id
    WHERE p_actor_id IN (conversation.seeker_id,provider.user_id)
  ), filtered AS (
    SELECT actor_conversation.*,
      (SELECT count(*) FROM public.messages message
        WHERE message.conversation_id = actor_conversation.id
          AND NOT message.is_read
          AND message.sender_id <> p_actor_id
          AND (actor_conversation.cleared_at IS NULL OR message.created_at > actor_conversation.cleared_at)
      ) AS unread_count
    FROM actor_conversations actor_conversation
    WHERE actor_conversation.is_archived = p_archived
      AND (
        nullif(btrim(coalesce(p_query,'')),'') IS NULL
        OR coalesce(actor_conversation.other_party_name_ar,'') ILIKE '%' || btrim(p_query) || '%'
        OR coalesce(actor_conversation.other_party_name_en,'') ILIKE '%' || btrim(p_query) || '%'
      )
  )
  SELECT
    filtered_conversation.id,
    filtered_conversation.provider_id,
    filtered_conversation.seeker_id,
    filtered_conversation.last_message_at,
    coalesce(filtered_conversation.other_party_name_ar,''),
    coalesce(filtered_conversation.other_party_name_en,''),
    filtered_conversation.other_party_avatar,
    filtered_conversation.is_provider,
    filtered_conversation.is_pinned,
    filtered_conversation.is_archived,
    filtered_conversation.cleared_at,
    filtered_conversation.unread_count,
    (SELECT count(*) FROM filtered)
  FROM filtered filtered_conversation
  WHERE p_before_pinned IS NULL
    OR (p_before_pinned AND NOT filtered_conversation.is_pinned)
    OR (
      filtered_conversation.is_pinned = p_before_pinned
      AND (
        filtered_conversation.last_message_at < p_before_last_message_at
        OR (
          filtered_conversation.last_message_at = p_before_last_message_at
          AND filtered_conversation.id < p_before_id
        )
      )
    )
  ORDER BY filtered_conversation.is_pinned DESC,
    filtered_conversation.last_message_at DESC,
    filtered_conversation.id DESC
  LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.get_conversation_page(uuid,boolean,text,boolean,timestamptz,uuid,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_page(uuid,boolean,text,boolean,timestamptz,uuid,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid,uuid)
  TO service_role;

COMMIT;
