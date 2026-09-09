-- Fail closed on unknown policies: permissive PostgreSQL policies combine with OR.
-- Existing deployments must inventory and reconcile their policies in staging.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN
    ('profiles','providers','services','conversations','messages','orders','reviews','favorites','service_history','withdrawal_requests')) THEN
    RAISE EXCEPTION 'Existing application RLS policies require review before installing this policy set. Run supabase/checks/preflight.sql.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    RAISE EXCEPTION 'Existing Storage policies require review before installing this policy set.';
  END IF;
END $$;

CREATE FUNCTION public.is_account_active(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND deletion_requested_at IS NULL);
$$;
CREATE FUNCTION public.is_app_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_admin AND deletion_requested_at IS NULL);
$$;
CREATE FUNCTION public.owns_provider(p_provider_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.providers WHERE id = p_provider_id AND user_id = (SELECT auth.uid()))
    AND public.is_account_active((SELECT auth.uid()));
$$;
CREATE FUNCTION public.is_conversation_member(p_conversation_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_account_active((SELECT auth.uid())) AND EXISTS (
    SELECT 1 FROM public.conversations c JOIN public.providers p ON p.id = c.provider_id
    WHERE c.id = p_conversation_id AND (c.seeker_id = (SELECT auth.uid()) OR p.user_id = (SELECT auth.uid()))
  );
$$;
REVOKE ALL ON FUNCTION public.is_account_active(uuid),public.is_app_admin(),public.owns_provider(uuid),public.is_conversation_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid),public.is_app_admin(),public.owns_provider(uuid),public.is_conversation_member(uuid) TO anon,authenticated,service_role;

-- Deliberately exposes only non-sensitive display fields, never contact or role data.
CREATE VIEW public.public_profiles WITH (security_barrier = true) AS
  SELECT id,full_name,avatar_url FROM public.profiles WHERE deletion_requested_at IS NULL;
REVOKE ALL ON public.public_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.public_profiles TO anon,authenticated,service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profiles,public.providers,public.services,public.conversations,public.messages,public.orders,public.reviews,public.favorites,public.service_history,public.withdrawal_requests FROM anon,authenticated;
GRANT SELECT ON public.providers,public.services,public.reviews TO anon;
GRANT SELECT ON public.profiles,public.providers,public.services,public.conversations,public.messages,public.orders,public.reviews,public.favorites,public.service_history,public.withdrawal_requests TO authenticated;
GRANT INSERT,UPDATE ON public.profiles,public.providers,public.services,public.conversations,public.messages TO authenticated;
GRANT DELETE ON public.services TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.reviews TO authenticated;
GRANT INSERT,DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.profiles,public.providers,public.services,public.conversations,public.messages,public.orders,public.reviews,public.favorites,public.service_history,public.withdrawal_requests TO service_role;

CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING (id = (SELECT auth.uid()) OR public.is_app_admin());
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()) AND NOT is_admin AND role = 'seeker');
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (id = (SELECT auth.uid()) AND public.is_account_active(id)) WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY providers_read ON public.providers FOR SELECT TO anon,authenticated USING (
  (is_active AND public.is_account_active(user_id)) OR public.owns_provider(id) OR public.is_app_admin());
CREATE POLICY providers_insert ON public.providers FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_account_active(user_id));
CREATE POLICY providers_update ON public.providers FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()) AND public.is_account_active(user_id)) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY services_read ON public.services FOR SELECT TO anon,authenticated USING (
  (is_active AND EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.is_active AND public.is_account_active(p.user_id)))
  OR public.owns_provider(provider_id) OR public.is_app_admin());
CREATE POLICY services_insert ON public.services FOR INSERT TO authenticated WITH CHECK (public.owns_provider(provider_id) AND NOT is_active);
CREATE POLICY services_update ON public.services FOR UPDATE TO authenticated USING (public.owns_provider(provider_id)) WITH CHECK (public.owns_provider(provider_id));
CREATE POLICY services_delete ON public.services FOR DELETE TO authenticated USING (public.owns_provider(provider_id));

CREATE POLICY conversations_read ON public.conversations FOR SELECT TO authenticated USING (public.is_conversation_member(id));
CREATE POLICY conversations_insert ON public.conversations FOR INSERT TO authenticated WITH CHECK (
  seeker_id = (SELECT auth.uid()) AND public.is_account_active(seeker_id) AND EXISTS (
    SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.user_id <> (SELECT auth.uid()) AND public.is_account_active(p.user_id)));
CREATE POLICY conversations_update ON public.conversations FOR UPDATE TO authenticated USING (public.is_conversation_member(id)) WITH CHECK (public.is_conversation_member(id));

