BEGIN;

ALTER TABLE public.orders
  ADD COLUMN latest_delivery_files jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(latest_delivery_files) = 'array' AND jsonb_array_length(latest_delivery_files) <= 5);
ALTER TABLE public.order_deliveries
  ADD COLUMN files jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) <= 5);

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
  'order-deliveries','order-deliveries',false,26214400,
  ARRAY[
    'application/pdf','application/zip','application/x-zip-compressed','text/plain',
    'image/jpeg','image/png','image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
ON CONFLICT(id) DO UPDATE SET
  public=false,
  file_size_limit=EXCLUDED.file_size_limit,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE POLICY order_delivery_object_read ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id='order-deliveries'
  AND public.is_account_active((SELECT auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.orders order_record
    WHERE order_record.id::text=(storage.foldername(name))[1]
      AND (
        order_record.seeker_id=(SELECT auth.uid())
        OR public.owns_provider(order_record.provider_id)
        OR public.is_app_admin()
      )
  )
);

CREATE POLICY order_delivery_object_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id='order-deliveries'
  AND public.is_account_active((SELECT auth.uid()))
  AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.orders order_record
    JOIN public.providers provider ON provider.id=order_record.provider_id
    WHERE order_record.id::text=(storage.foldername(name))[1]
      AND provider.user_id=(SELECT auth.uid())
      AND order_record.status IN ('paid','revision_requested')
  )
);

CREATE POLICY order_delivery_object_delete ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id='order-deliveries'
  AND public.is_account_active((SELECT auth.uid()))
  AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.orders order_record
    JOIN public.providers provider ON provider.id=order_record.provider_id
    WHERE order_record.id::text=(storage.foldername(name))[1]
      AND provider.user_id=(SELECT auth.uid())
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.order_deliveries delivery,
      jsonb_array_elements(delivery.files) file_record
    WHERE file_record->>'path'=name
  )
);

DROP FUNCTION public.submit_order_delivery(uuid,uuid,uuid,text,text[]);

