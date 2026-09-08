/** Verify catalog SQL in isolated PostgreSQL memory; no network or live credentials. */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const catalogPath = path.join(projectRoot, 'supabase/demo/catalog.sql')
const assetsPath = path.join(projectRoot, 'supabase/demo/assets.sql')
const cleanupPath = path.join(projectRoot, 'supabase/demo/remove-catalog.sql')
const migrationsPath = path.join(projectRoot, 'supabase/migrations')
const db = new PGlite()
let assertions = 0

async function expectScalar(sql, expected) {
  const result = await db.query(sql)
  assert.equal(result.rows.length, 1, `Expected one row: ${sql}`)
  assert.deepEqual(Object.values(result.rows[0])[0], expected, sql)
  assertions++
}

async function snapshotCatalog() {
  const snapshot = {}
  for (const table of ['auth.users', 'public.profiles', 'public.providers', 'public.services']) {
    snapshot[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows
  }
  return snapshot
}

async function expectCleanupRefused(cleanupSql, message) {
  const before = await snapshotCatalog()
  let caught
  try {
    await db.exec(cleanupSql)
  } catch (error) {
    caught = error
    // A DO-block exception leaves its explicit transaction aborted.
    await db.exec('ROLLBACK')
  }
  assert.ok(caught, 'Cleanup must refuse an unsafe dataset')
  assert.match(caught.message, message)
  assert.deepEqual(await snapshotCatalog(), before, 'Refused cleanup must preserve all catalog rows')
  assertions++
}

async function verifyCleanup(catalogSql, cleanupSql) {
  await db.exec(cleanupSql)
  for (const table of ['auth.users', 'public.profiles', 'public.providers', 'public.services']) {
    await expectScalar(`SELECT count(*)::int FROM ${table}`, 0)
  }
  await db.exec(cleanupSql)
  await expectScalar('SELECT count(*)::int FROM auth.users', 0)
  await db.exec(catalogSql)

  // Rehearse the legacy ownership chain seen in older projects. These changes
  // exist only inside this disposable PGlite database, never in a migration.
  await db.exec(`
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY(id) REFERENCES auth.users(id) ON DELETE CASCADE;
    ALTER TABLE public.providers DROP CONSTRAINT providers_user_id_fkey;
    ALTER TABLE public.providers ADD CONSTRAINT providers_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    ALTER TABLE public.services DROP CONSTRAINT services_provider_id_fkey;
    ALTER TABLE public.services ADD CONSTRAINT services_provider_id_fkey FOREIGN KEY(provider_id) REFERENCES public.providers(id) ON DELETE CASCADE;
  `)

  // Buyer 7 deliberately shares the demo UUID prefix but is outside the exact
  // catalog manifest. Its account and its independent catalog must survive.
  const buyer = 'd3a00001-0000-4000-8000-000000000007'
  const user = 'd3a00001-0000-4000-8000-000000000001'
  const provider = 'd3a00002-0000-4000-8000-000000000001'
  const service = 'd3a00003-0000-4000-8000-000000000001'
  const unrelatedProvider = 'eeee0002-0000-4000-8000-000000000001'
  const unrelatedService = 'eeee0003-0000-4000-8000-000000000001'
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'unrelated@example.invalid','{}')", [buyer])
  await db.query("INSERT INTO public.providers(id,user_id,name_en) VALUES ($1,$2,'Unrelated provider')", [unrelatedProvider, buyer])
  await db.query("INSERT INTO public.services(id,provider_id,name_ar,name_en,category,price) VALUES ($1,$2,'Other','Unrelated service','design',100)", [unrelatedService, unrelatedProvider])

  await db.exec('CREATE TABLE public.cleanup_unknown_reference (id integer PRIMARY KEY,service_id uuid REFERENCES public.services(id) ON DELETE CASCADE)')
  await db.query('INSERT INTO public.cleanup_unknown_reference VALUES (1,$1)', [service])
  await expectCleanupRefused(cleanupSql, /Referenced catalog data: cleanup_unknown_reference/)
  await expectScalar('SELECT count(*)::int FROM public.cleanup_unknown_reference', 1)
  await db.exec('DROP TABLE public.cleanup_unknown_reference')

  await db.query('INSERT INTO public.favorites(user_id,provider_id) VALUES ($1,$2)', [buyer, provider])
  await expectCleanupRefused(cleanupSql, /Referenced catalog data: favorites/)
  await expectScalar('SELECT count(*)::int FROM public.favorites', 1)
  await db.exec('DELETE FROM public.favorites')

  await db.query("INSERT INTO public.services(provider_id,name_ar,name_en,category,price) VALUES ($1,'New','Newly created listing','design',100)", [provider])
  await expectCleanupRefused(cleanupSql, /Referenced catalog data: services/)
  await db.query("DELETE FROM public.services WHERE name_en='Newly created listing' AND provider_id=$1", [provider])

  await db.query('INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2)', ['eeee0004-0000-4000-8000-000000000001', user])
  await expectCleanupRefused(cleanupSql, /Referenced catalog data: auth.sessions/)
  await expectScalar('SELECT count(*)::int FROM auth.sessions', 1)
  await db.exec('DELETE FROM auth.sessions')

  await db.query('INSERT INTO auth.refresh_tokens(id,user_id) VALUES (1,$1)', [user])
  await expectCleanupRefused(cleanupSql, /Auth activity in auth.refresh_tokens/)
  await expectScalar('SELECT count(*)::int FROM auth.refresh_tokens', 1)
  await db.exec('DELETE FROM auth.refresh_tokens')

  await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('service-images',$1)", [`${provider}/new-upload.png`])
  await expectCleanupRefused(cleanupSql, /Storage objects/)
  await expectScalar('SELECT count(*)::int FROM storage.objects', 1)
  await db.exec('DELETE FROM storage.objects')

  await db.query("INSERT INTO public.admin_audit_log(actor_id,action,target_id,before_data,after_data) VALUES ($1,'set_service_active',$2,'{}','{}')", [buyer, service])
  await expectCleanupRefused(cleanupSql, /Management audit references/)
  await expectScalar('SELECT count(*)::int FROM public.admin_audit_log', 1)
  // This resets only a synthetic test fixture in the disposable local database;
  // remove-catalog.sql is the subject under test and never deletes audit records.
  await db.exec('DELETE FROM public.admin_audit_log')

  await db.query("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=$1", [user])
  await expectCleanupRefused(cleanupSql, /placeholder identity was changed/)
  await db.query(`UPDATE auth.users SET raw_app_meta_data='{"demo_dataset":"asaa-showcase-v1"}' WHERE id=$1`, [user])

  await db.exec(cleanupSql)
  for (const table of ['auth.users', 'public.profiles', 'public.providers', 'public.services']) {
    await expectScalar(`SELECT count(*)::int FROM ${table}`, 1)
  }
  await expectScalar(`SELECT count(*)::int FROM auth.users WHERE id='${buyer}'`, 1)
  await expectScalar(`SELECT count(*)::int FROM public.services WHERE id='${unrelatedService}'`, 1)
  await db.exec(cleanupSql)
  await expectScalar('SELECT count(*)::int FROM auth.users', 1)
}

