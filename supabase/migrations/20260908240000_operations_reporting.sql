BEGIN;

CREATE FUNCTION public.get_provider_dashboard_snapshot(
  p_actor_id uuid,p_provider_id uuid,p_offset integer,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_stats jsonb;
  v_orders jsonb;
  v_total bigint;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR p_offset<0 OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM public.providers WHERE id=p_provider_id AND user_id=p_actor_id) THEN
    RAISE EXCEPTION 'Provider dashboard unavailable' USING ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object(
    'active_orders',count(*) FILTER (WHERE status IN ('pending','paid','revision_requested','awaiting_confirmation')),
    'awaiting_delivery',count(*) FILTER (WHERE status IN ('paid','revision_requested')),
    'awaiting_confirmation',count(*) FILTER (WHERE status='awaiting_confirmation'),
    'completed_orders',count(*) FILTER (WHERE status IN ('completed','refunded')),
    'pending_earnings',coalesce(sum(CASE WHEN status IN ('paid','revision_requested','awaiting_confirmation') THEN greatest(
      provider_amount-coalesce((SELECT sum(refund.provider_amount) FROM public.refund_requests refund
        WHERE refund.order_id=orders.id AND refund.status IN ('requested','approved','processing','succeeded','unknown')),0),0
    ) ELSE 0 END),0),
    'gross_completed',coalesce(sum(amount) FILTER (WHERE status IN ('completed','refunded')),0),
    'refunded_amount',coalesce(sum(refunded_amount),0),
    'open_refunds',(SELECT count(*) FROM public.refund_requests refund JOIN public.orders refund_order ON refund_order.id=refund.order_id
      WHERE refund_order.provider_id=p_provider_id AND refund.status IN ('requested','approved','processing','unknown')),
    'open_disputes',(SELECT count(*) FROM public.disputes dispute JOIN public.orders dispute_order ON dispute_order.id=dispute.order_id
      WHERE dispute_order.provider_id=p_provider_id AND dispute.status IN ('open','under_review')),
    'available_balance',coalesce((SELECT sum(available_delta) FROM public.ledger_entries WHERE provider_id=p_provider_id),0),
    'reserved_balance',coalesce((SELECT sum(reserved_delta) FROM public.ledger_entries WHERE provider_id=p_provider_id),0),
    'paid_balance',coalesce((SELECT sum(paid_delta) FROM public.ledger_entries WHERE provider_id=p_provider_id),0),
    'total_earned',coalesce((SELECT sum(available_delta+reserved_delta+paid_delta) FROM public.ledger_entries WHERE provider_id=p_provider_id),0)
  ) INTO v_stats FROM public.orders WHERE provider_id=p_provider_id;

  SELECT count(*) INTO v_total FROM public.orders WHERE provider_id=p_provider_id;
  SELECT coalesce(jsonb_agg(to_jsonb(page_row) ORDER BY page_row.created_at DESC,page_row.id DESC),'[]'::jsonb)
  INTO v_orders FROM (
    SELECT order_record.*,profile.full_name AS seeker_name,profile.avatar_url AS seeker_avatar
    FROM public.orders order_record
    LEFT JOIN public.public_profiles profile ON profile.id=order_record.seeker_id
    WHERE order_record.provider_id=p_provider_id
    ORDER BY order_record.created_at DESC,order_record.id DESC
    OFFSET p_offset LIMIT p_limit
  ) page_row;
  RETURN jsonb_build_object('stats',v_stats,'orders',v_orders,'total_orders',v_total);
END $$;