CREATE FUNCTION public.submit_order_delivery(
  p_order_id uuid,
  p_actor_id uuid,
  p_client_request_id uuid,
  p_note text,
  p_links text[] DEFAULT '{}',
  p_files jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
  v_existing public.order_deliveries%rowtype;
  v_latest public.order_deliveries%rowtype;
  v_delivery public.order_deliveries%rowtype;
  v_version integer;
BEGIN
  IF p_client_request_id IS NULL
     OR char_length(btrim(coalesce(p_note,''))) NOT BETWEEN 3 AND 5000
     OR cardinality(coalesce(p_links,'{}'::text[])) > 5
     OR EXISTS (
       SELECT 1 FROM unnest(coalesce(p_links,'{}'::text[])) link
       WHERE link !~ '^https://[^[:space:]]+$' OR char_length(link) > 2000
     )
     OR jsonb_typeof(coalesce(p_files,'[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_files,'[]'::jsonb)) > 5
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(p_files,'[]'::jsonb)) file_record
       WHERE jsonb_typeof(file_record) <> 'object'
          OR char_length(btrim(coalesce(file_record->>'path',''))) NOT BETWEEN 1 AND 500
          OR char_length(btrim(coalesce(file_record->>'name',''))) NOT BETWEEN 1 AND 255
          OR coalesce(file_record->>'name','') ~ '[/\\]'
          OR coalesce(file_record->>'mime','') NOT IN (
            'application/pdf','application/zip','application/x-zip-compressed','text/plain',
            'image/jpeg','image/png','image/webp',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          )
          OR CASE WHEN coalesce(file_record->>'size','') ~ '^[0-9]+$'
            THEN (file_record->>'size')::bigint NOT BETWEEN 1 AND 26214400
            ELSE true END
     ) THEN
    RAISE EXCEPTION 'Invalid delivery details';
  END IF;

  SELECT * INTO v_existing FROM public.order_deliveries
  WHERE client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
       OR v_existing.submitted_by IS DISTINCT FROM p_actor_id
       OR v_existing.note IS DISTINCT FROM btrim(p_note)
       OR v_existing.links IS DISTINCT FROM coalesce(p_links,'{}'::text[])
       OR v_existing.files IS DISTINCT FROM coalesce(p_files,'[]'::jsonb) THEN
      RAISE EXCEPTION 'Delivery request ID was reused with different content';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.providers
       WHERE id=v_order.provider_id AND user_id=p_actor_id AND is_active
     ) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status NOT IN ('paid','revision_requested') THEN
    RAISE EXCEPTION 'Order is not ready for delivery';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_files,'[]'::jsonb)) file_record
    WHERE split_part(file_record->>'path','/',1) <> p_order_id::text
       OR split_part(file_record->>'path','/',2) <> p_actor_id::text
       OR array_length(string_to_array(file_record->>'path','/'),1) <> 3
       OR split_part(file_record->>'path','/',3) NOT LIKE p_client_request_id::text || '-%'
       OR file_record->>'path' ~ '\.\.'
       OR NOT EXISTS (
         SELECT 1 FROM storage.objects object_record
         WHERE object_record.bucket_id='order-deliveries'
           AND object_record.name=file_record->>'path'
       )
  ) OR (
    SELECT count(*) <> count(DISTINCT file_record->>'path')
    FROM jsonb_array_elements(coalesce(p_files,'[]'::jsonb)) file_record
  ) THEN
    RAISE EXCEPTION 'Delivery files are unavailable';
  END IF;

  SELECT * INTO v_latest FROM public.order_deliveries
  WHERE order_id=p_order_id ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF v_order.status='revision_requested'
     AND (NOT FOUND OR v_latest.status <> 'revision_requested') THEN
    RAISE EXCEPTION 'Revision request not found';
  END IF;

  SELECT coalesce(max(version),0)+1 INTO v_version
  FROM public.order_deliveries WHERE order_id=p_order_id;
  INSERT INTO public.order_deliveries(
    order_id,version,submitted_by,client_request_id,note,links,files
  ) VALUES (
    p_order_id,v_version,p_actor_id,p_client_request_id,btrim(p_note),
    coalesce(p_links,'{}'::text[]),coalesce(p_files,'[]'::jsonb)
  ) RETURNING * INTO v_delivery;

  UPDATE public.orders
  SET status='awaiting_confirmation',
      delivery_version=v_version,
      latest_delivery_note=v_delivery.note,
      latest_delivery_links=v_delivery.links,
      latest_delivery_files=v_delivery.files,
      latest_revision_reason=NULL,
      completed_at=now()
  WHERE id=p_order_id;
  RETURN to_jsonb(v_delivery);
END $$;

REVOKE ALL ON FUNCTION public.submit_order_delivery(uuid,uuid,uuid,text,text[],jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_delivery(uuid,uuid,uuid,text,text[],jsonb)
  TO service_role;

CREATE FUNCTION public.get_order_delivery_request(
  p_actor_id uuid,p_order_id uuid,p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_delivery public.order_deliveries%rowtype;
BEGIN
  IF p_actor_id IS NULL OR p_client_request_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.orders order_record
       JOIN public.providers provider ON provider.id=order_record.provider_id
       WHERE order_record.id=p_order_id AND provider.user_id=p_actor_id
     ) THEN
    RAISE EXCEPTION 'Delivery request unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_delivery FROM public.order_deliveries
  WHERE order_id=p_order_id
    AND submitted_by=p_actor_id
    AND client_request_id=p_client_request_id;
  RETURN CASE WHEN FOUND THEN to_jsonb(v_delivery) ELSE NULL END;
END $$;

REVOKE ALL ON FUNCTION public.get_order_delivery_request(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_delivery_request(uuid,uuid,uuid)
  TO service_role;

COMMIT;
