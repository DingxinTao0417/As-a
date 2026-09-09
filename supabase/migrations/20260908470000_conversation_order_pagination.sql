BEGIN;

CREATE FUNCTION public.get_conversation_order_page(
  p_actor_id uuid,p_conversation_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_conversation public.conversations%rowtype;
  v_provider_user_id uuid;
  v_cleared_at timestamptz;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid conversation order query' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_conversation FROM public.conversations WHERE id=p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501'; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id=v_conversation.provider_id;
  IF p_actor_id=v_conversation.seeker_id THEN v_cleared_at:=v_conversation.seeker_cleared_at;
  ELSIF p_actor_id=v_provider_user_id THEN v_cleared_at:=v_conversation.provider_cleared_at;
  ELSE RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.orders order_record
  WHERE order_record.conversation_id=p_conversation_id
    AND (v_cleared_at IS NULL OR order_record.created_at>v_cleared_at);
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT order_record.*
    FROM public.orders order_record
    WHERE order_record.conversation_id=p_conversation_id
      AND (v_cleared_at IS NULL OR order_record.created_at>v_cleared_at)
      AND (
        p_before_created_at IS NULL
        OR order_record.created_at<p_before_created_at
        OR (order_record.created_at=p_before_created_at AND order_record.id<p_before_id)
      )
    ORDER BY order_record.created_at DESC,order_record.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('orders',v_rows,'total',v_total);
END $$;

REVOKE ALL ON FUNCTION public.get_conversation_order_page(uuid,uuid,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_order_page(uuid,uuid,timestamptz,uuid,integer)
TO service_role;

COMMIT;
