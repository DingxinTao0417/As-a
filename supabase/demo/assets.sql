-- Asaa showcase image links. Explicit execution only; never a migration.
-- Requires the 18 generated WebP objects to exist at the public Storage paths below.
BEGIN;
DO $assets$
DECLARE
  dataset constant text := 'asaa-showcase-v1';
  asset_base constant text := 'https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public';
  provider_assets constant jsonb := $providers$[{"id":"d3a00002-0000-4000-8000-000000000001","user_id":"d3a00001-0000-4000-8000-000000000001","avatar_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/avatars/asaa-showcase-v1/development.webp"},{"id":"d3a00002-0000-4000-8000-000000000002","user_id":"d3a00001-0000-4000-8000-000000000002","avatar_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/avatars/asaa-showcase-v1/design.webp"},{"id":"d3a00002-0000-4000-8000-000000000003","user_id":"d3a00001-0000-4000-8000-000000000003","avatar_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/avatars/asaa-showcase-v1/marketing.webp"},{"id":"d3a00002-0000-4000-8000-000000000004","user_id":"d3a00001-0000-4000-8000-000000000004","avatar_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/avatars/asaa-showcase-v1/writing.webp"},{"id":"d3a00002-0000-4000-8000-000000000005","user_id":"d3a00001-0000-4000-8000-000000000005","avatar_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/avatars/asaa-showcase-v1/video.webp"},{"id":"d3a00002-0000-4000-8000-000000000006","user_id":"d3a00001-0000-4000-8000-000000000006","avatar_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/avatars/asaa-showcase-v1/consulting.webp"}]$providers$::jsonb;
  service_assets constant jsonb := $services$[{"id":"d3a00003-0000-4000-8000-000000000001","provider_id":"d3a00002-0000-4000-8000-000000000001","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/01-cafe-launch.webp"},{"id":"d3a00003-0000-4000-8000-000000000002","provider_id":"d3a00002-0000-4000-8000-000000000001","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/02-booking-dashboard.webp"},{"id":"d3a00003-0000-4000-8000-000000000003","provider_id":"d3a00002-0000-4000-8000-000000000002","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/03-craft-identity.webp"},{"id":"d3a00003-0000-4000-8000-000000000004","provider_id":"d3a00002-0000-4000-8000-000000000002","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/04-booking-screens.webp"},{"id":"d3a00003-0000-4000-8000-000000000005","provider_id":"d3a00002-0000-4000-8000-000000000003","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/05-cafe-content-plan.webp"},{"id":"d3a00003-0000-4000-8000-000000000006","provider_id":"d3a00002-0000-4000-8000-000000000003","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/06-profile-content-review.webp"},{"id":"d3a00003-0000-4000-8000-000000000007","provider_id":"d3a00002-0000-4000-8000-000000000004","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/07-product-descriptions.webp"},{"id":"d3a00003-0000-4000-8000-000000000008","provider_id":"d3a00002-0000-4000-8000-000000000004","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/08-arabic-editing.webp"},{"id":"d3a00003-0000-4000-8000-000000000009","provider_id":"d3a00002-0000-4000-8000-000000000005","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/09-vertical-video.webp"},{"id":"d3a00003-0000-4000-8000-000000000010","provider_id":"d3a00002-0000-4000-8000-000000000005","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/10-motion-openers.webp"},{"id":"d3a00003-0000-4000-8000-000000000011","provider_id":"d3a00002-0000-4000-8000-000000000006","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/11-project-scoping.webp"},{"id":"d3a00003-0000-4000-8000-000000000012","provider_id":"d3a00002-0000-4000-8000-000000000006","image_url":"https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/12-enquiry-process.webp"}]$services$::jsonb;
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
      AND avatar_url LIKE 'https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/avatars/asaa-showcase-v1/%.webp') AS linked_provider_avatars,
  (SELECT count(*) FROM public.services
    WHERE id IN (SELECT ('d3a00003-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,12)n)
      AND image_urls[1] LIKE 'https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/%.webp') AS linked_service_covers;
