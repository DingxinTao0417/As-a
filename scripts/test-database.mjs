/** Real in-memory PostgreSQL migration/RLS tests; no network or live credentials. */
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const db = new PGlite()
let assertions = 0
const user = '10000000-0000-4000-8000-000000000001'
const providerUser = '10000000-0000-4000-8000-000000000002'
const outsider = '10000000-0000-4000-8000-000000000003'
const provider = '20000000-0000-4000-8000-000000000001'
const service = '30000000-0000-4000-8000-000000000001'
const conversation = '40000000-0000-4000-8000-000000000001'
const message = '50000000-0000-4000-8000-000000000001'
const order = '60000000-0000-4000-8000-000000000001'

async function asRole(role, id, callback) {
  assert.ok(['anon','authenticated','service_role'].includes(role))
  await db.exec('BEGIN')
  try {
    await db.exec(`SET LOCAL ROLE ${role}`)
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [id ?? '',role])
    const result = await callback()
    await db.exec('COMMIT')
    return result
  } catch (error) {
    await db.exec('ROLLBACK')
    throw error
  }
}
async function expectDenied(role,id,sql,params = []) {
  await assert.rejects(() => asRole(role,id,() => db.query(sql,params)), (error) => ['42501','23514'].includes(error.code))
  assertions++
}
async function expectValue(role,id,sql,expected,params = []) {
  const result = await asRole(role,id,() => db.query(sql,params))
  assert.deepEqual(Object.values(result.rows[0])[0],expected,sql)
  assertions++
}

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    -- Model Supabase's potentially broad defaults; migrations must revoke them.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users (id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE TABLE storage.buckets (id text PRIMARY KEY,name text NOT NULL,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text NOT NULL);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated,service_role;
  `)
  for (const file of (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(path.join('supabase/migrations',file),'utf8')
    await db.exec(`BEGIN;\n${sql}\nCOMMIT;`)
    console.log(`Migration passed: ${file}`)
  }

  // Signup must ignore user-controlled admin/role metadata.
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'buyer@example.test',$4),($2,'provider@example.test','{}'),($3,'outsider@example.test','{}')", [user,providerUser,outsider,JSON.stringify({is_admin:true,role:'admin',full_name:'Buyer'})])
  await expectValue('authenticated',user,'SELECT is_admin FROM public.profiles WHERE id=$1',false,[user])
  await expectValue('authenticated',user,'SELECT role FROM public.profiles WHERE id=$1','seeker',[user])
  await expectDenied('authenticated',user,'UPDATE public.profiles SET is_admin=true WHERE id=$1',[user])
  await expectDenied('authenticated',user,"UPDATE public.profiles SET role='provider' WHERE id=$1",[user])
  await expectDenied('authenticated',providerUser,"INSERT INTO public.providers(user_id,is_verified) VALUES ($1,true)",[providerUser])
  await asRole('authenticated',providerUser,() => db.query("INSERT INTO public.providers(id,user_id,name_en) VALUES ($1,$2,'Provider')",[provider,providerUser]))
  await expectValue('authenticated',providerUser,'SELECT role FROM public.profiles WHERE id=$1','provider',[providerUser])
  await expectDenied('authenticated',providerUser,'UPDATE public.providers SET completed_projects=999 WHERE id=$1',[provider])
  await expectValue('authenticated',outsider,'SELECT count(*)::int FROM public.profiles WHERE id <> $1',0,[outsider])
  await expectValue('anon',null,'SELECT count(*)::int FROM public.public_profiles',3)
  await expectDenied('anon',null,'SELECT email FROM public.profiles')

  // Moderation is authoritative; a provider cannot publish through REST.
  await expectDenied('authenticated',providerUser,"INSERT INTO public.services(provider_id,name_ar,name_en,category,price,is_active) VALUES ($1,'A','Service','design',100,true)",[provider])
  await asRole('authenticated',providerUser,() => db.query("INSERT INTO public.services(id,provider_id,name_ar,name_en,category,price) VALUES ($1,$2,'A','Service','design',100)",[service,provider]))
  await expectValue('anon',null,'SELECT count(*)::int FROM public.services',0)
  await expectDenied('authenticated',providerUser,'UPDATE public.services SET is_active=true WHERE id=$1',[service])
  await asRole('service_role',null,() => db.query('UPDATE public.services SET is_active=true WHERE id=$1',[service]))
  await expectValue('anon',null,'SELECT count(*)::int FROM public.services',1)
  await asRole('authenticated',providerUser,() => db.query("UPDATE public.services SET name_en='Changed' WHERE id=$1",[service]))
  await expectValue('anon',null,'SELECT count(*)::int FROM public.services',0)
  await asRole('service_role',null,() => db.query('UPDATE public.services SET is_active=true WHERE id=$1',[service]))

  // Membership and immutable content are enforced below the client UI.
  await asRole('authenticated',user,() => db.query('INSERT INTO public.conversations(id,seeker_id,provider_id) VALUES ($1,$2,$3)',[conversation,user,provider]))
  await expectDenied('authenticated',outsider,'INSERT INTO public.messages(conversation_id,sender_id,content) VALUES ($1,$2,\'attack\')',[conversation,outsider])
  await expectDenied('authenticated',user,'INSERT INTO public.messages(conversation_id,sender_id,content) VALUES ($1,$2,\'impersonation\')',[conversation,providerUser])
  await asRole('authenticated',user,() => db.query("INSERT INTO public.messages(id,conversation_id,sender_id,content) VALUES ($1,$2,$3,'hello')",[message,conversation,user]))
  await expectValue('authenticated',outsider,'SELECT count(*)::int FROM public.messages',0)
  await expectValue('authenticated',providerUser,'SELECT count(*)::int FROM public.messages',1)
  await expectDenied('authenticated',providerUser,"UPDATE public.messages SET content='changed' WHERE id=$1",[message])
  await asRole('authenticated',providerUser,() => db.query('UPDATE public.messages SET is_read=true WHERE id=$1',[message]))
  await expectValue('authenticated',user,'SELECT is_read FROM public.messages WHERE id=$1',true,[message])
  await expectDenied('authenticated',user,'UPDATE public.conversations SET is_pinned_by_provider=true WHERE id=$1',[conversation])

  // Trusted order insert plus row-level money isolation and active-order deletion guard.
  const orderSQL = "INSERT INTO public.orders(id,conversation_id,seeker_id,provider_id,service_id,service_name_ar,service_name_en,amount,platform_fee,provider_amount) VALUES ($1,$2,$3,$4,$5,'A','Order',100,10,90)"
  const orderParams = [order,conversation,user,provider,service]
  await expectDenied('authenticated',user,orderSQL,orderParams)
  await asRole('service_role',null,() => db.query(orderSQL,orderParams))
  await expectDenied('authenticated',user,"UPDATE public.orders SET status='paid' WHERE id=$1",[order])
  await expectValue('authenticated',outsider,'SELECT count(*)::int FROM public.orders',0)
  await expectDenied('authenticated',providerUser,"INSERT INTO public.withdrawal_requests(provider_id,amount) VALUES ($1,10)",[provider])
  await assert.rejects(() => asRole('authenticated',user,() => db.query('SELECT public.request_account_deletion()')), (error) => error.code === 'P0001')
  assertions++
  await expectValue('authenticated',user,'SELECT deletion_requested_at IS NULL FROM public.profiles WHERE id=$1',true,[user])

  // Reviews require a completed, owned order and its exact service association.
  const reviewSQL = 'INSERT INTO public.reviews(order_id,service_id,reviewer_id,rating) VALUES ($1,$2,$3,5)'
  await expectDenied('authenticated',user,reviewSQL,[order,service,user])
  await asRole('service_role',null,() => db.query("UPDATE public.orders SET status='completed' WHERE id=$1",[order]))
  await expectDenied('authenticated',user,reviewSQL,[order,null,user])
  await asRole('authenticated',user,() => db.query(reviewSQL,[order,service,user]))
  await expectValue('anon',null,'SELECT rating::float FROM public.providers WHERE id=$1',5,[provider])
  await asRole('authenticated',user,() => db.query('UPDATE public.reviews SET rating=2 WHERE order_id=$1',[order]))
  await expectValue('anon',null,'SELECT rating::float FROM public.providers WHERE id=$1',2,[provider])
  await expectDenied('authenticated',user,'UPDATE public.reviews SET service_id=NULL WHERE order_id=$1',[order])
  await expectValue('authenticated',outsider,'WITH changed AS (DELETE FROM public.reviews WHERE order_id=$1 RETURNING id) SELECT count(*)::int FROM changed',0,[order])
  await assert.rejects(() => asRole('authenticated',providerUser,() => db.query('SELECT public.request_account_deletion()')), (error) => error.code === 'P0001')
  assertions++

  await expectDenied('authenticated',user,"SELECT public.consume_rate_limit('test',2,60)")
  await expectValue('service_role',null,"SELECT public.consume_rate_limit('test',2,60)",true)
  await expectValue('service_role',null,"SELECT public.consume_rate_limit('test',2,60)",true)
  await expectValue('service_role',null,"SELECT public.consume_rate_limit('test',2,60)",false)
  await asRole('service_role',null,() => db.exec("UPDATE public.rate_limits SET expires_at=now()-interval '1 second' WHERE key='test'"))
  await expectValue('service_role',null,"SELECT public.consume_rate_limit('test',2,60)",true)

  // Storage paths are scoped to the owner.
  await asRole('authenticated',user,() => db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars',$1)",[`${user}/avatar`]))
  await expectDenied('authenticated',outsider,"INSERT INTO storage.objects(bucket_id,name) VALUES ('avatars',$1)",[`${user}/overwrite`])

  // Deletion makes a valid JWT powerless and prevents subsequent trusted orders.
  await asRole('service_role',null,() => db.query("UPDATE public.orders SET status='cancelled' WHERE id=$1",[order]))
  await asRole('authenticated',user,() => db.query('SELECT public.request_account_deletion()'))
  await expectValue('authenticated',user,'SELECT count(*)::int FROM public.messages',0)
  await expectValue('anon',null,'SELECT count(*)::int FROM public.public_profiles WHERE id=$1',0,[user])
  await expectValue('authenticated',user,"WITH changed AS (UPDATE public.profiles SET deletion_requested_at=NULL WHERE id=$1 RETURNING id) SELECT count(*)::int FROM changed",0,[user])
  await expectDenied('service_role',null,orderSQL,['60000000-0000-4000-8000-000000000002',conversation,user,provider,service])
  await asRole('authenticated',providerUser,() => db.query('SELECT public.request_account_deletion()'))
  await expectValue('anon',null,'SELECT count(*)::int FROM public.providers WHERE id=$1',0,[provider])
  await expectValue('anon',null,'SELECT count(*)::int FROM public.services WHERE id=$1',0,[service])

  for (const file of ['tests/payments/database.sql','tests/admin/database.sql']) {
    await db.exec(await readFile(file,'utf8'))
    console.log(`SQL regression passed: ${file}`)
  }
  console.log(`Database verification passed: ${assertions} security assertions; full migration chain executed.`)
} finally {
  await db.close()
}
