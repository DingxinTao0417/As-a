BEGIN;

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 200),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 5000),
  language text NOT NULL CHECK (language IN ('ar','en')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE(requester_id,client_request_id)
);
CREATE INDEX support_tickets_requester_created_idx
  ON public.support_tickets(requester_id,created_at DESC);
CREATE INDEX support_tickets_queue_idx
  ON public.support_tickets(status,updated_at DESC);

CREATE TABLE public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ticket_id,sender_id,client_request_id)
);
CREATE INDEX support_ticket_messages_ticket_created_idx
  ON public.support_ticket_messages(ticket_id,created_at,id);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_key text NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 300),
  type text NOT NULL CHECK (type IN ('message','order','withdrawal','support')),
  title_ar text NOT NULL CHECK (char_length(title_ar) BETWEEN 1 AND 300),
  title_en text NOT NULL CHECK (char_length(title_en) BETWEEN 1 AND 300),
  body_ar text NOT NULL CHECK (char_length(body_ar) BETWEEN 1 AND 1000),
  body_en text NOT NULL CHECK (char_length(body_en) BETWEEN 1 AND 1000),
  link text CHECK (link IS NULL OR char_length(link) BETWEEN 1 AND 1000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,event_key)
);
CREATE INDEX notifications_user_unread_idx
  ON public.notifications(user_id,created_at DESC) WHERE read_at IS NULL;

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets,public.support_ticket_messages,public.notifications
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.support_tickets,public.support_ticket_messages,public.notifications
  TO authenticated;
GRANT ALL ON public.support_tickets,public.support_ticket_messages,public.notifications
  TO service_role;

CREATE POLICY support_ticket_read ON public.support_tickets
  FOR SELECT TO authenticated USING (
    public.is_account_active((SELECT auth.uid()))
    AND (requester_id = (SELECT auth.uid()) OR public.is_app_admin())
  );
CREATE POLICY support_ticket_message_read ON public.support_ticket_messages
  FOR SELECT TO authenticated USING (
    public.is_account_active((SELECT auth.uid())) AND EXISTS (
      SELECT 1 FROM public.support_tickets ticket
      WHERE ticket.id = ticket_id
        AND (ticket.requester_id = (SELECT auth.uid()) OR public.is_app_admin())
    )
  );
CREATE POLICY notification_owner_read ON public.notifications
  FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) AND public.is_account_active(user_id)
  );

