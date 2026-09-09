BEGIN;

ALTER TABLE public.ai_knowledge_articles
  ADD COLUMN created_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN published_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN published_at timestamptz,
  ADD COLUMN client_request_id uuid,
  ADD COLUMN change_note text CHECK(change_note IS NULL OR char_length(change_note)<=1000);
CREATE UNIQUE INDEX ai_knowledge_publish_request_unique
  ON public.ai_knowledge_articles(created_by,client_request_id)
  WHERE client_request_id IS NOT NULL;
UPDATE public.ai_knowledge_articles SET published_at=created_at WHERE is_active;

ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK(action IN (
  'set_admin','verify_provider','set_service_active','review_withdrawal','review_service',
  'suspend_user','restore_user','support_ticket_status','refund_review','dispute_review',
  'payout_tracking','payment_event_relink','provider_verification_review','ai_knowledge_publish'
));

CREATE FUNCTION public.publish_ai_knowledge_version(
  p_actor_id uuid,p_client_request_id uuid,p_article_key text,
  p_title_ar text,p_title_en text,p_body_ar text,p_body_en text,p_change_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_existing public.ai_knowledge_articles%rowtype;
  v_previous public.ai_knowledge_articles%rowtype;
  v_article public.ai_knowledge_articles%rowtype;
  v_version integer;
BEGIN
  IF p_actor_id IS NULL OR p_client_request_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR btrim(coalesce(p_article_key,''))!~'^[a-z0-9][a-z0-9._-]{0,99}$'
    OR char_length(btrim(coalesce(p_title_ar,''))) NOT BETWEEN 1 AND 300
    OR char_length(btrim(coalesce(p_title_en,''))) NOT BETWEEN 1 AND 300
    OR char_length(btrim(coalesce(p_body_ar,''))) NOT BETWEEN 1 AND 5000
    OR char_length(btrim(coalesce(p_body_en,''))) NOT BETWEEN 1 AND 5000
    OR char_length(btrim(coalesce(p_change_note,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid knowledge version' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_existing FROM public.ai_knowledge_articles
  WHERE created_by=p_actor_id AND client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_existing.article_key<>btrim(p_article_key)
      OR v_existing.title_ar<>btrim(p_title_ar) OR v_existing.title_en<>btrim(p_title_en)
      OR v_existing.body_ar<>btrim(p_body_ar) OR v_existing.body_en<>btrim(p_body_en)
      OR v_existing.change_note<>btrim(p_change_note) THEN
      RAISE EXCEPTION 'Knowledge request identifier was reused with different content';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  LOCK TABLE public.ai_knowledge_articles IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO v_previous FROM public.ai_knowledge_articles
  WHERE article_key=btrim(p_article_key) AND is_active FOR UPDATE;
  SELECT coalesce(max(version),0)+1 INTO v_version FROM public.ai_knowledge_articles
  WHERE article_key=btrim(p_article_key);
  UPDATE public.ai_knowledge_articles SET is_active=false
  WHERE article_key=btrim(p_article_key) AND is_active;
  INSERT INTO public.ai_knowledge_articles(
    article_key,version,title_ar,title_en,body_ar,body_en,is_active,
    created_by,published_by,published_at,client_request_id,change_note
  ) VALUES(
    btrim(p_article_key),v_version,btrim(p_title_ar),btrim(p_title_en),
    btrim(p_body_ar),btrim(p_body_en),true,p_actor_id,p_actor_id,now(),
    p_client_request_id,btrim(p_change_note)
  ) RETURNING * INTO v_article;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
  VALUES(
    p_actor_id,'ai_knowledge_publish',v_article.id,
    CASE WHEN v_previous.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'article_key',v_previous.article_key,'version',v_previous.version,'is_active',v_previous.is_active
    ) END,
    jsonb_build_object(
      'article_key',v_article.article_key,'version',v_article.version,
      'is_active',true,'change_note',v_article.change_note
    )
  );
  RETURN to_jsonb(v_article);
END $$;

CREATE FUNCTION public.set_ai_knowledge_version_active(
  p_actor_id uuid,p_article_id uuid,p_active boolean,p_change_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_article public.ai_knowledge_articles%rowtype;
  v_previous public.ai_knowledge_articles%rowtype;
BEGIN
  IF p_actor_id IS NULL OR p_active IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR char_length(btrim(coalesce(p_change_note,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid knowledge activation' USING ERRCODE='42501';
  END IF;
  LOCK TABLE public.ai_knowledge_articles IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO v_article FROM public.ai_knowledge_articles WHERE id=p_article_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Knowledge version not found'; END IF;
  IF v_article.is_active=p_active THEN RETURN to_jsonb(v_article); END IF;
  SELECT * INTO v_previous FROM public.ai_knowledge_articles
  WHERE article_key=v_article.article_key AND is_active FOR UPDATE;
  IF p_active THEN
    UPDATE public.ai_knowledge_articles SET is_active=false
    WHERE article_key=v_article.article_key AND is_active;
  END IF;
  UPDATE public.ai_knowledge_articles SET
    is_active=p_active,published_by=CASE WHEN p_active THEN p_actor_id ELSE published_by END,
    published_at=CASE WHEN p_active THEN now() ELSE published_at END
  WHERE id=v_article.id RETURNING * INTO v_article;
  INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data)
  VALUES(
    p_actor_id,'ai_knowledge_publish',v_article.id,
    jsonb_build_object(
      'article_key',v_article.article_key,
      'active_version',CASE WHEN v_previous.id IS NULL THEN NULL ELSE v_previous.version END
    ),
    jsonb_build_object(
      'article_key',v_article.article_key,'version',v_article.version,
      'is_active',p_active,'change_note',btrim(p_change_note)
    )
  );
  RETURN to_jsonb(v_article);
END $$;

CREATE FUNCTION public.get_admin_ai_knowledge_page(
  p_actor_id uuid,p_query text,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_total bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR char_length(coalesce(p_query,''))>100
    OR ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid knowledge page' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_total FROM public.ai_knowledge_articles article
  WHERE nullif(btrim(coalesce(p_query,'')),'') IS NULL
    OR article.article_key ILIKE '%'||btrim(p_query)||'%'
    OR article.title_ar ILIKE '%'||btrim(p_query)||'%'
    OR article.title_en ILIKE '%'||btrim(p_query)||'%';
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT article.*,creator.email AS creator_email,publisher.email AS publisher_email
    FROM public.ai_knowledge_articles article
    LEFT JOIN public.profiles creator ON creator.id=article.created_by
    LEFT JOIN public.profiles publisher ON publisher.id=article.published_by
    WHERE (
      nullif(btrim(coalesce(p_query,'')),'') IS NULL
      OR article.article_key ILIKE '%'||btrim(p_query)||'%'
      OR article.title_ar ILIKE '%'||btrim(p_query)||'%'
      OR article.title_en ILIKE '%'||btrim(p_query)||'%'
    ) AND (
      p_before_created_at IS NULL
      OR article.created_at<p_before_created_at
      OR (article.created_at=p_before_created_at AND article.id<p_before_id)
    )
    ORDER BY article.created_at DESC,article.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('articles',v_rows,'total',v_total);
END $$;

REVOKE ALL ON FUNCTION public.publish_ai_knowledge_version(uuid,uuid,text,text,text,text,text,text),
  public.set_ai_knowledge_version_active(uuid,uuid,boolean,text),
  public.get_admin_ai_knowledge_page(uuid,text,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_ai_knowledge_version(uuid,uuid,text,text,text,text,text,text),
  public.set_ai_knowledge_version_active(uuid,uuid,boolean,text),
  public.get_admin_ai_knowledge_page(uuid,text,timestamptz,uuid,integer)
TO service_role;

COMMIT;
