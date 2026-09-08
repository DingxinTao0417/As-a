-- Read-only verification of the exact showcase catalog; no real row contents.
BEGIN;
SELECT count(*) AS placeholder_identities,
  count(*) FILTER (WHERE encrypted_password IS NULL AND banned_until='2099-01-01 00:00:00+00') AS banned_passwordless
FROM auth.users
WHERE id IN (SELECT ('d3a00001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,6)n)
  AND raw_app_meta_data->>'demo_dataset'='asaa-showcase-v1';

SELECT category,count(*) AS services FROM public.services
WHERE id IN (SELECT ('d3a00003-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,12)n)
GROUP BY category ORDER BY category;

-- LF/CRLF normalization accommodates the Windows SQL editor clipboard.
-- Expected: 32a7862dc26b5d77dd7bcdfcc450e654. A content check, not a security hash.
SELECT md5(string_agg(replace(name_ar||'|'||name_en||'|'||description_ar||'|'||description_en,chr(13),''),'|' ORDER BY id)) AS service_content_md5
FROM public.services
WHERE id IN (SELECT ('d3a00003-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,12)n);

SET LOCAL ROLE anon;
SELECT count(DISTINCT p.id) AS visible_demo_providers,count(s.id) AS visible_demo_services
FROM public.providers p JOIN public.services s ON s.provider_id=p.id
WHERE p.id IN (SELECT ('d3a00002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,6)n)
  AND s.id IN (SELECT ('d3a00003-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,12)n);
COMMIT;
