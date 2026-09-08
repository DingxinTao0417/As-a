/** Build an explicit, repeatable catalog import. Never connects to a database. */
import { mkdir, writeFile } from 'node:fs/promises'
import { createDemoFixtures, DEMO_DATASET_ID, DEMO_ANCHOR } from './fixtures.mjs'

const fixtures = createDemoFixtures()
const disclaimerAr = fixtures.services[0].description_ar.split('\n\n')[0]
const disclaimerEn = fixtures.services[0].description_en.split('\n\n')[0]
const body = (value) => value.slice(value.indexOf('\n\n') + 2)
// Compact wire format, derived from the richer local fixtures. Financial history
// and derived ratings deliberately never enter this payload.
const payload = fixtures.providers.map((p) => ({
  category: p.category,
  email: fixtures.authUsers.find((u) => u.id === p.user_id).email,
  name_ar: p.name_ar, name_en: p.name_en,
  title_ar: p.title_ar, title_en: p.title_en,
  bio_ar: body(p.bio_ar), bio_en: body(p.bio_en),
  hourly_rate: p.hourly_rate, skills: p.skills,
  services: fixtures.services.filter((s) => s.provider_id === p.id).map((s) => ({
    name_ar: s.name_ar, name_en: s.name_en,
    description_ar: body(s.description_ar), description_en: body(s.description_en),
    price: s.price, price_type: s.price_type, delivery_time: s.delivery_time, features: s.features,
  })),
}))
const literal = (text) => `'${text.replaceAll("'", "''")}'`
const sql = `-- Asaa showcase catalog v1. Explicit execution only; never part of db reset/migrations.
-- Target reviewed: v0_database / nbhbendahduyiobyewzw, 2026-09-07 America/Tijuana.
-- Adds 6 banned, passwordless placeholder identities, 6 profiles/providers, 12 services.
-- No login credentials, payment records, reviews, balances, schema or policy changes.
-- A repeated import preserves existing demo content. Any UUID ownership collision aborts.
BEGIN;
DO $catalog$
DECLARE
  dataset constant text := '${DEMO_DATASET_ID}';
  anchor constant timestamptz := '${DEMO_ANCHOR}';
  disclaimer_ar constant text := ${literal(disclaimerAr)};
  disclaimer_en constant text := ${literal(disclaimerEn)};
  catalog constant jsonb := $data$${JSON.stringify(payload)}$data$::jsonb;
  p jsonb; s jsonb; account_id uuid; provider_id_value uuid; service_id_value uuid;
  provider_index integer := 0; service_index integer := 0; new_identity boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(dataset));
  FOR p IN SELECT value FROM jsonb_array_elements(catalog) LOOP
    provider_index := provider_index + 1;
    account_id := ('d3a00001-0000-4000-8000-' || lpad(provider_index::text,12,'0'))::uuid;
    provider_id_value := ('d3a00002-0000-4000-8000-' || lpad(provider_index::text,12,'0'))::uuid;
    IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id=account_id AND
      (u.raw_app_meta_data->>'demo_dataset' IS DISTINCT FROM dataset OR u.email IS DISTINCT FROM p->>'email'
       OR coalesce(u.encrypted_password,'')<>'' OR u.banned_until IS DISTINCT FROM timestamptz '2099-01-01 00:00:00+00')) THEN
      RAISE EXCEPTION 'Demo identity collision or changed authentication: %', account_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.providers x WHERE x.id=provider_id_value AND x.user_id IS DISTINCT FROM account_id)
       OR EXISTS (SELECT 1 FROM public.providers x WHERE x.user_id=account_id AND x.id<>provider_id_value) THEN
      RAISE EXCEPTION 'Demo provider association collision: %', provider_id_value;
    END IF;
    new_identity := NOT EXISTS (SELECT 1 FROM auth.users WHERE id=account_id);
    IF new_identity THEN
      INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,banned_until,created_at,updated_at)
      VALUES (account_id,p->>'email',jsonb_build_object('demo_dataset',dataset),
        jsonb_build_object('full_name',(p->>'name_ar')||' / '||(p->>'name_en'),'role','provider','demo_dataset',dataset),
        '2099-01-01 00:00:00+00',anchor,anchor);
      -- Supports both the reviewed legacy trigger and the fresh-schema trigger.
      INSERT INTO public.profiles(id,email,full_name,role,is_admin,avatar_url,created_at,updated_at)
      VALUES(account_id,p->>'email',(p->>'name_ar')||' / '||(p->>'name_en'),'provider',false,'/placeholder.svg',anchor,anchor)
      ON CONFLICT (id) DO NOTHING;
      UPDATE public.profiles SET role='provider',avatar_url='/placeholder.svg' WHERE id=account_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=account_id AND role='provider' AND NOT is_admin) THEN
      RAISE EXCEPTION 'Demo profile missing or unexpectedly privileged: %', account_id;
    END IF;
    INSERT INTO public.providers(id,user_id,name_ar,name_en,title_ar,title_en,bio_ar,bio_en,
      display_name,title,bio,category,hourly_rate,starting_price,skills,categories,avatar_url,
      rating,reviews_count,completed_projects,is_verified,tap_account_status,tap_onboarding_completed,created_at,updated_at)
    SELECT id,user_id,name_ar,name_en,title_ar,title_en,bio_ar,bio_en,display_name,title,bio,category,
      hourly_rate,starting_price,skills,categories,avatar_url,rating,reviews_count,completed_projects,is_verified,
      tap_account_status,tap_onboarding_completed,created_at,updated_at
    FROM jsonb_populate_record(NULL::public.providers,p || jsonb_build_object(
      'id',provider_id_value,'user_id',account_id,'display_name',p->>'name_en','title',p->>'title_en',
      'bio_ar',disclaimer_ar||chr(10)||chr(10)||(p->>'bio_ar'),'bio_en',disclaimer_en||chr(10)||chr(10)||(p->>'bio_en'),
      'bio',disclaimer_en||chr(10)||chr(10)||(p->>'bio_en'),'categories',jsonb_build_array(p->>'category'),
      'starting_price',(SELECT min((value->>'price')::numeric) FROM jsonb_array_elements(p->'services')),
      'avatar_url','/placeholder.svg','rating',0,'reviews_count',0,'completed_projects',0,'is_verified',false,
      'tap_account_status','not_connected','tap_onboarding_completed',false,'created_at',anchor,'updated_at',anchor))
    ON CONFLICT (id) DO NOTHING;
    FOR s IN SELECT value FROM jsonb_array_elements(p->'services') LOOP
      service_index := service_index + 1;
      service_id_value := ('d3a00003-0000-4000-8000-' || lpad(service_index::text,12,'0'))::uuid;
      IF EXISTS (SELECT 1 FROM public.services x WHERE x.id=service_id_value AND x.provider_id IS DISTINCT FROM provider_id_value) THEN
        RAISE EXCEPTION 'Demo service association collision: %',service_id_value;
      END IF;
      INSERT INTO public.services(id,provider_id,name_ar,name_en,description_ar,description_en,category,
        price,price_type,delivery_time,features,image_urls,is_active,created_at,updated_at)
      SELECT id,provider_id,name_ar,name_en,description_ar,description_en,category,
        price,price_type,delivery_time,features,image_urls,is_active,created_at,updated_at
      FROM jsonb_populate_record(NULL::public.services,s || jsonb_build_object(
        'id',service_id_value,'provider_id',provider_id_value,'category',p->>'category',
        'description_ar',disclaimer_ar||chr(10)||chr(10)||(s->>'description_ar'),
        'description_en',disclaimer_en||chr(10)||chr(10)||(s->>'description_en'),
        'image_urls',jsonb_build_array('/placeholder.svg'),'is_active',true,'created_at',anchor,'updated_at',anchor))
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END LOOP;
  IF provider_index<>6 OR service_index<>12 THEN RAISE EXCEPTION 'Unexpected catalog size'; END IF;
END $catalog$;
COMMIT;
SELECT 'asaa-showcase-v1' AS dataset, count(DISTINCT u.id) AS demo_identities,
  count(DISTINCT p.id) AS demo_providers,count(s.id) AS demo_services
FROM auth.users u JOIN public.providers p ON p.user_id=u.id JOIN public.services s ON s.provider_id=p.id
WHERE u.raw_app_meta_data->>'demo_dataset'='asaa-showcase-v1';
`
await mkdir(new URL('../../supabase/demo/', import.meta.url), { recursive: true })
await writeFile(new URL('../../supabase/demo/catalog.sql', import.meta.url), sql)
console.log('Generated supabase/demo/catalog.sql (catalog only, no database connection).')
