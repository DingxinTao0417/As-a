BEGIN;

CREATE FUNCTION public.service_payload_is_valid(
  p_name_ar text,
  p_name_en text,
  p_description_ar text,
  p_description_en text,
  p_category text,
  p_price numeric,
  p_price_type text,
  p_delivery_time text,
  p_features text[],
  p_image_urls text[]
) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT
    char_length(btrim(coalesce(p_name_ar,''))) BETWEEN 1 AND 200
    AND char_length(btrim(coalesce(p_name_en,''))) BETWEEN 1 AND 200
    AND char_length(coalesce(p_description_ar,'')) <= 5000
    AND char_length(coalesce(p_description_en,'')) <= 5000
    AND p_category IN ('development','design','marketing','writing','video','music','business','consulting')
    AND p_price IS NOT NULL
    AND p_price::text NOT IN ('NaN','Infinity','-Infinity')
    AND p_price BETWEEN 1 AND 1000000
    AND p_price = round(p_price,2)
    AND p_price_type IN ('fixed','hourly','starting_from')
    AND char_length(coalesce(p_delivery_time,'')) <= 160
    AND cardinality(p_features) BETWEEN 0 AND 30
    AND cardinality(p_image_urls) BETWEEN 0 AND 10
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_features) value
      WHERE char_length(btrim(value)) NOT BETWEEN 1 AND 200
    )
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_image_urls) value
      WHERE char_length(btrim(value)) NOT BETWEEN 1 AND 2048
    );
$$;

CREATE FUNCTION public.create_service_draft(
  p_actor_id uuid,
  p_name_ar text,
  p_name_en text,
  p_description_ar text,
  p_description_en text,
  p_category text,
  p_price numeric,
  p_price_type text,
  p_delivery_time text,
  p_features text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_provider_id uuid;
  v_service_id uuid;
BEGIN
  SELECT id INTO v_provider_id FROM public.providers
    WHERE user_id = p_actor_id AND is_active
    FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Active provider required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.service_payload_is_valid(
    p_name_ar,p_name_en,p_description_ar,p_description_en,p_category,p_price,
    p_price_type,p_delivery_time,p_features,'{}'::text[]
  ) THEN RAISE EXCEPTION 'Invalid service details'; END IF;

  INSERT INTO public.services(
    provider_id,name_ar,name_en,description_ar,description_en,category,
    price,price_type,delivery_time,features,image_urls,is_active
  ) VALUES (
    v_provider_id,btrim(p_name_ar),btrim(p_name_en),
    nullif(btrim(coalesce(p_description_ar,'')),''),
    nullif(btrim(coalesce(p_description_en,'')),''),
    p_category,p_price,p_price_type,
    nullif(btrim(coalesce(p_delivery_time,'')),''),
    ARRAY(SELECT DISTINCT btrim(value) FROM unnest(p_features) value),
    '{}',false
  ) RETURNING id INTO v_service_id;
  RETURN v_service_id;
END $$;

CREATE FUNCTION public.update_service_draft(
  p_actor_id uuid,
  p_service_id uuid,
  p_name_ar text,
  p_name_en text,
  p_description_ar text,
  p_description_en text,
  p_category text,
  p_price numeric,
  p_price_type text,
  p_delivery_time text,
  p_features text[],
  p_image_urls text[]
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM s.id FROM public.services s
    JOIN public.providers p ON p.id = s.provider_id
    WHERE s.id = p_service_id
      AND p.user_id = p_actor_id
      AND p.is_active
    FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.service_payload_is_valid(
    p_name_ar,p_name_en,p_description_ar,p_description_en,p_category,p_price,
    p_price_type,p_delivery_time,p_features,p_image_urls
  ) THEN RAISE EXCEPTION 'Invalid service details'; END IF;

  UPDATE public.services SET
    name_ar = btrim(p_name_ar),
    name_en = btrim(p_name_en),
    description_ar = nullif(btrim(coalesce(p_description_ar,'')),''),
    description_en = nullif(btrim(coalesce(p_description_en,'')),''),
    category = p_category,
    price = p_price,
    price_type = p_price_type,
    delivery_time = nullif(btrim(coalesce(p_delivery_time,'')),''),
    features = ARRAY(SELECT DISTINCT btrim(value) FROM unnest(p_features) value),
    image_urls = ARRAY(SELECT DISTINCT btrim(value) FROM unnest(p_image_urls) value),
    is_active = false,
    updated_at = now()
  WHERE id = p_service_id;
END $$;

CREATE FUNCTION public.delete_service(p_actor_id uuid,p_service_id uuid)
RETURNS text[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_image_urls text[];
BEGIN
  SELECT s.image_urls INTO v_image_urls FROM public.services s
    JOIN public.providers p ON p.id = s.provider_id
    WHERE s.id = p_service_id AND p.user_id = p_actor_id
    FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.is_account_active(p_actor_id) THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE service_id = p_service_id) THEN
    RAISE EXCEPTION 'Services with order history cannot be deleted';
  END IF;
  DELETE FROM public.services WHERE id = p_service_id;
  RETURN v_image_urls;
END $$;

REVOKE ALL ON FUNCTION public.service_payload_is_valid(text,text,text,text,text,numeric,text,text,text[],text[])
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_service_draft(uuid,text,text,text,text,text,numeric,text,text,text[])
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_service_draft(uuid,uuid,text,text,text,text,text,numeric,text,text,text[],text[])
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delete_service(uuid,uuid)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.service_payload_is_valid(text,text,text,text,text,numeric,text,text,text[],text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_service_draft(uuid,text,text,text,text,text,numeric,text,text,text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_service_draft(uuid,uuid,text,text,text,text,text,numeric,text,text,text[],text[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_service(uuid,uuid) TO service_role;

COMMIT;
