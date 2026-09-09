BEGIN;

CREATE TABLE public.ai_knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_key text NOT NULL CHECK (char_length(article_key) BETWEEN 1 AND 100),
  version integer NOT NULL CHECK (version > 0),
  title_ar text NOT NULL,
  title_en text NOT NULL,
  body_ar text NOT NULL CHECK (char_length(body_ar) BETWEEN 1 AND 5000),
  body_en text NOT NULL CHECK (char_length(body_en) BETWEEN 1 AND 5000),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(article_key,version)
);
CREATE UNIQUE INDEX ai_knowledge_one_active_version
  ON public.ai_knowledge_articles(article_key) WHERE is_active;

CREATE TABLE public.ai_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_session_id uuid NOT NULL,
  language text NOT NULL CHECK (language IN ('ar','en')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,client_session_id)
);
CREATE INDEX ai_chat_sessions_user_updated_idx
  ON public.ai_chat_sessions(user_id,updated_at DESC);

CREATE TABLE public.ai_chat_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.ai_chat_sessions(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  user_content text NOT NULL CHECK (char_length(user_content) BETWEEN 1 AND 4000),
  assistant_content text CHECK (assistant_content IS NULL OR char_length(assistant_content) BETWEEN 1 AND 8000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  failure_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,client_request_id),
  CHECK ((status = 'completed' AND assistant_content IS NOT NULL AND failure_category IS NULL)
    OR (status = 'failed' AND assistant_content IS NULL AND failure_category IS NOT NULL)
    OR (status = 'pending' AND assistant_content IS NULL AND failure_category IS NULL))
);
CREATE INDEX ai_chat_turns_session_created_idx
  ON public.ai_chat_turns(session_id,created_at,id);

ALTER TABLE public.ai_knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_knowledge_articles,public.ai_chat_sessions,public.ai_chat_turns
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ai_chat_sessions,public.ai_chat_turns TO authenticated;
GRANT ALL ON public.ai_knowledge_articles,public.ai_chat_sessions,public.ai_chat_turns TO service_role;
CREATE POLICY ai_session_owner_read ON public.ai_chat_sessions
  FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) AND public.is_account_active(user_id)
  );
CREATE POLICY ai_turn_owner_read ON public.ai_chat_turns
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.ai_chat_sessions session_record
      WHERE session_record.id = session_id
        AND session_record.user_id = (SELECT auth.uid())
        AND public.is_account_active(session_record.user_id)
    )
  );

INSERT INTO public.ai_knowledge_articles(
  article_key,version,title_ar,title_en,body_ar,body_en,is_active
) VALUES
('marketplace',1,'نطاق المنصة','Marketplace scope',
 'أسعى سوق للخدمات يربط الباحثين بمقدمي الخدمات. تصفح القوائم المنشورة، راجع ملف مقدم الخدمة، ثم استخدم الرسائل لمناقشة النطاق أو العرض.',
 'As''a is a services marketplace connecting clients and providers. Browse published listings, review the provider profile, then use messages to discuss scope or a quote.',true),
('verification',1,'حالة التوثيق','Verification status',
 'لا تعني العضوية أن مقدم الخدمة موثق. تظهر شارة التوثيق فقط عندما تسجل قاعدة البيانات قرار مراجعة من الإدارة.',
 'Membership does not mean a provider is verified. A verification badge appears only when the database records an administrator review decision.',true),
('orders',1,'الطلبات والتسليم','Orders and delivery',
 'حالة الطلب الظاهرة في الرسائل أو السجل هي المرجع. بعد الدفع يمكن لمقدم الخدمة إرسال نسخة تسليم، ويمكن للعميل قبولها أو طلب تعديل بسبب مكتوب.',
 'The order status shown in messages or history is the source of truth. After payment, a provider can submit a delivery version and the client can accept it or request a revision with a written reason.',true),
('payments',1,'الدفع والسحب','Payments and withdrawals',
 'قد تكون عمليات الدفع أو السحب غير متاحة حتى اكتمال إعداد بيئة الدفع والتحقق منها. لا تفترض نجاح دفع أو استرداد أو سحب من مجرد رجوع المتصفح؛ راجع حالة الطلب أو الإشعار.',
 'Payments or withdrawals may be unavailable until the payment environment is configured and verified. A browser return alone does not prove a charge, refund, or payout succeeded; check the order status or notification.',true),
