BEGIN;

CREATE TABLE public.service_image_cleanup_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  bucket_id text NOT NULL DEFAULT 'service-images' CHECK(bucket_id='service-images'),
  storage_path text NOT NULL CHECK(char_length(storage_path) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  last_error text CHECK(last_error IS NULL OR char_length(last_error)<=500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(bucket_id,storage_path),
  CHECK((status='pending' AND completed_at IS NULL) OR (status='completed' AND completed_at IS NOT NULL))
);
CREATE INDEX service_image_cleanup_owner_pending
  ON public.service_image_cleanup_jobs(requested_by,created_at,id) WHERE status='pending';
CREATE INDEX service_image_cleanup_provider_path
  ON public.service_image_cleanup_jobs(provider_id,storage_path);

ALTER TABLE public.service_image_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_image_cleanup_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.service_image_cleanup_jobs TO authenticated;
GRANT ALL ON public.service_image_cleanup_jobs TO service_role;
CREATE POLICY service_image_cleanup_owner_read ON public.service_image_cleanup_jobs
FOR SELECT TO authenticated USING(
  public.is_account_active((SELECT auth.uid()))
  AND (requested_by=(SELECT auth.uid()) OR public.is_app_admin())
);

CREATE FUNCTION public.queue_service_image_cleanup(
  p_actor_id uuid,p_provider_id uuid,p_service_id uuid,p_paths text[]
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_path text;v_count integer:=0;
BEGIN
  IF p_actor_id IS NULL OR p_service_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR coalesce(cardinality(p_paths),0) NOT BETWEEN 1 AND 20
    OR NOT EXISTS(
      SELECT 1 FROM public.providers provider
      WHERE provider.id=p_provider_id AND provider.user_id=p_actor_id
    ) THEN RAISE EXCEPTION 'Invalid cleanup request' USING ERRCODE='42501'; END IF;

  FOR v_path IN SELECT DISTINCT value FROM unnest(p_paths) value LOOP
    IF v_path IS NULL OR char_length(v_path) NOT BETWEEN 1 AND 500
      OR split_part(v_path,'/',1)<>p_provider_id::text
      OR split_part(v_path,'/',2)<>p_service_id::text
      OR array_length(string_to_array(v_path,'/'),1)<>3
      OR split_part(v_path,'/',3)!~'^[A-Za-z0-9_-]+\.(jpg|png|webp)$'
      OR v_path~'\.\.'
      OR EXISTS(
        SELECT 1 FROM public.services service_record,unnest(service_record.image_urls) image_url
        WHERE service_record.provider_id=p_provider_id
          AND right(image_url,char_length(v_path))=v_path
      ) THEN RAISE EXCEPTION 'Unsafe or referenced cleanup path'; END IF;

    INSERT INTO public.service_image_cleanup_jobs(
      provider_id,service_id,requested_by,storage_path
    ) VALUES(p_provider_id,p_service_id,p_actor_id,v_path)
    ON CONFLICT(bucket_id,storage_path) DO UPDATE SET
      status='pending',attempt_count=0,last_error=NULL,completed_at=NULL,updated_at=now()
    WHERE public.service_image_cleanup_jobs.requested_by=p_actor_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup path belongs to another account' USING ERRCODE='42501'; END IF;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END $$;

CREATE FUNCTION public.get_service_image_cleanup_page(p_actor_id uuid,p_limit integer)
RETURNS TABLE(id uuid,service_id uuid,storage_path text,attempt_count integer,created_at timestamptz,total_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id) OR p_limit NOT BETWEEN 1 AND 100
    OR NOT EXISTS(SELECT 1 FROM public.providers provider WHERE provider.user_id=p_actor_id) THEN
    RAISE EXCEPTION 'Provider account required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT job.id,job.service_id,job.storage_path,job.attempt_count,job.created_at,count(*) OVER()
  FROM public.service_image_cleanup_jobs job
  WHERE job.requested_by=p_actor_id AND job.status='pending'
  ORDER BY job.created_at,job.id LIMIT p_limit;
END $$;

CREATE FUNCTION public.record_service_image_cleanup_result(
  p_actor_id uuid,p_job_ids uuid[],p_succeeded boolean,p_error text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_account_active(p_actor_id)
    OR coalesce(cardinality(p_job_ids),0) NOT BETWEEN 1 AND 100 OR p_succeeded IS NULL
    OR (NOT p_succeeded AND char_length(btrim(coalesce(p_error,''))) NOT BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION 'Invalid cleanup result';
  END IF;
  UPDATE public.service_image_cleanup_jobs SET
    status=CASE WHEN p_succeeded THEN 'completed' ELSE 'pending' END,
    attempt_count=attempt_count+1,
    last_error=CASE WHEN p_succeeded THEN NULL ELSE btrim(p_error) END,
    completed_at=CASE WHEN p_succeeded THEN now() ELSE NULL END,
    updated_at=now()
  WHERE requested_by=p_actor_id AND status='pending' AND id=ANY(p_job_ids);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>cardinality(p_job_ids) THEN RAISE EXCEPTION 'Cleanup jobs not found' USING ERRCODE='42501'; END IF;
  RETURN v_count;
END $$;

CREATE FUNCTION public.prevent_cleaned_service_image_reference()
RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF EXISTS(
    SELECT 1
    FROM public.service_image_cleanup_jobs job,unnest(NEW.image_urls) image_url
    WHERE job.provider_id=NEW.provider_id
      AND right(image_url,char_length(job.storage_path))=job.storage_path
  ) THEN RAISE EXCEPTION 'A queued cleanup image cannot be attached to a service'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.prevent_cleaned_service_image_reference() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prevent_cleaned_service_image_reference
  BEFORE INSERT OR UPDATE OF image_urls ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.prevent_cleaned_service_image_reference();

CREATE FUNCTION public.export_user_data_snapshot_v10(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT public.export_user_data_snapshot_v9(p_actor_id)||jsonb_build_object(
    'schema_version',10,
    'service_image_cleanup_jobs',coalesce((
      SELECT jsonb_agg(to_jsonb(job) ORDER BY job.created_at,job.id)
      FROM public.service_image_cleanup_jobs job WHERE job.requested_by=p_actor_id
    ),'[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.queue_service_image_cleanup(uuid,uuid,uuid,text[]),
  public.get_service_image_cleanup_page(uuid,integer),
  public.record_service_image_cleanup_result(uuid,uuid[],boolean,text),
  public.export_user_data_snapshot_v10(uuid)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_service_image_cleanup(uuid,uuid,uuid,text[]),
  public.get_service_image_cleanup_page(uuid,integer),
  public.record_service_image_cleanup_result(uuid,uuid[],boolean,text),
  public.export_user_data_snapshot_v10(uuid)
TO service_role;

COMMIT;
