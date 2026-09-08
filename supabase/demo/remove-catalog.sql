-- REVIEW BEFORE RUNNING. This only removes the untouched catalog dataset
-- asaa-showcase-v1: 6 placeholder users/profiles/providers and 12 services.
-- It never removes buyers 7-9, conversations, orders, reviews, money, or audit data.
-- Any unexpected reference or unsupported state aborts the entire transaction.
-- Intended for the same explicitly authorized isolated demo project as catalog.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE asaa_catalog_cleanup_targets (
  relation_id oid NOT NULL,
  row_id uuid NOT NULL,
  parent_id uuid,
  expected_email text,
  PRIMARY KEY (relation_id, row_id)
) ON COMMIT DROP;

DO $cleanup$
DECLARE
  target_relation regclass;
  relation_name text;
  fk record;
  join_condition text;
  allowed_chain boolean;
  unexpected_reference boolean;
  target_count integer;
  expected_count integer;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Cleanup requires the reviewed operator database role';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY[
    'auth.users', 'public.profiles', 'public.providers', 'public.services',
    'auth.identities', 'auth.sessions', 'auth.refresh_tokens', 'storage.objects'
  ] LOOP
    IF to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'Missing relation %, cannot verify cleanup safety', relation_name;
    END IF;
  END LOOP;

  INSERT INTO asaa_catalog_cleanup_targets(relation_id,row_id,parent_id,expected_email)
  SELECT 'auth.users'::regclass,
    ('d3a00001-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
    NULL,
    'asaa-demo-' || (ARRAY['development','design','marketing','writing','video','consulting'])[n] || '@example.invalid'
  FROM generate_series(1,6) n;
  INSERT INTO asaa_catalog_cleanup_targets(relation_id,row_id,parent_id)
  SELECT 'public.profiles'::regclass,row_id,row_id
    FROM asaa_catalog_cleanup_targets WHERE relation_id = 'auth.users'::regclass;
  INSERT INTO asaa_catalog_cleanup_targets(relation_id,row_id,parent_id)
  SELECT 'public.providers'::regclass,
    ('d3a00002-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
    ('d3a00001-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
  FROM generate_series(1,6) n;
  INSERT INTO asaa_catalog_cleanup_targets(relation_id,row_id,parent_id)
  SELECT 'public.services'::regclass,
    ('d3a00003-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
    ('d3a00002-0000-4000-8000-' || lpad(((n+1)/2)::text,12,'0'))::uuid
  FROM generate_series(1,12) n;

  -- Table locks make reference checks and deletion one stable operation, including
  -- installations whose legacy foreign keys use ON DELETE CASCADE. Short lock
  -- timeouts avoid waiting indefinitely behind application traffic. No other rows
  -- are updated or deleted. New FK definitions require locks on the target tables.
  FOR target_relation IN
    SELECT DISTINCT relation_id::regclass
    FROM asaa_catalog_cleanup_targets ORDER BY relation_id::regclass
  LOOP
    EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', target_relation);
  END LOOP;

  FOR target_relation IN
    SELECT locked_relation::regclass FROM (
      SELECT conrelid AS locked_relation FROM pg_constraint
      WHERE contype = 'f' AND confrelid IN (SELECT relation_id FROM asaa_catalog_cleanup_targets)
      UNION SELECT 'auth.identities'::regclass::oid
      UNION SELECT 'auth.sessions'::regclass::oid
      UNION SELECT 'auth.refresh_tokens'::regclass::oid
      UNION SELECT 'storage.objects'::regclass::oid
      UNION SELECT to_regclass('public.admin_audit_log')::oid
    ) relations
    WHERE locked_relation IS NOT NULL
      AND locked_relation NOT IN (SELECT relation_id FROM asaa_catalog_cleanup_targets)
    ORDER BY locked_relation
  LOOP
    EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', target_relation);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid IN (SELECT relation_id FROM asaa_catalog_cleanup_targets)
      AND NOT tgisinternal AND (tgtype::integer & 8) <> 0
  ) THEN
    RAISE EXCEPTION 'Unexpected DELETE trigger on a target table; review its effects before cleanup';
  END IF;

  SELECT (SELECT count(*) FROM auth.users WHERE id IN (SELECT row_id FROM asaa_catalog_cleanup_targets WHERE relation_id='auth.users'::regclass))
    + (SELECT count(*) FROM public.profiles WHERE id IN (SELECT row_id FROM asaa_catalog_cleanup_targets WHERE relation_id='public.profiles'::regclass))
    + (SELECT count(*) FROM public.providers WHERE id IN (SELECT row_id FROM asaa_catalog_cleanup_targets WHERE relation_id='public.providers'::regclass))
    + (SELECT count(*) FROM public.services WHERE id IN (SELECT row_id FROM asaa_catalog_cleanup_targets WHERE relation_id='public.services'::regclass))
  INTO target_count;
  IF target_count = 0 THEN
    RAISE NOTICE 'Catalog dataset already absent; no rows changed';
    RETURN;
  END IF;
  IF target_count <> 30 THEN
    RAISE EXCEPTION 'Incomplete catalog dataset (% of 30 target rows). Review manually; nothing deleted', target_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users u JOIN asaa_catalog_cleanup_targets t
      ON t.relation_id='auth.users'::regclass AND t.row_id=u.id
    WHERE u.raw_app_meta_data->>'demo_dataset' IS DISTINCT FROM 'asaa-showcase-v1'
      OR u.email IS DISTINCT FROM t.expected_email
      OR coalesce(u.encrypted_password,'') <> ''
      OR u.banned_until IS DISTINCT FROM timestamptz '2099-01-01 00:00:00+00'
      OR u.last_sign_in_at IS NOT NULL
      OR coalesce(to_jsonb(u)->>'phone','') <> ''
  ) THEN
    RAISE EXCEPTION 'A placeholder identity was changed or does not belong to this dataset; nothing deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p JOIN asaa_catalog_cleanup_targets t
      ON t.relation_id='public.profiles'::regclass AND t.row_id=p.id
    WHERE (to_jsonb(p)->>'is_admin') IS DISTINCT FROM 'false'
      OR (to_jsonb(p)->>'role') IS DISTINCT FROM 'provider'
      OR (to_jsonb(p)->>'deletion_requested_at') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A demo profile has changed privileges or account status; nothing deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.providers p JOIN asaa_catalog_cleanup_targets t
      ON t.relation_id='public.providers'::regclass AND t.row_id=p.id
    WHERE p.user_id IS DISTINCT FROM t.parent_id
      OR (to_jsonb(p)->>'is_verified') IS DISTINCT FROM 'false'
      OR (to_jsonb(p)->>'rating')::numeric IS DISTINCT FROM 0
      OR (to_jsonb(p)->>'reviews_count')::integer IS DISTINCT FROM 0
      OR (to_jsonb(p)->>'completed_projects')::integer IS DISTINCT FROM 0
      OR (to_jsonb(p)->>'tap_destination_id') IS NOT NULL
      OR (to_jsonb(p)->>'tap_account_status') IS DISTINCT FROM 'not_connected'
      OR (to_jsonb(p)->>'tap_onboarding_completed') IS DISTINCT FROM 'false'
  ) THEN
    RAISE EXCEPTION 'A demo provider has changed ownership, verification, reviews, earnings or Tap status; nothing deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.services s JOIN asaa_catalog_cleanup_targets t
      ON t.relation_id='public.services'::regclass AND t.row_id=s.id
    WHERE s.provider_id IS DISTINCT FROM t.parent_id
  ) THEN
    RAISE EXCEPTION 'A demo service has changed ownership; nothing deleted';
  END IF;

  -- Examine every incoming FK, including unknown tables, composite keys and
  -- legacy CASCADE/SET NULL actions. Only the exact seeded ownership chain is
  -- allowed; a real row pointing at any target always blocks cleanup.
  FOR fk IN
    SELECT c.*, child.relkind AS child_kind, parent.relkind AS parent_kind
    FROM pg_constraint c
    JOIN pg_class child ON child.oid=c.conrelid
    JOIN pg_class parent ON parent.oid=c.confrelid
    WHERE c.contype='f' AND c.confrelid IN (SELECT relation_id FROM asaa_catalog_cleanup_targets)
    ORDER BY c.conrelid,c.oid
  LOOP
    IF fk.child_kind NOT IN ('r','p') OR fk.parent_kind NOT IN ('r','p') THEN
      RAISE EXCEPTION 'Unsupported foreign-key relation for %; nothing deleted', fk.conname;
    END IF;
    SELECT string_agg(format('child.%I = parent.%I',ca.attname,pa.attname),' AND ' ORDER BY keys.position)
    INTO join_condition
    FROM unnest(fk.conkey,fk.confkey) WITH ORDINALITY AS keys(child_number,parent_number,position)
    JOIN pg_attribute ca ON ca.attrelid=fk.conrelid AND ca.attnum=keys.child_number
    JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=keys.parent_number;
    IF join_condition IS NULL THEN RAISE EXCEPTION 'Cannot inspect foreign key %', fk.conname; END IF;

    SELECT cardinality(fk.conkey)=1 AND cardinality(fk.confkey)=1 AND pa.attname='id' AND (
      (fk.conrelid='public.profiles'::regclass AND fk.confrelid='auth.users'::regclass AND ca.attname='id')
      OR (fk.conrelid='public.providers'::regclass AND fk.confrelid IN ('public.profiles'::regclass,'auth.users'::regclass) AND ca.attname='user_id')
      OR (fk.conrelid='public.services'::regclass AND fk.confrelid='public.providers'::regclass AND ca.attname='provider_id')
    ) INTO allowed_chain
    FROM pg_attribute ca,pg_attribute pa
    WHERE ca.attrelid=fk.conrelid AND ca.attnum=fk.conkey[1]
      AND pa.attrelid=fk.confrelid AND pa.attnum=fk.confkey[1];

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s child JOIN %s parent ON %s JOIN asaa_catalog_cleanup_targets target ON target.relation_id=$1 AND target.row_id=parent.id %s)',
      fk.conrelid::regclass,fk.confrelid::regclass,join_condition,
      CASE WHEN coalesce(allowed_chain,false) THEN
        'WHERE NOT EXISTS (SELECT 1 FROM asaa_catalog_cleanup_targets own WHERE own.relation_id=$2 AND own.row_id=child.id)'
      ELSE '' END
    ) INTO unexpected_reference USING fk.confrelid,fk.conrelid;
    IF unexpected_reference THEN
      RAISE EXCEPTION 'Referenced catalog data: %. Nothing deleted; preserve the referring records', fk.conrelid::regclass;
    END IF;
  END LOOP;

  -- Some Supabase tables use textual IDs or intentionally have no public FK.
  FOREACH relation_name IN ARRAY ARRAY['auth.identities','auth.sessions','auth.refresh_tokens'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(relation_name)
        AND attname='user_id' AND attnum>0 AND NOT attisdropped
    ) THEN RAISE EXCEPTION 'Unsupported Auth relation %: missing user_id', relation_name; END IF;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s a JOIN asaa_catalog_cleanup_targets t ON t.relation_id=''auth.users''::regclass AND t.row_id::text=to_jsonb(a)->>''user_id'')',
      to_regclass(relation_name)
    ) INTO unexpected_reference;
    IF unexpected_reference THEN RAISE EXCEPTION 'Demo identity has Auth activity in %; nothing deleted', relation_name; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM storage.objects object
    WHERE EXISTS (
      SELECT 1 FROM asaa_catalog_cleanup_targets t
      WHERE t.row_id::text IN (to_jsonb(object)->>'owner_id',to_jsonb(object)->>'owner')
        OR t.row_id::text=split_part(object.name,'/',1)
    )
  ) THEN RAISE EXCEPTION 'Storage objects belong to or reference the demo catalog; nothing deleted'; END IF;

  IF to_regclass('public.admin_audit_log') IS NOT NULL THEN
    SELECT count(*) INTO expected_count FROM pg_attribute
    WHERE attrelid='public.admin_audit_log'::regclass AND attname IN ('actor_id','target_id')
      AND attnum>0 AND NOT attisdropped;
    IF expected_count <> 2 THEN RAISE EXCEPTION 'Unsupported management audit schema; nothing deleted'; END IF;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.admin_audit_log a JOIN asaa_catalog_cleanup_targets t ON t.row_id::text IN (a.actor_id::text,a.target_id::text))'
      INTO unexpected_reference;
    IF unexpected_reference THEN RAISE EXCEPTION 'Management audit references the catalog; nothing deleted'; END IF;
  END IF;

  DELETE FROM public.services WHERE id IN (SELECT row_id FROM asaa_catalog_cleanup_targets WHERE relation_id='public.services'::regclass);
  DELETE FROM public.providers WHERE id IN (SELECT row_id FROM asaa_catalog_cleanup_targets WHERE relation_id='public.providers'::regclass);
  DELETE FROM public.profiles WHERE id IN (SELECT row_id FROM asaa_catalog_cleanup_targets WHERE relation_id='public.profiles'::regclass);
  DELETE FROM auth.users WHERE id IN (SELECT row_id FROM asaa_catalog_cleanup_targets WHERE relation_id='auth.users'::regclass);
  RAISE NOTICE 'Removed exactly 12 services and 6 providers/profiles/placeholder users; no business or audit rows removed';
END
$cleanup$;

COMMIT;
