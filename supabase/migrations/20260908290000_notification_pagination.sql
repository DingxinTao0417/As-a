BEGIN;

CREATE FUNCTION public.get_user_notification_page(
  p_actor_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
) RETURNS TABLE(
  id uuid,type text,title_ar text,title_en text,body_ar text,body_en text,
  link text,read_at timestamptz,created_at timestamptz,unread_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'Invalid notification query';
  END IF;
  RETURN QUERY
  SELECT notification.id,notification.type,notification.title_ar,notification.title_en,
    notification.body_ar,notification.body_en,notification.link,notification.read_at,
    notification.created_at,
    (SELECT count(*) FROM public.notifications unread
      WHERE unread.user_id=p_actor_id AND unread.read_at IS NULL)
  FROM public.notifications notification
  WHERE notification.user_id=p_actor_id
    AND (
      p_before_created_at IS NULL
      OR notification.created_at<p_before_created_at
      OR (notification.created_at=p_before_created_at AND notification.id<p_before_id)
    )
  ORDER BY notification.created_at DESC,notification.id DESC
  LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.get_user_notification_page(uuid,timestamptz,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_notification_page(uuid,timestamptz,uuid,integer)
  TO service_role;

COMMIT;