CREATE FUNCTION public.get_admin_order_page(
  p_actor_id uuid,p_query text,p_status text,p_offset integer,p_limit integer
) RETURNS TABLE(
  id uuid,service_name_ar text,service_name_en text,amount numeric,currency text,status text,
  refunded_amount numeric,refund_status text,dispute_status text,tap_charge_id text,tap_transaction_id text,
  created_at timestamptz,paid_at timestamptz,seeker_id uuid,seeker_email text,seeker_name text,
  provider_id uuid,provider_name_ar text,provider_name_en text,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles admin_profile WHERE admin_profile.id=p_actor_id AND admin_profile.is_admin)
     OR char_length(coalesce(p_query,''))>100 OR p_offset<0 OR p_limit NOT BETWEEN 1 AND 100
     OR (p_status IS NOT NULL AND p_status NOT IN ('pending','paid','revision_requested','awaiting_confirmation','completed','cancelled','refunded')) THEN
    RAISE EXCEPTION 'Invalid admin order query';
  END IF;
  RETURN QUERY SELECT order_record.id,order_record.service_name_ar,order_record.service_name_en,
    order_record.amount,order_record.currency,order_record.status,order_record.refunded_amount,
    order_record.refund_status,order_record.dispute_status,order_record.tap_charge_id,order_record.tap_transaction_id,
    order_record.created_at,order_record.paid_at,order_record.seeker_id,seeker.email,seeker.full_name,
    order_record.provider_id,provider.name_ar,provider.name_en,count(*) OVER()
  FROM public.orders order_record
  JOIN public.profiles seeker ON seeker.id=order_record.seeker_id
  JOIN public.providers provider ON provider.id=order_record.provider_id
  WHERE (p_status IS NULL OR order_record.status=p_status)
    AND (nullif(btrim(coalesce(p_query,'')),'') IS NULL
      OR order_record.id::text ILIKE '%'||btrim(p_query)||'%'
      OR order_record.service_name_ar ILIKE '%'||btrim(p_query)||'%'
      OR order_record.service_name_en ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(seeker.email,'') ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(order_record.tap_charge_id,'') ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(order_record.tap_transaction_id,'') ILIKE '%'||btrim(p_query)||'%')
  ORDER BY order_record.created_at DESC,order_record.id DESC OFFSET p_offset LIMIT p_limit;
END $$;

CREATE FUNCTION public.get_admin_user_page(
  p_actor_id uuid,p_query text,p_offset integer,p_limit integer
) RETURNS TABLE(
  id uuid,email text,full_name text,role text,is_admin boolean,suspended_at timestamptz,
  suspension_reason text,created_at timestamptz,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles admin_profile WHERE admin_profile.id=p_actor_id AND admin_profile.is_admin)
     OR char_length(coalesce(p_query,''))>100 OR p_offset<0 OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid admin user query';
  END IF;
  RETURN QUERY SELECT profile.id,profile.email,profile.full_name,profile.role,profile.is_admin,
    profile.suspended_at,profile.suspension_reason,profile.created_at,count(*) OVER()
  FROM public.profiles profile
  WHERE nullif(btrim(coalesce(p_query,'')),'') IS NULL
    OR profile.id::text ILIKE '%'||btrim(p_query)||'%'
    OR coalesce(profile.email,'') ILIKE '%'||btrim(p_query)||'%'
    OR profile.full_name ILIKE '%'||btrim(p_query)||'%'
  ORDER BY profile.created_at DESC,profile.id DESC OFFSET p_offset LIMIT p_limit;
END $$;

CREATE FUNCTION public.get_admin_operations_summary(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'total_users',(SELECT count(*) FROM public.profiles),
    'total_providers',(SELECT count(*) FROM public.providers),
    'unverified_providers',(SELECT count(*) FROM public.providers WHERE NOT is_verified),
    'published_services',(SELECT count(*) FROM public.services WHERE is_active),
    'pending_services',(SELECT count(*) FROM public.services WHERE moderation_status='pending_review'),
    'total_orders',(SELECT count(*) FROM public.orders),
    'active_orders',(SELECT count(*) FROM public.orders WHERE status IN ('pending','paid','revision_requested','awaiting_confirmation')),
    'completed_orders',(SELECT count(*) FROM public.orders WHERE status IN ('completed','refunded')),
    'gross_completed',coalesce((SELECT sum(amount) FROM public.orders WHERE status IN ('completed','refunded')),0),
    'refunded_amount',coalesce((SELECT sum(refunded_amount) FROM public.orders),0),
    'open_refunds',(SELECT count(*) FROM public.refund_requests WHERE status IN ('requested','approved','processing','unknown')),
    'open_disputes',(SELECT count(*) FROM public.disputes WHERE status IN ('open','under_review')),
    'pending_withdrawals',(SELECT count(*) FROM public.withdrawal_requests WHERE status IN ('pending','approved','processing','unknown')),
    'payment_exceptions',(SELECT count(*) FROM public.payment_events WHERE processing_status IN ('pending','quarantined'))
      +(SELECT count(*) FROM public.refund_events WHERE processing_status IN ('pending','quarantined')),
    'provider_available',coalesce((SELECT sum(available_delta) FROM public.ledger_entries),0),
    'provider_reserved',coalesce((SELECT sum(reserved_delta) FROM public.ledger_entries),0),
    'provider_paid',coalesce((SELECT sum(paid_delta) FROM public.ledger_entries),0)
  );