('support',1,'الدعم','Support',
 'للمسائل التي تحتاج مراجعة من الإدارة، أنشئ طلباً من صفحة الدعم ويمكنك متابعة الردود والحالة. لا يوجد وقت استجابة مضمون حالياً.',
 'For matters requiring administrator review, create a ticket on the Support page and follow its replies and status. No response-time guarantee is currently offered.',true);

CREATE FUNCTION public.get_active_ai_knowledge()
RETURNS SETOF public.ai_knowledge_articles
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM public.ai_knowledge_articles
  WHERE is_active ORDER BY article_key;
$$;

CREATE FUNCTION public.begin_ai_chat_turn(
  p_actor_id uuid,
  p_session_id uuid,
  p_client_session_id uuid,
  p_client_request_id uuid,
  p_content text,
  p_language text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_session public.ai_chat_sessions%rowtype;
  v_turn public.ai_chat_turns%rowtype;
  v_context jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_client_session_id IS NULL OR p_client_request_id IS NULL
     OR char_length(btrim(coalesce(p_content,''))) NOT BETWEEN 1 AND 4000
     OR p_language NOT IN ('ar','en') THEN
    RAISE EXCEPTION 'Invalid AI chat turn';
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.ai_chat_sessions
      WHERE id = p_session_id AND user_id = p_actor_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR p_session_id IS NULL THEN
    SELECT * INTO v_session FROM public.ai_chat_sessions
      WHERE user_id = p_actor_id AND client_session_id = p_client_session_id
      FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.ai_chat_sessions(user_id,client_session_id,language)
      VALUES(p_actor_id,p_client_session_id,p_language)
      RETURNING * INTO v_session;
  END IF;

  SELECT * INTO v_turn FROM public.ai_chat_turns
    WHERE session_id = v_session.id AND client_request_id = p_client_request_id
    FOR UPDATE;
  IF FOUND THEN
    IF v_turn.user_content IS DISTINCT FROM btrim(p_content) THEN
      RAISE EXCEPTION 'AI request ID was reused with different content';
    END IF;
    IF v_turn.status = 'completed' THEN
      RETURN jsonb_build_object(
        'session_id',v_session.id,'turn_status','completed',
        'assistant_content',v_turn.assistant_content,'context_turns','[]'::jsonb
      );
    END IF;
    UPDATE public.ai_chat_turns
      SET status = 'pending',failure_category = NULL,updated_at = now()
      WHERE id = v_turn.id;
  ELSE
    INSERT INTO public.ai_chat_turns(session_id,client_request_id,user_content)
      VALUES(v_session.id,p_client_request_id,btrim(p_content))
      RETURNING * INTO v_turn;
  END IF;

  UPDATE public.ai_chat_sessions
    SET language = p_language,updated_at = now(),archived_at = NULL
    WHERE id = v_session.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'user',history.user_content,'assistant',history.assistant_content
  ) ORDER BY history.created_at,history.id),'[]'::jsonb)
  INTO v_context
  FROM (
    SELECT * FROM public.ai_chat_turns
    WHERE session_id = v_session.id AND status = 'completed'
      AND id <> v_turn.id
    ORDER BY created_at DESC,id DESC LIMIT 10
  ) history;

  RETURN jsonb_build_object(
    'session_id',v_session.id,'turn_status','pending',
    'assistant_content',NULL,'context_turns',v_context
  );
END $$;

