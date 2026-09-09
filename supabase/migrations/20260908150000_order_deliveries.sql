BEGIN;

ALTER TABLE public.orders
  DROP CONSTRAINT orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (status IN (
    'pending','paid','revision_requested','awaiting_confirmation',
    'completed','cancelled','refunded'
  ));
ALTER TABLE public.orders
  ADD COLUMN delivery_version integer NOT NULL DEFAULT 0 CHECK (delivery_version >= 0),
  ADD COLUMN latest_delivery_note text,
  ADD COLUMN latest_delivery_links text[] NOT NULL DEFAULT '{}',
  ADD COLUMN latest_revision_reason text;

CREATE TABLE public.order_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL UNIQUE,
  note text NOT NULL CHECK (char_length(note) BETWEEN 3 AND 5000),
  links text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','revision_requested','accepted')),
  revision_reason text CHECK (revision_reason IS NULL OR char_length(revision_reason) BETWEEN 3 AND 2000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  revision_requested_at timestamptz,
  accepted_at timestamptz,
  UNIQUE(order_id,version),
  CHECK (cardinality(links) <= 5)
);

CREATE INDEX order_deliveries_order_version_idx
  ON public.order_deliveries(order_id,version DESC);

-- Keep pre-migration delivered orders confirmable without fabricating a file or
-- external URL. The marker explains that the original delivery details did not
-- exist in the previous schema.
INSERT INTO public.order_deliveries(
  order_id,version,submitted_by,client_request_id,note,status,
  submitted_at,accepted_at
)
SELECT
  o.id,1,p.user_id,gen_random_uuid(),'Legacy delivery; details were not recorded',
  CASE WHEN o.status = 'completed' THEN 'accepted' ELSE 'submitted' END,
  coalesce(o.completed_at,o.created_at),
  CASE WHEN o.status = 'completed' THEN coalesce(o.completed_at,o.created_at) ELSE NULL END
FROM public.orders o
JOIN public.providers p ON p.id = o.provider_id
WHERE o.status IN ('awaiting_confirmation','completed');

UPDATE public.orders o
SET delivery_version = 1,
    latest_delivery_note = d.note,
    latest_delivery_links = d.links
FROM public.order_deliveries d
WHERE d.order_id = o.id AND d.version = 1;

ALTER TABLE public.order_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_deliveries TO authenticated;
GRANT ALL ON public.order_deliveries TO service_role;
CREATE POLICY order_deliveries_read ON public.order_deliveries
  FOR SELECT TO authenticated USING (
    public.is_account_active((SELECT auth.uid())) AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND (
        o.seeker_id = (SELECT auth.uid())
        OR public.owns_provider(o.provider_id)
        OR public.is_app_admin()
      )
    )
  );

CREATE FUNCTION public.submit_order_delivery(
  p_order_id uuid,
  p_actor_id uuid,
  p_client_request_id uuid,
  p_note text,
  p_links text[] DEFAULT '{}'
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
     ) THEN
    RAISE EXCEPTION 'Invalid delivery details';
  END IF;

  SELECT * INTO v_existing FROM public.order_deliveries
    WHERE client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
       OR v_existing.submitted_by IS DISTINCT FROM p_actor_id
       OR v_existing.note IS DISTINCT FROM btrim(p_note)
       OR v_existing.links IS DISTINCT FROM coalesce(p_links,'{}'::text[]) THEN
      RAISE EXCEPTION 'Delivery request ID was reused with different content';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.providers
       WHERE id = v_order.provider_id AND user_id = p_actor_id AND is_active
     ) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status NOT IN ('paid','revision_requested') THEN
    RAISE EXCEPTION 'Order is not ready for delivery';
  END IF;

  SELECT * INTO v_latest FROM public.order_deliveries
    WHERE order_id = p_order_id ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF v_order.status = 'revision_requested'
     AND (NOT FOUND OR v_latest.status <> 'revision_requested') THEN
    RAISE EXCEPTION 'Revision request not found';
  END IF;

  SELECT coalesce(max(version),0)+1 INTO v_version
    FROM public.order_deliveries WHERE order_id = p_order_id;
  INSERT INTO public.order_deliveries(
    order_id,version,submitted_by,client_request_id,note,links
  ) VALUES (
    p_order_id,v_version,p_actor_id,p_client_request_id,btrim(p_note),coalesce(p_links,'{}'::text[])
  ) RETURNING * INTO v_delivery;

  UPDATE public.orders
    SET status = 'awaiting_confirmation',
        delivery_version = v_version,
        latest_delivery_note = v_delivery.note,
        latest_delivery_links = v_delivery.links,
        latest_revision_reason = NULL,
        completed_at = now()
    WHERE id = p_order_id;
  RETURN to_jsonb(v_delivery);
