BEGIN;

CREATE FUNCTION public.get_support_ticket_page(
  p_actor_id uuid,
  p_admin_view boolean,
  p_before_updated_at timestamptz,
  p_before_id uuid,
  p_limit integer
) RETURNS TABLE(
  id uuid,requester_id uuid,order_id uuid,assigned_to uuid,subject text,description text,
  language text,status text,created_at timestamptz,updated_at timestamptz,
  requester_name text,requester_email text,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_admin_view IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_updated_at IS NULL) <> (p_before_id IS NULL))
     OR (p_admin_view AND NOT EXISTS (
       SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin
     )) THEN
    RAISE EXCEPTION 'Invalid support ticket query' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT ticket.id,ticket.requester_id,ticket.order_id,ticket.assigned_to,ticket.subject,
    ticket.description,ticket.language,ticket.status,ticket.created_at,ticket.updated_at,
    requester.full_name,requester.email,
    (SELECT count(*) FROM public.support_tickets counted
      WHERE p_admin_view OR counted.requester_id=p_actor_id)
  FROM public.support_tickets ticket
  JOIN public.profiles requester ON requester.id=ticket.requester_id
  WHERE (p_admin_view OR ticket.requester_id=p_actor_id)
    AND (
      p_before_updated_at IS NULL
      OR ticket.updated_at<p_before_updated_at
      OR (ticket.updated_at=p_before_updated_at AND ticket.id<p_before_id)
    )
  ORDER BY ticket.updated_at DESC,ticket.id DESC
  LIMIT p_limit;
END $$;

CREATE FUNCTION public.get_support_ticket_message_page(
  p_actor_id uuid,
  p_ticket_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
) RETURNS TABLE(
  id uuid,ticket_id uuid,sender_id uuid,body text,created_at timestamptz,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL))
     OR NOT EXISTS (
       SELECT 1 FROM public.support_tickets ticket
       WHERE ticket.id=p_ticket_id AND (
         ticket.requester_id=p_actor_id
         OR EXISTS (SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
       )
     ) THEN
    RAISE EXCEPTION 'Support ticket unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT message.id,message.ticket_id,message.sender_id,message.body,message.created_at,
    (SELECT count(*) FROM public.support_ticket_messages counted WHERE counted.ticket_id=p_ticket_id)
  FROM public.support_ticket_messages message
  WHERE message.ticket_id=p_ticket_id
    AND (
      p_before_created_at IS NULL
      OR message.created_at<p_before_created_at
      OR (message.created_at=p_before_created_at AND message.id<p_before_id)
    )
  ORDER BY message.created_at DESC,message.id DESC
  LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.get_support_ticket_page(uuid,boolean,timestamptz,uuid,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_support_ticket_message_page(uuid,uuid,timestamptz,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_page(uuid,boolean,timestamptz,uuid,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_message_page(uuid,uuid,timestamptz,uuid,integer)
  TO service_role;

COMMIT;
