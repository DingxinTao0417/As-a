BEGIN;

ALTER TABLE public.providers
  ADD COLUMN tap_charges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN tap_payouts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN tap_status_checked_at timestamptz,
  ADD COLUMN tap_status_source text;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_tap_capability_state_check CHECK (
    NOT tap_payouts_enabled OR tap_charges_enabled
  ),
  ADD CONSTRAINT providers_tap_status_source_check CHECK (
    tap_status_source IS NULL OR tap_status_source='tap_destination_api'
  );

CREATE FUNCTION public.sync_provider_tap_destination_status(
  p_actor_id uuid,
  p_provider_id uuid,
  p_destination_id text,
  p_external_status text,
  p_charges_enabled boolean,
  p_payouts_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_status text;v_provider public.providers%rowtype;
BEGIN
  IF p_destination_id IS NULL OR p_destination_id LIKE 'tap_placeholder_%'
    OR char_length(p_destination_id) NOT BETWEEN 1 AND 100
    OR p_charges_enabled IS NULL OR p_payouts_enabled IS NULL
    OR p_payouts_enabled AND NOT p_charges_enabled THEN
    RAISE EXCEPTION 'Invalid Tap destination status';
  END IF;
  v_status:=CASE lower(btrim(coalesce(p_external_status,'')))
    WHEN 'active' THEN 'active'
    WHEN 'pending' THEN 'pending'
    WHEN 'restricted' THEN 'restricted'
    WHEN 'inactive' THEN 'inactive'
    WHEN 'disabled' THEN 'disabled'
    ELSE 'unknown'
  END;
  IF p_charges_enabled IS DISTINCT FROM (v_status='active') THEN
    RAISE EXCEPTION 'Inconsistent Tap destination status';
  END IF;
  SELECT * INTO v_provider FROM public.providers
  WHERE id=p_provider_id AND user_id=p_actor_id AND tap_destination_id=p_destination_id AND is_active
  FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Provider destination not found' USING ERRCODE='42501';
  END IF;
  UPDATE public.providers SET
    tap_account_status=v_status,
    tap_charges_enabled=p_charges_enabled,
    tap_payouts_enabled=p_payouts_enabled,
    tap_onboarding_completed=p_payouts_enabled,
    tap_status_checked_at=now(),
    tap_status_source='tap_destination_api',
    updated_at=now()
  WHERE id=p_provider_id;
  RETURN jsonb_build_object(
    'status',v_status,
    'charges_enabled',p_charges_enabled,
    'payouts_enabled',p_payouts_enabled,
    'checked_at',now()
  );
END $$;

REVOKE ALL ON FUNCTION public.sync_provider_tap_destination_status(uuid,uuid,text,text,boolean,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_provider_tap_destination_status(uuid,uuid,text,text,boolean,boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.request_provider_withdrawal(
  p_provider_id uuid,
  p_actor_id uuid,
  p_amount numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_provider public.providers%rowtype;v_available numeric;v_request_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_amount<1 OR p_amount>1000000 OR p_amount<>round(p_amount,2) THEN
    RAISE EXCEPTION 'Invalid withdrawal amount';
  END IF;
  SELECT * INTO v_provider FROM public.providers WHERE id=p_provider_id FOR UPDATE;
  IF NOT FOUND OR p_actor_id IS NULL OR v_provider.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  IF NOT public.is_account_active(p_actor_id) THEN RAISE EXCEPTION 'Account unavailable'; END IF;
  IF v_provider.tap_destination_id IS NULL
    OR v_provider.tap_destination_id LIKE 'tap_placeholder_%'
    OR v_provider.tap_account_status IS DISTINCT FROM 'active'
    OR v_provider.tap_payouts_enabled IS DISTINCT FROM true
    OR v_provider.tap_onboarding_completed IS DISTINCT FROM true
    OR v_provider.tap_status_source IS DISTINCT FROM 'tap_destination_api'
    OR v_provider.tap_status_checked_at IS NULL
    OR v_provider.tap_status_checked_at<now()-interval '5 minutes' THEN
    RAISE EXCEPTION 'Current Tap payout verification required';
  END IF;
  SELECT coalesce(sum(available_delta),0) INTO v_available
  FROM public.ledger_entries WHERE provider_id=p_provider_id;
  IF p_amount>v_available THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
  INSERT INTO public.withdrawal_requests(provider_id,amount,status)
  VALUES(p_provider_id,p_amount,'pending') RETURNING id INTO v_request_id;
  INSERT INTO public.ledger_entries(
    provider_id,withdrawal_request_id,entry_type,reference_key,available_delta,reserved_delta
  ) VALUES(
    p_provider_id,v_request_id,'withdrawal_reservation',
    'withdrawal:'||v_request_id||':reservation',-p_amount,p_amount
  );
  RETURN v_request_id;
END $$;
REVOKE ALL ON FUNCTION public.request_provider_withdrawal(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_provider_withdrawal(uuid,uuid,numeric) TO service_role;

DROP FUNCTION public.get_admin_provider_page(uuid,text,text,timestamptz,uuid,integer);
CREATE FUNCTION public.get_admin_provider_page(
  p_actor_id uuid,p_query text,p_filter text,
  p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) RETURNS TABLE(
  id uuid,name_ar text,name_en text,title_ar text,title_en text,bio_ar text,bio_en text,
  category text,skills text[],rating numeric,reviews_count integer,completed_projects integer,
  is_verified boolean,is_active boolean,avatar_url text,portfolio_urls text[],tap_account_status text,
  tap_charges_enabled boolean,tap_payouts_enabled boolean,tap_status_checked_at timestamptz,
  tap_status_source text,created_at timestamptz,total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR NOT EXISTS(SELECT 1 FROM public.profiles profile WHERE profile.id=p_actor_id AND profile.is_admin)
    OR char_length(coalesce(p_query,''))>100
    OR p_filter NOT IN ('all','verified','unverified')
    OR ((p_before_created_at IS NULL)<>(p_before_id IS NULL))
    OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid administrator provider query' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH filtered AS MATERIALIZED(
    SELECT provider.* FROM public.providers provider
    WHERE (p_filter='all'
      OR (p_filter='verified' AND provider.is_verified)
      OR (p_filter='unverified' AND NOT provider.is_verified))
      AND (nullif(btrim(coalesce(p_query,'')),'') IS NULL
        OR provider.id::text ILIKE '%'||btrim(p_query)||'%'
        OR provider.name_ar ILIKE '%'||btrim(p_query)||'%'
        OR provider.name_en ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(provider.title_ar,'') ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(provider.title_en,'') ILIKE '%'||btrim(p_query)||'%'
        OR coalesce(provider.category,'') ILIKE '%'||btrim(p_query)||'%')
  )
  SELECT provider.id,provider.name_ar,provider.name_en,provider.title_ar,provider.title_en,
    provider.bio_ar,provider.bio_en,coalesce(provider.category,''),provider.skills,provider.rating,
    provider.reviews_count,provider.completed_projects,provider.is_verified,provider.is_active,
    provider.avatar_url,provider.portfolio_urls,provider.tap_account_status,
    provider.tap_charges_enabled,provider.tap_payouts_enabled,provider.tap_status_checked_at,
    provider.tap_status_source,provider.created_at,(SELECT count(*) FROM filtered)
  FROM filtered provider
  WHERE p_before_created_at IS NULL
    OR provider.created_at<p_before_created_at
    OR (provider.created_at=p_before_created_at AND provider.id<p_before_id)
  ORDER BY provider.created_at DESC,provider.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.get_admin_provider_page(uuid,text,text,timestamptz,uuid,integer)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_provider_page(uuid,text,text,timestamptz,uuid,integer)
TO service_role;

COMMIT;