CREATE POLICY messages_read ON public.messages FOR SELECT TO authenticated USING (public.is_conversation_member(conversation_id));
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated WITH CHECK (
  sender_id = (SELECT auth.uid()) AND NOT is_read AND public.is_conversation_member(conversation_id) AND EXISTS (
    SELECT 1 FROM public.conversations c JOIN public.providers p ON p.id = c.provider_id
    WHERE c.id = conversation_id AND public.is_account_active(c.seeker_id) AND public.is_account_active(p.user_id)));
CREATE POLICY messages_update ON public.messages FOR UPDATE TO authenticated USING (
  sender_id <> (SELECT auth.uid()) AND public.is_conversation_member(conversation_id)) WITH CHECK (
  sender_id <> (SELECT auth.uid()) AND public.is_conversation_member(conversation_id));

-- Orders and money ledgers are written only by trusted server transactions.
CREATE POLICY orders_read ON public.orders FOR SELECT TO authenticated USING (
  public.is_account_active((SELECT auth.uid())) AND (seeker_id = (SELECT auth.uid()) OR public.owns_provider(provider_id) OR public.is_app_admin()));
CREATE POLICY history_read ON public.service_history FOR SELECT TO authenticated USING (
  public.is_account_active((SELECT auth.uid())) AND (seeker_id = (SELECT auth.uid()) OR public.owns_provider(provider_id) OR public.is_app_admin()));
CREATE POLICY withdrawals_read ON public.withdrawal_requests FOR SELECT TO authenticated USING (public.owns_provider(provider_id) OR public.is_app_admin());

CREATE POLICY reviews_read ON public.reviews FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY reviews_insert ON public.reviews FOR INSERT TO authenticated WITH CHECK (
  reviewer_id = (SELECT auth.uid()) AND public.is_account_active(reviewer_id) AND EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.seeker_id = (SELECT auth.uid())
    AND o.status = 'completed' AND o.service_id IS NOT DISTINCT FROM reviews.service_id));
CREATE POLICY reviews_update ON public.reviews FOR UPDATE TO authenticated USING (reviewer_id = (SELECT auth.uid()) AND public.is_account_active(reviewer_id)) WITH CHECK (reviewer_id = (SELECT auth.uid()));
CREATE POLICY reviews_delete ON public.reviews FOR DELETE TO authenticated USING (reviewer_id = (SELECT auth.uid()) AND public.is_account_active(reviewer_id));
CREATE POLICY favorites_read ON public.favorites FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND public.is_account_active(user_id));
CREATE POLICY favorites_insert ON public.favorites FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_account_active(user_id));
CREATE POLICY favorites_delete ON public.favorites FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) AND public.is_account_active(user_id));