async function verifyCatalog() {
  await expectScalar('SELECT count(*)::int FROM auth.users', 6)
  await expectScalar('SELECT count(*)::int FROM public.profiles', 6)
  await expectScalar('SELECT count(*)::int FROM public.providers', 6)
  await expectScalar('SELECT count(*)::int FROM public.services', 12)
  await expectScalar(`
    SELECT count(*)::int FROM auth.users
    WHERE coalesce(encrypted_password, '') <> ''
       OR banned_until IS NULL
       OR banned_until <> timestamptz '2099-01-01 00:00:00+00'
       OR email IS NULL OR email NOT LIKE '%.invalid'
  `, 0)
  await expectScalar(`
    SELECT count(*)::int FROM public.profiles
    WHERE is_admin OR role <> 'provider' OR deletion_requested_at IS NOT NULL
  `, 0)
  await expectScalar(`
    SELECT count(*)::int FROM public.providers
    WHERE is_verified OR rating <> 0 OR reviews_count <> 0 OR completed_projects <> 0
       OR tap_destination_id IS NOT NULL OR tap_account_status <> 'not_connected'
       OR tap_onboarding_completed
  `, 0)
  await expectScalar(`
    SELECT count(*)::int FROM public.services
    WHERE NOT is_active OR cardinality(image_urls) = 0
       OR name_ar = '' OR name_en = ''
       OR price < 1 OR price > 1000000
  `, 0)
  await expectScalar(`
    SELECT count(*)::int FROM public.providers
    WHERE avatar_url LIKE 'https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/avatars/asaa-showcase-v1/%.webp'
  `, 6)
  await expectScalar(`
    SELECT count(*)::int FROM public.services
    WHERE image_urls[1] LIKE 'https://nbhbendahduyiobyewzw.supabase.co/storage/v1/object/public/service-images/asaa-showcase-v1/%.webp'
  `, 12)
  for (const table of [
    'public.orders', 'public.reviews', 'public.service_history', 'public.withdrawal_requests',
    'public.conversations', 'public.messages', 'public.favorites', 'public.admin_audit_log',
    'auth.identities', 'auth.sessions', 'auth.refresh_tokens', 'storage.objects',
  ]) {
    await expectScalar(`SELECT count(*)::int FROM ${table}`, 0)
  }

  await db.exec('BEGIN; SET LOCAL ROLE anon;')
  try {
    await db.query("SELECT set_config('request.jwt.claim.role', 'anon', true)")
    await expectScalar('SELECT count(*)::int FROM public.services', 12)
    await expectScalar('SELECT count(*)::int FROM public.providers', 6)
    await expectScalar('SELECT count(*)::int FROM public.public_profiles', 6)
    await db.exec('COMMIT')
  } catch (error) {
    await db.exec('ROLLBACK')
    throw error
  }
}

