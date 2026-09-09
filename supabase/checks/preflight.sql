-- READ ONLY. Run against an existing target before preparing an adoption migration.
-- Store the output privately: metadata and policies reveal application structure.
SELECT current_database(),current_user,version();

SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name,ordinal_position;

SELECT n.nspname AS schema,c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','storage') AND c.relkind = 'r'
ORDER BY 1,2;

SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies
WHERE schemaname IN ('public','storage')
ORDER BY 1,2,3;

SELECT table_schema,table_name,grantee,privilege_type
FROM information_schema.role_table_grants
WHERE table_schema IN ('public','storage')
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY 1,2,3,4;

SELECT n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl,
       pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

SELECT conrelid::regclass AS table_name,conname,pg_get_constraintdef(oid)
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY 1,2;

SELECT schemaname,tablename,indexname,indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY 2,3;

SELECT id,name,public,file_size_limit,allowed_mime_types
FROM storage.buckets
ORDER BY id;

SELECT *
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname,tablename;

-- Inspect aggregate anomalies separately: duplicate providers.user_id,
-- duplicate conversations(seeker_id,provider_id), duplicate/non-null
-- orders.tap_charge_id, orders amount equality, legacy cents/SAR units,
-- orphan references, and SECURITY DEFINER functions. Do not include user
-- records, payment identifiers or credentials in shared logs.