END $$;

CREATE FUNCTION public.request_order_revision(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
  v_delivery public.order_deliveries%rowtype;
BEGIN
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'Revision reason is required';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR v_order.seeker_id IS DISTINCT FROM p_actor_id
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status = 'revision_requested' THEN RETURN 'revision_requested'; END IF;
  IF v_order.status <> 'awaiting_confirmation' THEN
    RAISE EXCEPTION 'Order is not awaiting confirmation';
  END IF;

  SELECT * INTO v_delivery FROM public.order_deliveries
    WHERE order_id = p_order_id ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_delivery.status <> 'submitted' THEN
    RAISE EXCEPTION 'Submitted delivery not found';
  END IF;
  UPDATE public.order_deliveries
    SET status = 'revision_requested',
        revision_reason = btrim(p_reason),
        revision_requested_at = now()
    WHERE id = v_delivery.id;
  UPDATE public.orders
    SET status = 'revision_requested',latest_revision_reason = btrim(p_reason)
    WHERE id = p_order_id;
  RETURN 'revision_requested';
END $$;

CREATE OR REPLACE FUNCTION public.confirm_order(p_order_id uuid,p_actor_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_order public.orders%rowtype;
  v_delivery public.order_deliveries%rowtype;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR v_order.seeker_id IS DISTINCT FROM p_actor_id
     OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status = 'completed' THEN RETURN 'completed'; END IF;
  IF v_order.status <> 'awaiting_confirmation' THEN
    RAISE EXCEPTION 'Order is not ready for confirmation';
  END IF;
  SELECT * INTO v_delivery FROM public.order_deliveries
    WHERE order_id = p_order_id ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_delivery.status <> 'submitted' THEN
    RAISE EXCEPTION 'Submitted delivery not found';
  END IF;

  UPDATE public.order_deliveries
    SET status = 'accepted',accepted_at = now()
    WHERE id = v_delivery.id;
  INSERT INTO public.service_history(
    order_id,seeker_id,provider_id,service_id,
    service_name_ar,service_name_en,service_description_ar,service_description_en,
    amount,status,completed_at
  ) VALUES (
    v_order.id,v_order.seeker_id,v_order.provider_id,v_order.service_id,
    v_order.service_name_ar,v_order.service_name_en,
    v_order.service_description_ar,v_order.service_description_en,
    v_order.amount,'completed',now()
  );
  INSERT INTO public.ledger_entries(
    provider_id,order_id,entry_type,reference_key,available_delta
  ) VALUES (
    v_order.provider_id,v_order.id,'order_settlement',
    'order:' || v_order.id || ':settlement',v_order.provider_amount
  );
  UPDATE public.orders SET status = 'completed' WHERE id = p_order_id;
  UPDATE public.providers
    SET completed_projects = completed_projects + 1
    WHERE id = v_order.provider_id;
  RETURN 'completed';
END $$;

REVOKE ALL ON FUNCTION public.submit_order_delivery(uuid,uuid,uuid,text,text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_order_revision(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_order(uuid,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.submit_order_delivery(uuid,uuid,uuid,text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_order_revision(uuid,uuid,text) TO service_role;

COMMIT;
