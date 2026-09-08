/** Build the idempotent image-link update for the fixed showcase catalog. */
import { mkdir, writeFile } from "node:fs/promises"
import { createDemoFixtures, DEMO_ASSET_BASE_URL, DEMO_DATASET_ID } from "./fixtures.mjs"

const fixtures = createDemoFixtures()
const providers = fixtures.providers.map((provider) => ({
  id: provider.id,
  user_id: provider.user_id,
  avatar_url: provider.avatar_url,
}))
const services = fixtures.services.map((service) => ({
  id: service.id,
  provider_id: service.provider_id,
  image_url: service.image_urls[0],
}))

const sql = `-- Asaa showcase image links. Explicit execution only; never a migration.
-- Requires the 18 generated WebP objects to exist at the public Storage paths below.
BEGIN;
DO $assets$
DECLARE
  dataset constant text := '${DEMO_DATASET_ID}';
  asset_base constant text := '${DEMO_ASSET_BASE_URL}';
  provider_assets constant jsonb := $providers$${JSON.stringify(providers)}$providers$::jsonb;
  service_assets constant jsonb := $services$${JSON.stringify(services)}$services$::jsonb;
  expected integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(dataset || '-assets'));
  SELECT count(*) INTO expected
  FROM auth.users u
  JOIN public.providers p ON p.user_id=u.id
  JOIN jsonb_to_recordset(provider_assets) a(id uuid,user_id uuid,avatar_url text)
    ON a.id=p.id AND a.user_id=u.id
  WHERE u.raw_app_meta_data->>'demo_dataset'=dataset
    AND a.avatar_url LIKE asset_base || '/avatars/' || dataset || '/%.webp';
  IF expected <> 6 THEN
    RAISE EXCEPTION 'Expected all 6 owned demo providers before linking images; found %', expected;
  END IF;

  SELECT count(*) INTO expected
  FROM public.services s
  JOIN jsonb_to_recordset(service_assets) a(id uuid,provider_id uuid,image_url text)
    ON a.id=s.id AND a.provider_id=s.provider_id
  WHERE a.image_url LIKE asset_base || '/service-images/' || dataset || '/%.webp';
  IF expected <> 12 THEN
    RAISE EXCEPTION 'Expected all 12 owned demo services before linking images; found %', expected;
  END IF;

  UPDATE public.profiles profile
  SET avatar_url=a.avatar_url, updated_at=now()
  FROM jsonb_to_recordset(provider_assets) a(id uuid,user_id uuid,avatar_url text)
  WHERE profile.id=a.user_id AND profile.avatar_url IS DISTINCT FROM a.avatar_url;

  UPDATE public.providers provider
  SET avatar_url=a.avatar_url, updated_at=now()
  FROM jsonb_to_recordset(provider_assets) a(id uuid,user_id uuid,avatar_url text)
  WHERE provider.id=a.id AND provider.user_id=a.user_id
    AND provider.avatar_url IS DISTINCT FROM a.avatar_url;

  UPDATE public.services service
  SET image_urls=ARRAY[a.image_url], updated_at=now()
  FROM jsonb_to_recordset(service_assets) a(id uuid,provider_id uuid,image_url text)
  WHERE service.id=a.id AND service.provider_id=a.provider_id
    AND service.image_urls IS DISTINCT FROM ARRAY[a.image_url];
END
$assets$;
COMMIT;

SELECT
  (SELECT count(*) FROM public.providers
    WHERE id IN (SELECT ('d3a00002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,6)n)
      AND avatar_url LIKE '${DEMO_ASSET_BASE_URL}/avatars/${DEMO_DATASET_ID}/%.webp') AS linked_provider_avatars,
  (SELECT count(*) FROM public.services
    WHERE id IN (SELECT ('d3a00003-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,12)n)
      AND image_urls[1] LIKE '${DEMO_ASSET_BASE_URL}/service-images/${DEMO_DATASET_ID}/%.webp') AS linked_service_covers;
`

await mkdir(new URL("../../supabase/demo/", import.meta.url), { recursive: true })
await writeFile(new URL("../../supabase/demo/assets.sql", import.meta.url), sql)
console.log("Generated supabase/demo/assets.sql (image links only, no database connection).")