CREATE FUNCTION public.create_notification(
  p_user_id uuid,
  p_event_key text,
  p_type text,
  p_title_ar text,
  p_title_en text,
  p_body_ar text,
  p_body_en text,
  p_link text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_account_active(p_user_id) THEN RETURN NULL; END IF;
  IF char_length(coalesce(p_event_key,'')) NOT BETWEEN 1 AND 300
     OR p_type NOT IN ('message','order','withdrawal','support')
     OR char_length(coalesce(p_title_ar,'')) NOT BETWEEN 1 AND 300
     OR char_length(coalesce(p_title_en,'')) NOT BETWEEN 1 AND 300
     OR char_length(coalesce(p_body_ar,'')) NOT BETWEEN 1 AND 1000
     OR char_length(coalesce(p_body_en,'')) NOT BETWEEN 1 AND 1000
     OR (p_link IS NOT NULL AND (
       char_length(p_link) NOT BETWEEN 1 AND 1000
       OR left(p_link,1) <> '/' OR left(p_link,2) = '//'
       OR p_link ~ '[[:space:]]'
     )) THEN
    RAISE EXCEPTION 'Invalid notification';
  END IF;
  INSERT INTO public.notifications(
    user_id,event_key,type,title_ar,title_en,body_ar,body_en,link
  ) VALUES (
    p_user_id,p_event_key,p_type,p_title_ar,p_title_en,p_body_ar,p_body_en,p_link
  ) ON CONFLICT(user_id,event_key) DO NOTHING
  RETURNING id INTO v_id;
  IF NOT FOUND THEN
    SELECT id INTO v_id FROM public.notifications
      WHERE user_id = p_user_id AND event_key = p_event_key;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_notification(uuid,text,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid,text,text,text,text,text,text,text)
  TO service_role;

CREATE FUNCTION public.notify_message_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_conversation public.conversations%rowtype;
  v_provider_user_id uuid;
  v_recipient_id uuid;
BEGIN
  SELECT * INTO v_conversation FROM public.conversations WHERE id = NEW.conversation_id;
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id = v_conversation.provider_id;
  v_recipient_id := CASE WHEN NEW.sender_id = v_conversation.seeker_id
    THEN v_provider_user_id ELSE v_conversation.seeker_id END;
  PERFORM public.create_notification(
    v_recipient_id,'message:' || NEW.id,'message',
    'رسالة جديدة','New message',
    'لديك رسالة جديدة في محادثة خدمة.','You have a new service conversation message.',
    '/messages?conversation=' || NEW.conversation_id
  );
  RETURN NEW;
END $$;
CREATE TRIGGER message_notification
AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_message_insert();
REVOKE ALL ON FUNCTION public.notify_message_insert()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.notify_order_status_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_provider_user_id uuid;
  v_key text;
  v_link text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id = NEW.provider_id;
  v_key := 'order:' || NEW.id || ':status:' || NEW.status || ':version:' || NEW.delivery_version;
  v_link := '/messages?conversation=' || NEW.conversation_id;
  PERFORM public.create_notification(
    NEW.seeker_id,v_key,'order','تحديث الطلب','Order updated',
    'حالة الطلب الآن: ' || NEW.status,'Order status is now: ' || NEW.status,v_link
  );
  PERFORM public.create_notification(
    v_provider_user_id,v_key,'order','تحديث الطلب','Order updated',
    'حالة الطلب الآن: ' || NEW.status,'Order status is now: ' || NEW.status,v_link
  );
  RETURN NEW;
END $$;
CREATE TRIGGER order_status_notification
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.notify_order_status_change();
REVOKE ALL ON FUNCTION public.notify_order_status_change()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.notify_withdrawal_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT user_id INTO v_user_id FROM public.providers WHERE id = NEW.provider_id;
  PERFORM public.create_notification(
    v_user_id,'withdrawal:' || NEW.id || ':status:' || NEW.status,'withdrawal',
    'تحديث طلب السحب','Withdrawal updated',
    'حالة طلب السحب الآن: ' || NEW.status,'Withdrawal status is now: ' || NEW.status,
    '/dashboard'
  );
  RETURN NEW;
END $$;
CREATE TRIGGER withdrawal_notification
AFTER INSERT OR UPDATE OF status ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_withdrawal_change();
REVOKE ALL ON FUNCTION public.notify_withdrawal_change()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.create_support_ticket(
  p_actor_id uuid,
  p_client_request_id uuid,
  p_subject text,
  p_description text,
  p_language text,
  p_order_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_existing public.support_tickets%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_admin record;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_client_request_id IS NULL
     OR char_length(btrim(coalesce(p_subject,''))) NOT BETWEEN 3 AND 200
     OR char_length(btrim(coalesce(p_description,''))) NOT BETWEEN 10 AND 5000
     OR p_language NOT IN ('ar','en') THEN
    RAISE EXCEPTION 'Invalid support ticket';
  END IF;
  IF p_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders order_record
    WHERE order_record.id = p_order_id AND (
      order_record.seeker_id = p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider
        WHERE provider.id = order_record.provider_id AND provider.user_id = p_actor_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'Order not available for support';
  END IF;

  SELECT * INTO v_existing FROM public.support_tickets
    WHERE requester_id = p_actor_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.subject IS DISTINCT FROM btrim(p_subject)
       OR v_existing.description IS DISTINCT FROM btrim(p_description)
       OR v_existing.language IS DISTINCT FROM p_language
       OR v_existing.order_id IS DISTINCT FROM p_order_id THEN
      RAISE EXCEPTION 'Ticket request ID was reused with different content';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  INSERT INTO public.support_tickets(
    requester_id,order_id,client_request_id,subject,description,language
  ) VALUES (
    p_actor_id,p_order_id,p_client_request_id,btrim(p_subject),btrim(p_description),p_language
  ) RETURNING * INTO v_ticket;

  FOR v_admin IN SELECT id FROM public.profiles WHERE is_admin AND public.is_account_active(id) LOOP
    PERFORM public.create_notification(
      v_admin.id,'support-ticket:' || v_ticket.id,'support',
      'طلب دعم جديد','New support ticket',
      'تم إنشاء طلب دعم جديد.','A new support ticket was created.',
      '/admin/support'
    );
  END LOOP;
  RETURN to_jsonb(v_ticket);
END $$;

CREATE FUNCTION public.reply_support_ticket(
  p_actor_id uuid,
  p_ticket_id uuid,
  p_client_request_id uuid,
  p_body text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_ticket public.support_tickets%rowtype;
  v_is_admin boolean;
  v_existing public.support_ticket_messages%rowtype;
  v_message public.support_ticket_messages%rowtype;
  v_admin record;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_client_request_id IS NULL
     OR char_length(btrim(coalesce(p_body,''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Invalid support reply';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.status = 'closed' THEN RAISE EXCEPTION 'Support ticket unavailable'; END IF;
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = p_actor_id;
  IF v_ticket.requester_id <> p_actor_id AND v_is_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Support ticket unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.support_ticket_messages
    WHERE ticket_id = p_ticket_id AND sender_id = p_actor_id
      AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.body IS DISTINCT FROM btrim(p_body) THEN
      RAISE EXCEPTION 'Reply request ID was reused with different content';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  INSERT INTO public.support_ticket_messages(ticket_id,sender_id,client_request_id,body)
    VALUES(p_ticket_id,p_actor_id,p_client_request_id,btrim(p_body))
    RETURNING * INTO v_message;
  UPDATE public.support_tickets
    SET assigned_to = CASE WHEN v_is_admin THEN p_actor_id ELSE assigned_to END,
        status = CASE WHEN v_is_admin THEN 'in_progress' ELSE status END,
        updated_at = now()
    WHERE id = p_ticket_id;

  IF v_is_admin THEN
    PERFORM public.create_notification(
      v_ticket.requester_id,'support-reply:' || v_message.id,'support',
      'رد جديد على طلب الدعم','New support reply',
      'أضاف فريق الإدارة رداً على طلب الدعم.','An administrator replied to your support ticket.',
      '/support?ticket=' || p_ticket_id
    );
  ELSE
    FOR v_admin IN SELECT id FROM public.profiles WHERE is_admin AND public.is_account_active(id) LOOP
      PERFORM public.create_notification(
        v_admin.id,'support-reply:' || v_message.id,'support',
        'رد جديد من المستخدم','New user reply',
        'أضاف المستخدم رداً على طلب الدعم.','A user replied to a support ticket.',
        '/admin/support?ticket=' || p_ticket_id
      );
    END LOOP;
  END IF;
  RETURN to_jsonb(v_message);
END $$;

ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN (
    'set_admin','verify_provider','set_service_active','review_withdrawal',
    'review_service','suspend_user','restore_user','support_ticket_status'
  ));

CREATE FUNCTION public.set_support_ticket_status(
  p_actor_id uuid,
  p_ticket_id uuid,
  p_status text,
  p_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_ticket public.support_tickets%rowtype;
  v_audit_id uuid;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND is_admin)
     OR p_status NOT IN ('open','in_progress','closed')
     OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid support status change';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found'; END IF;
  IF v_ticket.status = p_status THEN RETURN p_status; END IF;

  UPDATE public.support_tickets
    SET status = p_status,assigned_to = p_actor_id,updated_at = now(),
        closed_at = CASE WHEN p_status = 'closed' THEN now() ELSE NULL END
    WHERE id = p_ticket_id;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
    VALUES(
      p_actor_id,'support_ticket_status',p_ticket_id,
      jsonb_build_object('status',v_ticket.status),
      jsonb_build_object('status',p_status,'reason',btrim(p_reason))
    ) RETURNING id INTO v_audit_id;
  PERFORM public.create_notification(
    v_ticket.requester_id,'support-status:' || v_audit_id,'support',
    'تحديث طلب الدعم','Support ticket updated',
    'حالة طلب الدعم الآن: ' || p_status,'Support ticket status is now: ' || p_status,
    '/support?ticket=' || p_ticket_id
  );
  RETURN p_status;
END $$;

CREATE FUNCTION public.get_support_ticket_messages(p_actor_id uuid,p_ticket_id uuid)
RETURNS SETOF public.support_ticket_messages
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.support_tickets ticket
       WHERE ticket.id = p_ticket_id AND (
         ticket.requester_id = p_actor_id
         OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND is_admin)
       )
     ) THEN
    RAISE EXCEPTION 'Support ticket unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.support_ticket_messages
    WHERE ticket_id = p_ticket_id ORDER BY created_at,id;
END $$;

CREATE FUNCTION public.mark_notification_read(p_actor_id uuid,p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET read_at = coalesce(read_at,now())
    WHERE id = p_notification_id AND user_id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.get_user_notifications(p_actor_id uuid,p_limit integer)
RETURNS TABLE(
  id uuid,type text,title_ar text,title_en text,body_ar text,body_en text,
  link text,read_at timestamptz,created_at timestamptz,unread_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid notification query';
  END IF;
  RETURN QUERY
  SELECT
    notification.id,notification.type,notification.title_ar,notification.title_en,
    notification.body_ar,notification.body_en,notification.link,
    notification.read_at,notification.created_at,
    (SELECT count(*) FROM public.notifications unread
      WHERE unread.user_id = p_actor_id AND unread.read_at IS NULL)
  FROM public.notifications notification
  WHERE notification.user_id = p_actor_id
  ORDER BY notification.created_at DESC,notification.id DESC
  LIMIT p_limit;
END $$;

CREATE FUNCTION public.mark_all_notifications_read(p_actor_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET read_at = now()
    WHERE user_id = p_actor_id AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

CREATE FUNCTION public.export_user_data_snapshot_v3(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (public.export_user_data_snapshot_v2(p_actor_id) || jsonb_build_object(
    'schema_version',3,
    'support_tickets',coalesce((
      SELECT jsonb_agg(to_jsonb(ticket) ORDER BY ticket.created_at,ticket.id)
      FROM public.support_tickets ticket
      WHERE ticket.requester_id = p_actor_id OR ticket.assigned_to = p_actor_id
    ),'[]'::jsonb),
    'support_ticket_messages',coalesce((
      SELECT jsonb_agg(to_jsonb(message) ORDER BY message.created_at,message.id)
      FROM public.support_ticket_messages message
      JOIN public.support_tickets ticket ON ticket.id = message.ticket_id
      WHERE ticket.requester_id = p_actor_id OR message.sender_id = p_actor_id
    ),'[]'::jsonb),
    'notifications',coalesce((
      SELECT jsonb_agg(to_jsonb(notification) ORDER BY notification.created_at,notification.id)
      FROM public.notifications notification WHERE notification.user_id = p_actor_id
    ),'[]'::jsonb),
    'admin_actions_targeting_support',coalesce((
      SELECT jsonb_agg(to_jsonb(log) ORDER BY log.created_at,log.id)
      FROM public.admin_audit_log log
      JOIN public.support_tickets ticket ON ticket.id = log.target_id
      WHERE ticket.requester_id = p_actor_id
    ),'[]'::jsonb)
  ));
$$;

REVOKE ALL ON FUNCTION public.create_support_ticket(uuid,uuid,text,text,text,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reply_support_ticket(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_support_ticket_status(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_support_ticket_messages(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mark_notification_read(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_user_notifications(uuid,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read(uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.export_user_data_snapshot_v3(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(uuid,uuid,text,text,text,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reply_support_ticket(uuid,uuid,uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_support_ticket_status(uuid,uuid,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_messages(uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_notifications(uuid,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.export_user_data_snapshot_v3(uuid)
  TO service_role;

COMMIT;