END $$;

CREATE FUNCTION public.export_admin_order_report(
  p_actor_id uuid,p_query text,p_status text,p_max_rows integer DEFAULT 5000
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer; v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_actor_id AND is_admin)
     OR char_length(coalesce(p_query,''))>100 OR p_max_rows NOT BETWEEN 1 AND 10000
     OR (p_status IS NOT NULL AND p_status NOT IN ('pending','paid','revision_requested','awaiting_confirmation','completed','cancelled','refunded')) THEN
    RAISE EXCEPTION 'Invalid admin report query';
  END IF;
  SELECT count(*) INTO v_count FROM public.orders order_record
  JOIN public.profiles seeker ON seeker.id=order_record.seeker_id
  WHERE (p_status IS NULL OR order_record.status=p_status)
    AND (nullif(btrim(coalesce(p_query,'')),'') IS NULL OR order_record.id::text ILIKE '%'||btrim(p_query)||'%'
      OR order_record.service_name_ar ILIKE '%'||btrim(p_query)||'%' OR order_record.service_name_en ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(seeker.email,'') ILIKE '%'||btrim(p_query)||'%' OR coalesce(order_record.tap_charge_id,'') ILIKE '%'||btrim(p_query)||'%'
      OR coalesce(order_record.tap_transaction_id,'') ILIKE '%'||btrim(p_query)||'%');
  IF v_count>p_max_rows THEN RAISE EXCEPTION 'Report exceeds row limit'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(report_row) ORDER BY report_row.created_at,report_row.id),'[]'::jsonb) INTO v_rows
  FROM (
    SELECT order_record.id,order_record.service_name_ar,order_record.service_name_en,order_record.amount,
      order_record.currency,order_record.status,order_record.refunded_amount,order_record.refund_status,
      order_record.dispute_status,order_record.tap_charge_id,order_record.tap_transaction_id,
      order_record.created_at,order_record.paid_at,seeker.email AS seeker_email,
      provider.name_ar AS provider_name_ar,provider.name_en AS provider_name_en
    FROM public.orders order_record JOIN public.profiles seeker ON seeker.id=order_record.seeker_id
    JOIN public.providers provider ON provider.id=order_record.provider_id
    WHERE (p_status IS NULL OR order_record.status=p_status)
      AND (nullif(btrim(coalesce(p_query,'')),'') IS NULL OR order_record.id::text ILIKE '%'||btrim(p_query)||'%'
        OR order_record.service_name_ar ILIKE '%'||btrim(p_query)||'%' OR order_record.service_name_en ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(seeker.email,'') ILIKE '%'||btrim(p_query)||'%' OR coalesce(order_record.tap_charge_id,'') ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(order_record.tap_transaction_id,'') ILIKE '%'||btrim(p_query)||'%')
  ) report_row;
  RETURN jsonb_build_object('generated_at',now(),'row_count',v_count,'orders',v_rows);
END $$;

REVOKE ALL ON FUNCTION public.get_provider_dashboard_snapshot(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_admin_order_page(uuid,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_admin_user_page(uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_admin_operations_summary(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.export_admin_order_report(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_dashboard_snapshot(uuid,uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_order_page(uuid,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_user_page(uuid,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_operations_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.export_admin_order_report(uuid,text,text,integer) TO service_role;

COMMIT;