-- Row policies control ownership; triggers also protect immutable/sensitive columns.
-- This function is SECURITY INVOKER. Trusted definer transactions run as postgres.
CREATE FUNCTION public.guard_client_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin') OR (SELECT auth.role()) = 'service_role' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN NEW.created_at := now(); END IF;
  IF TG_TABLE_NAME = 'profiles' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_admin OR NEW.role <> 'seeker' OR NEW.deletion_requested_at IS NOT NULL THEN RAISE EXCEPTION 'Protected profile fields' USING ERRCODE = '42501'; END IF;
    ELSIF (to_jsonb(NEW) - ARRAY['full_name','phone','avatar_url','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['full_name','phone','avatar_url','updated_at']) THEN
      RAISE EXCEPTION 'Protected profile fields' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'providers' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_verified OR NEW.rating <> 0 OR NEW.reviews_count <> 0 OR NEW.completed_projects <> 0 OR NEW.tap_destination_id IS NOT NULL OR NEW.tap_onboarding_completed OR NEW.tap_account_status <> 'not_connected' THEN
        RAISE EXCEPTION 'Protected provider fields' USING ERRCODE = '42501';
      END IF;
    ELSIF (to_jsonb(NEW) - ARRAY['name_ar','name_en','title_ar','title_en','bio_ar','bio_en','avatar_url','display_name','title','bio','category','hourly_rate','starting_price','skills','categories','response_time','availability','languages','location','portfolio_urls','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['name_ar','name_en','title_ar','title_en','bio_ar','bio_en','avatar_url','display_name','title','bio','category','hourly_rate','starting_price','skills','categories','response_time','availability','languages','location','portfolio_urls','updated_at']) THEN
      RAISE EXCEPTION 'Protected provider fields' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'services' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_active THEN RAISE EXCEPTION 'Services require moderation' USING ERRCODE = '42501'; END IF;
    ELSIF (to_jsonb(NEW) - ARRAY['name_ar','name_en','description_ar','description_en','category','price','price_type','delivery_time','features','image_urls','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['name_ar','name_en','description_ar','description_en','category','price','price_type','delivery_time','features','image_urls','updated_at']) THEN
      RAISE EXCEPTION 'Protected service fields' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      NEW.is_active := false;
    END IF;
  ELSIF TG_TABLE_NAME = 'conversations' AND TG_OP = 'INSERT' THEN
    NEW.is_pinned_by_seeker := false; NEW.is_pinned_by_provider := false;
    NEW.is_archived_by_seeker := false; NEW.is_archived_by_provider := false;
    NEW.seeker_cleared_at := NULL; NEW.provider_cleared_at := NULL;
    NEW.last_message_at := now();
  ELSIF TG_TABLE_NAME = 'conversations' AND TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.seeker_id <> OLD.seeker_id OR NEW.provider_id <> OLD.provider_id OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Conversation participants are immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.seeker_id = (SELECT auth.uid()) THEN
      IF ROW(NEW.is_pinned_by_provider,NEW.is_archived_by_provider,NEW.provider_cleared_at) IS DISTINCT FROM ROW(OLD.is_pinned_by_provider,OLD.is_archived_by_provider,OLD.provider_cleared_at) THEN
        RAISE EXCEPTION 'Other participant preferences are private' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF ROW(NEW.is_pinned_by_seeker,NEW.is_archived_by_seeker,NEW.seeker_cleared_at) IS DISTINCT FROM ROW(OLD.is_pinned_by_seeker,OLD.is_archived_by_seeker,OLD.seeker_cleared_at) THEN
        RAISE EXCEPTION 'Other participant preferences are private' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'messages' AND TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'is_read') IS DISTINCT FROM (to_jsonb(OLD) - 'is_read') OR NOT NEW.is_read THEN
      RAISE EXCEPTION 'Only marking received messages as read is allowed' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'reviews' AND TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['rating','comment']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['rating','comment']) THEN
      RAISE EXCEPTION 'Review associations are immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_client_columns() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_profiles BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_client_columns();
CREATE TRIGGER guard_providers BEFORE INSERT OR UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION public.guard_client_columns();
CREATE TRIGGER guard_services BEFORE INSERT OR UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.guard_client_columns();
CREATE TRIGGER guard_conversations BEFORE INSERT OR UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.guard_client_columns();
CREATE TRIGGER guard_messages BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.guard_client_columns();
CREATE TRIGGER guard_reviews BEFORE INSERT OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.guard_client_columns();

CREATE FUNCTION public.set_provider_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.profiles SET role = 'provider',updated_at = now() WHERE id = NEW.user_id AND deletion_requested_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.set_provider_role() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER set_provider_role AFTER INSERT ON public.providers FOR EACH ROW EXECUTE FUNCTION public.set_provider_role();

CREATE FUNCTION public.refresh_provider_reviews() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected_provider uuid;
BEGIN
  SELECT provider_id INTO affected_provider FROM public.orders WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  PERFORM id FROM public.providers WHERE id = affected_provider FOR UPDATE;
  UPDATE public.providers SET
    rating = (SELECT coalesce(round(avg(r.rating)::numeric,2),0) FROM public.reviews r JOIN public.orders o ON o.id = r.order_id WHERE o.provider_id = affected_provider),
    reviews_count = (SELECT count(*) FROM public.reviews r JOIN public.orders o ON o.id = r.order_id WHERE o.provider_id = affected_provider)
  WHERE id = affected_provider;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.refresh_provider_reviews() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER refresh_provider_reviews AFTER INSERT OR UPDATE OR DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.refresh_provider_reviews();

-- Serializes order creation with deletion and checks cross-table ownership even
-- for server-role inserts, so a new order cannot arrive after soft deletion.
CREATE FUNCTION public.guard_order_participants() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE provider_user uuid;
BEGIN
  SELECT user_id INTO provider_user FROM public.providers WHERE id = NEW.provider_id AND is_active;
  PERFORM id FROM public.profiles WHERE id IN (NEW.seeker_id,provider_user) ORDER BY id FOR KEY SHARE;
  IF NOT public.is_account_active(NEW.seeker_id) OR NOT public.is_account_active(provider_user) OR NEW.seeker_id = provider_user THEN
    RAISE EXCEPTION 'Active distinct order participants required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = NEW.conversation_id AND c.seeker_id = NEW.seeker_id AND c.provider_id = NEW.provider_id) THEN
    RAISE EXCEPTION 'Order conversation does not match participants' USING ERRCODE = '23514';
  END IF;
  IF NEW.service_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.services s WHERE s.id = NEW.service_id AND s.provider_id = NEW.provider_id AND s.is_active) THEN
    RAISE EXCEPTION 'Order service must be active and belong to provider' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_order_participants() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_order_participants BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_participants();

CREATE FUNCTION public.request_account_deletion() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := (SELECT auth.uid());
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM id FROM public.profiles WHERE id = actor AND deletion_requested_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501'; END IF;
  -- Also serializes with request_provider_withdrawal, which locks the provider.
  PERFORM id FROM public.providers WHERE user_id = actor FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.status IN ('pending','paid','awaiting_confirmation') AND
    (o.seeker_id = actor OR o.provider_id IN (SELECT id FROM public.providers WHERE user_id = actor)))
    OR EXISTS (SELECT 1 FROM public.withdrawal_requests w JOIN public.providers p ON p.id = w.provider_id
      WHERE p.user_id = actor AND w.status IN ('pending','approved'))
    OR EXISTS (SELECT 1 FROM public.providers p WHERE p.user_id = actor AND
      coalesce((SELECT sum(o.provider_amount) FROM public.orders o WHERE o.provider_id = p.id AND o.status = 'completed'),0)
      > coalesce((SELECT sum(w.amount) FROM public.withdrawal_requests w WHERE w.provider_id = p.id AND w.status = 'completed'),0)) THEN
    RAISE EXCEPTION 'Active orders, withdrawals, or unsettled earnings prevent deletion';
  END IF;
  UPDATE public.services SET is_active = false WHERE provider_id IN (SELECT id FROM public.providers WHERE user_id = actor);
  UPDATE public.providers SET name_ar = '[Deleted User]',name_en = '[Deleted User]',display_name = '[Deleted User]',
    avatar_url = NULL,bio_ar = NULL,bio_en = NULL,bio = NULL,is_active = false WHERE user_id = actor;
  UPDATE public.profiles SET deletion_requested_at = now(),full_name = '[Deleted User]',phone = NULL,avatar_url = NULL,updated_at = now() WHERE id = actor;
END $$;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

CREATE TABLE public.rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON public.rate_limits(expires_at);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.rate_limits TO service_role;
CREATE FUNCTION public.consume_rate_limit(p_key text,p_limit integer,p_window_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE consumed integer;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 300 OR p_limit NOT BETWEEN 1 AND 10000 OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.rate_limits AS r (key,window_started_at,request_count,expires_at)
  VALUES (p_key,now(),1,now() + make_interval(secs => p_window_seconds))
  ON CONFLICT (key) DO UPDATE SET
    request_count = CASE WHEN r.expires_at <= now() THEN 1 ELSE r.request_count + 1 END,
    window_started_at = CASE WHEN r.expires_at <= now() THEN now() ELSE r.window_started_at END,
    expires_at = CASE WHEN r.expires_at <= now() THEN now() + make_interval(secs => p_window_seconds) ELSE r.expires_at END
  WHERE r.expires_at <= now() OR r.request_count < p_limit
  RETURNING request_count INTO consumed;
  RETURN consumed IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text,integer,integer) TO service_role;

-- Bucket paths match the application's upload paths. SVG is intentionally denied.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('avatars','avatars',true,5242880,ARRAY['image/jpeg','image/png','image/webp']),
       ('service-images','service-images',true,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY app_images_read ON storage.objects FOR SELECT TO anon,authenticated USING (bucket_id IN ('avatars','service-images'));
CREATE POLICY app_images_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  public.is_account_active((SELECT auth.uid())) AND (
    (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    OR (bucket_id = 'service-images' AND EXISTS (SELECT 1 FROM public.providers p WHERE p.id::text = (storage.foldername(name))[1] AND p.user_id = (SELECT auth.uid())))));
CREATE POLICY app_images_update ON storage.objects FOR UPDATE TO authenticated USING (
  public.is_account_active((SELECT auth.uid())) AND (
    (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    OR (bucket_id = 'service-images' AND EXISTS (SELECT 1 FROM public.providers p WHERE p.id::text = (storage.foldername(name))[1] AND p.user_id = (SELECT auth.uid())))))
WITH CHECK (public.is_account_active((SELECT auth.uid())) AND (
  (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  OR (bucket_id = 'service-images' AND EXISTS (SELECT 1 FROM public.providers p WHERE p.id::text = (storage.foldername(name))[1] AND p.user_id = (SELECT auth.uid())))));
CREATE POLICY app_images_delete ON storage.objects FOR DELETE TO authenticated USING (
  public.is_account_active((SELECT auth.uid())) AND (
    (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
    OR (bucket_id = 'service-images' AND EXISTS (SELECT 1 FROM public.providers p WHERE p.id::text = (storage.foldername(name))[1] AND p.user_id = (SELECT auth.uid())))));

DO $$
DECLARE relation_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH relation_name IN ARRAY ARRAY['messages','conversations','orders'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = relation_name) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',relation_name);
      END IF;
    END LOOP;
  END IF;
END $$;