CREATE FUNCTION public.complete_ai_chat_turn(
  p_actor_id uuid,
  p_session_id uuid,
  p_client_request_id uuid,
  p_assistant_content text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_turn public.ai_chat_turns%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR char_length(btrim(coalesce(p_assistant_content,''))) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'Invalid AI response';
  END IF;
  SELECT turn_record.* INTO v_turn
    FROM public.ai_chat_turns turn_record
    JOIN public.ai_chat_sessions session_record ON session_record.id = turn_record.session_id
    WHERE turn_record.session_id = p_session_id
      AND turn_record.client_request_id = p_client_request_id
      AND session_record.user_id = p_actor_id
    FOR UPDATE OF turn_record;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI turn not found'; END IF;
  IF v_turn.status = 'completed' THEN RETURN v_turn.assistant_content; END IF;
  UPDATE public.ai_chat_turns
    SET status = 'completed',assistant_content = btrim(p_assistant_content),
        failure_category = NULL,updated_at = now()
    WHERE id = v_turn.id;
  RETURN btrim(p_assistant_content);
END $$;

CREATE FUNCTION public.fail_ai_chat_turn(
  p_actor_id uuid,
  p_session_id uuid,
  p_client_request_id uuid,
  p_failure_category text
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_failure_category NOT IN ('configuration','upstream','timeout','invalid_response','persistence') THEN
    RAISE EXCEPTION 'Invalid failure category';
  END IF;
  UPDATE public.ai_chat_turns turn_record
    SET status = 'failed',assistant_content = NULL,
        failure_category = p_failure_category,updated_at = now()
    FROM public.ai_chat_sessions session_record
    WHERE turn_record.session_id = p_session_id
      AND turn_record.client_request_id = p_client_request_id
      AND session_record.id = turn_record.session_id
      AND session_record.user_id = p_actor_id
      AND public.is_account_active(p_actor_id)
      AND turn_record.status <> 'completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'AI turn not found'; END IF;
END $$;

CREATE FUNCTION public.get_ai_chat_session(p_actor_id uuid,p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_session public.ai_chat_sessions%rowtype;
  v_turns jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.ai_chat_sessions
    WHERE id = p_session_id AND user_id = p_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI session not found' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'client_request_id',turn_record.client_request_id,
    'user',turn_record.user_content,
    'assistant',turn_record.assistant_content,
    'created_at',turn_record.created_at
  ) ORDER BY turn_record.created_at,turn_record.id),'[]'::jsonb)
  INTO v_turns
  FROM (
    SELECT * FROM public.ai_chat_turns
    WHERE session_id = p_session_id AND status = 'completed'
    ORDER BY created_at DESC,id DESC LIMIT 50
  ) turn_record;
  RETURN jsonb_build_object('id',v_session.id,'language',v_session.language,'turns',v_turns);
END $$;

CREATE FUNCTION public.get_ai_order_context(p_actor_id uuid,p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501';
  END IF;
  SELECT order_record.* INTO v_order
    FROM public.orders order_record
    WHERE order_record.id = p_order_id AND (
      order_record.seeker_id = p_actor_id OR EXISTS (
        SELECT 1 FROM public.providers provider
        WHERE provider.id = order_record.provider_id AND provider.user_id = p_actor_id
      )
    );
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id',v_order.id,'status',v_order.status,
    'service_name_ar',v_order.service_name_ar,'service_name_en',v_order.service_name_en,
    'amount',v_order.amount,'currency',v_order.currency,
    'delivery_version',v_order.delivery_version,
    'created_at',v_order.created_at,'paid_at',v_order.paid_at,
    'delivered_at',v_order.completed_at
  );
END $$;

CREATE FUNCTION public.export_user_data_snapshot_v4(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (public.export_user_data_snapshot_v3(p_actor_id) || jsonb_build_object(
    'schema_version',4,
    'ai_chat_sessions',coalesce((
      SELECT jsonb_agg(to_jsonb(session_record) ORDER BY session_record.created_at,session_record.id)
      FROM public.ai_chat_sessions session_record WHERE session_record.user_id = p_actor_id
    ),'[]'::jsonb),
    'ai_chat_turns',coalesce((
      SELECT jsonb_agg(to_jsonb(turn_record) ORDER BY turn_record.created_at,turn_record.id)
      FROM public.ai_chat_turns turn_record
      JOIN public.ai_chat_sessions session_record ON session_record.id = turn_record.session_id
      WHERE session_record.user_id = p_actor_id
    ),'[]'::jsonb)
  ));
$$;

REVOKE ALL ON FUNCTION public.get_active_ai_knowledge()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_ai_chat_turn(uuid,uuid,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_ai_chat_turn(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_ai_chat_turn(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_ai_chat_session(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_ai_order_context(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.export_user_data_snapshot_v4(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_ai_knowledge() TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_ai_chat_turn(uuid,uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ai_chat_turn(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_ai_chat_turn(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_chat_session(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_order_context(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.export_user_data_snapshot_v4(uuid) TO service_role;

COMMIT;
