BEGIN;

CREATE FUNCTION public.get_dispute_eligible_order_page(
  p_actor_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_provider_ids uuid[];v_total bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid dispute-eligible order query' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_provider_ids
  FROM public.providers WHERE user_id=p_actor_id;
  SELECT count(*) INTO v_total FROM public.orders order_record
  WHERE order_record.status IN ('paid','revision_requested','awaiting_confirmation','completed')
    AND order_record.dispute_status NOT IN ('open','under_review')
    AND (order_record.seeker_id=p_actor_id OR order_record.provider_id=ANY(v_provider_ids));
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT order_record.id,order_record.service_name_ar,order_record.service_name_en,
      order_record.status,order_record.amount,order_record.currency,order_record.dispute_status,
      order_record.created_at
    FROM public.orders order_record
    WHERE order_record.status IN ('paid','revision_requested','awaiting_confirmation','completed')
      AND order_record.dispute_status NOT IN ('open','under_review')
      AND (order_record.seeker_id=p_actor_id OR order_record.provider_id=ANY(v_provider_ids))
      AND (
        p_before_created_at IS NULL
        OR order_record.created_at<p_before_created_at
        OR (order_record.created_at=p_before_created_at AND order_record.id<p_before_id)
      )
    ORDER BY order_record.created_at DESC,order_record.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('orders',v_rows,'total',v_total);
END $$;

CREATE FUNCTION public.get_dispute_page(
  p_actor_id uuid,p_admin_view boolean,p_status text,
  p_before_updated_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_provider_ids uuid[];v_total bigint;v_open bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR p_admin_view IS NULL
    OR (p_admin_view AND NOT EXISTS(
      SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin
    ))
    OR (p_status IS NOT NULL AND p_status NOT IN ('active','open','under_review','resolved','closed'))
    OR ((p_before_updated_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid dispute query' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_provider_ids
  FROM public.providers WHERE user_id=p_actor_id;
  SELECT count(*) INTO v_total
  FROM public.disputes dispute JOIN public.orders order_record ON order_record.id=dispute.order_id
  WHERE (p_admin_view OR order_record.seeker_id=p_actor_id OR order_record.provider_id=ANY(v_provider_ids))
    AND (p_status IS NULL OR dispute.status=p_status
      OR (p_status='active' AND dispute.status IN ('open','under_review')));
  SELECT count(*) INTO v_open
  FROM public.disputes dispute JOIN public.orders order_record ON order_record.id=dispute.order_id
  WHERE (p_admin_view OR order_record.seeker_id=p_actor_id OR order_record.provider_id=ANY(v_provider_ids))
    AND dispute.status IN ('open','under_review');
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.updated_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT dispute.id,dispute.order_id,dispute.opened_by,dispute.category,dispute.description,
      dispute.requested_resolution,dispute.status,dispute.ledger_hold_amount,dispute.assigned_to,
      dispute.resolution,dispute.resolution_note,dispute.resolution_refund_id,
      dispute.created_at,dispute.updated_at,
      jsonb_build_object(
        'service_name_ar',order_record.service_name_ar,'service_name_en',order_record.service_name_en,
        'amount',order_record.amount,'currency',order_record.currency,'status',order_record.status
      ) AS "order",
      CASE WHEN p_admin_view THEN jsonb_build_object(
        'full_name',opener.full_name,'email',opener.email
      ) ELSE NULL END AS opener
    FROM public.disputes dispute
    JOIN public.orders order_record ON order_record.id=dispute.order_id
    JOIN public.profiles opener ON opener.id=dispute.opened_by
    WHERE (p_admin_view OR order_record.seeker_id=p_actor_id OR order_record.provider_id=ANY(v_provider_ids))
      AND (p_status IS NULL OR dispute.status=p_status
        OR (p_status='active' AND dispute.status IN ('open','under_review')))
      AND (
        p_before_updated_at IS NULL
        OR dispute.updated_at<p_before_updated_at
        OR (dispute.updated_at=p_before_updated_at AND dispute.id<p_before_id)
      )
    ORDER BY dispute.updated_at DESC,dispute.id DESC LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('disputes',v_rows,'total',v_total,'open_count',v_open);
END $$;

CREATE FUNCTION public.get_dispute_evidence_page(
  p_actor_id uuid,p_dispute_id uuid,p_after_created_at timestamptz,p_after_id uuid,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_order public.orders%rowtype;v_provider_user_id uuid;v_total bigint;v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR ((p_after_created_at IS NULL)<>(p_after_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid dispute evidence query' USING ERRCODE='42501';
  END IF;
  SELECT order_record.* INTO v_order
  FROM public.disputes dispute JOIN public.orders order_record ON order_record.id=dispute.order_id
  WHERE dispute.id=p_dispute_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute unavailable' USING ERRCODE='42501'; END IF;
  SELECT user_id INTO v_provider_user_id FROM public.providers WHERE id=v_order.provider_id;
  IF p_actor_id NOT IN (v_order.seeker_id,v_provider_user_id)
    AND NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin) THEN
    RAISE EXCEPTION 'Dispute unavailable' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_total FROM public.dispute_evidence WHERE dispute_id=p_dispute_id;
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at,page_row.id),'[]'::jsonb)
  INTO v_rows
  FROM(
    SELECT evidence.id,evidence.dispute_id,evidence.uploaded_by,evidence.storage_path,
      evidence.description,evidence.created_at
    FROM public.dispute_evidence evidence
    WHERE evidence.dispute_id=p_dispute_id
      AND (
        p_after_created_at IS NULL
        OR evidence.created_at>p_after_created_at
        OR (evidence.created_at=p_after_created_at AND evidence.id>p_after_id)
      )
    ORDER BY evidence.created_at,evidence.id LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('evidence',v_rows,'total',v_total);
END $$;

REVOKE ALL ON FUNCTION public.get_dispute_eligible_order_page(uuid,timestamptz,uuid,integer),
  public.get_dispute_page(uuid,boolean,text,timestamptz,uuid,integer),
  public.get_dispute_evidence_page(uuid,uuid,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dispute_eligible_order_page(uuid,timestamptz,uuid,integer),
  public.get_dispute_page(uuid,boolean,text,timestamptz,uuid,integer),
  public.get_dispute_evidence_page(uuid,uuid,timestamptz,uuid,integer)
TO service_role;

COMMIT;