try {
  // Auth/Storage stand-ins mirror the existing database validator. They test the
  // SQL contract, not the hosted Auth service, PostgREST, or Storage gateway.
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      instance_id uuid,
      aud text,
      role text,
      email text,
      encrypted_password text,
      email_confirmed_at timestamptz,
      confirmation_token text,
      recovery_token text,
      email_change_token_new text,
      email_change text,
      raw_app_meta_data jsonb NOT NULL DEFAULT '{}',
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}',
      banned_until timestamptz,
      last_sign_in_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE auth.identities (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
    CREATE TABLE auth.refresh_tokens (id bigint PRIMARY KEY, user_id text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE TABLE storage.buckets (id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text NOT NULL,owner_id text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated,service_role;
  `)

  const migrations = (await readdir(migrationsPath)).filter((name) => name.endsWith('.sql')).sort()
  for (const file of migrations) {
    const sql = await readFile(path.join(migrationsPath, file), 'utf8')
    await db.exec(`BEGIN;\n${sql}\nCOMMIT;`)
  }

  const catalogSql = await readFile(catalogPath, 'utf8')
  const assetsSql = await readFile(assetsPath, 'utf8')
  await db.exec(catalogSql)
  await verifyCatalog()
  await db.exec(`
    UPDATE public.profiles SET avatar_url='/placeholder.svg';
    UPDATE public.providers SET avatar_url='/placeholder.svg';
    UPDATE public.services SET image_urls=ARRAY['/placeholder.svg'];
  `)
  await db.exec(assetsSql)
  await verifyCatalog()
  const imageLinkedCatalog = await snapshotCatalog()
  await db.exec(assetsSql)
  assert.deepEqual(await snapshotCatalog(), imageLinkedCatalog, 'Repeated image linking must not modify catalog rows')
  assertions++
  const initialCatalog = await snapshotCatalog()
  await db.exec(catalogSql)
  await verifyCatalog()
  assert.deepEqual(await snapshotCatalog(), initialCatalog, 'Re-import must not modify existing catalog rows')
  assertions++
  const cleanupSql = await readFile(cleanupPath, 'utf8')
  await verifyCleanup(catalogSql, cleanupSql)
  console.log(`Catalog SQL passed: ${assertions} assertions; 6 users/profiles/providers, 12 services, anonymous visibility, no financial data, identical re-import.`)
  console.log('Cleanup passed on RESTRICT and legacy CASCADE schemas; rejected unexpected references, Auth activity, Storage, audit and changed identity; preserved buyer 7 and unrelated catalog.')
  console.log('Local PGlite validation only; no remote Supabase or Auth service was contacted.')
} catch (error) {
  // Avoid printing the whole SQL/data payload; the failed assertion/query identifies
  // the local problem without echoing every fixture field.
  console.error(`Catalog SQL validation failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await db.close()
}
