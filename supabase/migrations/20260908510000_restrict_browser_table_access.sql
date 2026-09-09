BEGIN;

-- Storage policies must keep working after browser roles lose SELECT on providers.
CREATE FUNCTION public.owns_provider_storage_path(p_object_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.is_account_active((SELECT auth.uid())) AND EXISTS(
    SELECT 1 FROM public.providers provider
    WHERE provider.id::text=(storage.foldername(p_object_name))[1]
      AND provider.user_id=(SELECT auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.owns_provider_storage_path(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owns_provider_storage_path(text) TO authenticated,service_role;

CREATE FUNCTION public.owns_active_provider_storage_path(p_object_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.is_account_active((SELECT auth.uid())) AND EXISTS(
    SELECT 1 FROM public.providers provider
    WHERE provider.id::text=(storage.foldername(p_object_name))[1]
      AND provider.user_id=(SELECT auth.uid())
      AND provider.is_active
  );
$$;
REVOKE ALL ON FUNCTION public.owns_active_provider_storage_path(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owns_active_provider_storage_path(text) TO authenticated,service_role;

CREATE FUNCTION public.owns_order_delivery_storage_path(p_object_name text,p_require_open_status boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.is_account_active((SELECT auth.uid()))
    AND (storage.foldername(p_object_name))[2]=(SELECT auth.uid())::text
    AND EXISTS(
      SELECT 1 FROM public.orders order_record
      JOIN public.providers provider ON provider.id=order_record.provider_id
      WHERE order_record.id::text=(storage.foldername(p_object_name))[1]
        AND provider.user_id=(SELECT auth.uid())
        AND (NOT p_require_open_status OR order_record.status IN ('paid','revision_requested'))
    );
$$;
REVOKE ALL ON FUNCTION public.owns_order_delivery_storage_path(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owns_order_delivery_storage_path(text,boolean) TO authenticated,service_role;

DROP POLICY app_images_insert ON storage.objects;
DROP POLICY app_images_update ON storage.objects;
DROP POLICY app_images_delete ON storage.objects;

CREATE POLICY app_images_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  public.is_account_active((SELECT auth.uid())) AND (
    (bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
    OR (bucket_id='service-images' AND public.owns_provider_storage_path(name))));
CREATE POLICY app_images_update ON storage.objects FOR UPDATE TO authenticated USING (
  public.is_account_active((SELECT auth.uid())) AND (
    (bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
    OR (bucket_id='service-images' AND public.owns_provider_storage_path(name))))
WITH CHECK (public.is_account_active((SELECT auth.uid())) AND (
  (bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
  OR (bucket_id='service-images' AND public.owns_provider_storage_path(name))));
CREATE POLICY app_images_delete ON storage.objects FOR DELETE TO authenticated USING (
  public.is_account_active((SELECT auth.uid())) AND (
    (bucket_id='avatars' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
    OR (bucket_id='service-images' AND public.owns_provider_storage_path(name))));

DROP POLICY order_delivery_object_insert ON storage.objects;
DROP POLICY order_delivery_object_delete ON storage.objects;
CREATE POLICY order_delivery_object_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id='order-deliveries'
  AND public.owns_order_delivery_storage_path(name,true)
);
CREATE POLICY order_delivery_object_delete ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id='order-deliveries'
  AND public.owns_order_delivery_storage_path(name,false)
  AND NOT EXISTS(
    SELECT 1 FROM public.order_deliveries delivery,
      jsonb_array_elements(coalesce(delivery.files,'[]'::jsonb)) file_record
    WHERE file_record->>'path'=name
  )
);

DROP POLICY provider_verification_object_read ON storage.objects;
DROP POLICY provider_verification_object_insert ON storage.objects;
CREATE POLICY provider_verification_object_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id='provider-verification'
  AND public.is_account_active((SELECT auth.uid()))
  AND (public.is_app_admin() OR public.owns_provider_storage_path(name))
);
CREATE POLICY provider_verification_object_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id='provider-verification'
  AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
  AND public.owns_active_provider_storage_path(name)
);

-- Browser code now reads these records through explicit server projections.
REVOKE SELECT ON public.providers,public.services,public.reviews,public.favorites FROM anon,authenticated;

-- All application writes use actor-scoped trusted transactions. Realtime keeps
-- SELECT on conversations, messages and orders for participant subscriptions.
REVOKE INSERT,UPDATE,DELETE ON
  public.profiles,public.providers,public.services,public.conversations,
  public.messages,public.reviews,public.favorites
FROM authenticated;

COMMIT;
