/** Runs the local migration chain against an isolated in-memory PostgreSQL database. */
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"

const db = new PGlite()
const migrationsDirectory = "supabase/migrations"

async function scalar(sql, params = []) {
  const result = await db.query(sql, params)
  return Object.values(result.rows[0])[0]
}

async function asRole(role, userId, callback) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role))
  await db.exec("BEGIN")
  try {
    await db.exec(`SET LOCAL ROLE ${role}`)
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [userId ?? "", role],
    )
    const result = await callback()
    await db.exec("COMMIT")
    return result
  } catch (error) {
    await db.exec("ROLLBACK")
    throw error
  }
}

async function expectDenied(role, userId, sql, params = []) {
  await assert.rejects(
    asRole(role, userId, () => db.query(sql, params)),
    (error) => ["42501", "23514"].includes(error.code),
  )
}

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.role',true),'')
    $$;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets(id),
      name text NOT NULL
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
      SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]
    $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated,service_role;
  `)

  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort()

  for (const migration of migrations) {
    const sql = await readFile(path.join(migrationsDirectory, migration), "utf8")
    await db.exec(`BEGIN;\n${sql}\nCOMMIT;`)
    console.log(`Migration passed: ${migration}`)
  }

  const expectedTables = [
    "account_deletion_requests",
    "ai_chat_sessions",
    "ai_chat_turns",
    "ai_knowledge_articles",
    "conversations",
    "dispute_evidence",
    "disputes",
    "favorites",
    "ledger_entries",
    "messages",
    "notifications",
    "order_deliveries",
    "orders",
    "payment_attempts",
    "payment_events",
    "payout_attempts",
    "profiles",
    "provider_verification_documents",
    "provider_verification_requests",
    "providers",
    "rate_limits",
    "refund_attempts",
    "refund_events",
    "refund_requests",
    "reviews",
    "service_history",
    "service_image_cleanup_jobs",
    "services",
    "support_ticket_messages",
    "support_tickets",
    "admin_audit_log",
    "withdrawal_requests",
  ].sort()
  const actualTables = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  )
  assert.deepEqual(actualTables.rows.map((row) => row.table_name), expectedTables)
  assert.equal(
    await scalar(
      "SELECT count(*)::int FROM information_schema.views WHERE table_schema='public' AND table_name='public_profiles'",
    ),
    1,
  )

  const buyerId = "10000000-0000-4000-8000-000000000001"
  const providerUserId = "10000000-0000-4000-8000-000000000002"
  const adminId = "10000000-0000-4000-8000-000000000003"
  const onboardingUserId = "10000000-0000-4000-8000-000000000004"
  const providerId = "20000000-0000-4000-8000-000000000001"
  const serviceId = "30000000-0000-4000-8000-000000000001"
  const conversationId = "40000000-0000-4000-8000-000000000001"
  const quoteRequestId = "41000000-0000-4000-8000-000000000001"
  let orderId

  await db.query(
    "INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES ($1,'buyer@example.test',$4),($2,'provider@example.test',$5),($3,'admin@example.test','{}')",
    [buyerId, providerUserId, adminId, JSON.stringify({ role: "admin", is_admin: true }), JSON.stringify({ role: "provider" })],
  )
  await db.query("UPDATE public.profiles SET is_admin=true WHERE id=$1", [adminId])
  await db.query(
    "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,'onboarding@example.test','{\"role\":\"provider\"}')",
    [onboardingUserId],
  )
  assert.equal(await scalar("SELECT role FROM public.profiles WHERE id=$1", [buyerId]), "seeker")
  assert.equal(await scalar("SELECT is_admin FROM public.profiles WHERE id=$1", [buyerId]), false)
  assert.equal(await scalar("SELECT role FROM public.profiles WHERE id=$1", [providerUserId]), "provider")
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.update_own_profile($1,'Test Buyer','','Riyadh','Profile bio')",
    [buyerId],
  )
  await expectDenied(
    "authenticated",
    buyerId,
    "UPDATE public.profiles SET location='Direct write' WHERE id=$1",
    [buyerId],
  )
  const savedProfile = await asRole("service_role", null, () =>
    db.query("SELECT public.update_own_profile($1,'Test Buyer','  ',' Riyadh ',' Profile bio ') AS profile", [buyerId]),
  )
  assert.equal(savedProfile.rows[0].profile.full_name,"Test Buyer")
  assert.equal(savedProfile.rows[0].profile.phone,null)
  assert.equal(savedProfile.rows[0].profile.location,"Riyadh")
  assert.equal(savedProfile.rows[0].profile.bio,"Profile bio")

  const onboardingSql = `SELECT public.register_provider_profile(
    $1,'مقدم جديد','New Provider','مصمم','Designer','','',0,
    ARRAY['Figma'],ARRAY['design'],'/placeholder.svg'
  ) AS id`
  await expectDenied("authenticated", onboardingUserId, onboardingSql, [onboardingUserId])
  await expectDenied("service_role", null, onboardingSql, [buyerId])
  const onboarding = await asRole("service_role", null, () =>
    db.query(onboardingSql, [onboardingUserId]),
  )
  const repeatedOnboarding = await asRole("service_role", null, () =>
    db.query(onboardingSql, [onboardingUserId]),
  )
  assert.equal(repeatedOnboarding.rows[0].id, onboarding.rows[0].id)
  assert.equal(await scalar("SELECT count(*)::int FROM public.providers WHERE user_id=$1", [onboardingUserId]), 1)
  await expectDenied(
    "authenticated",
    adminId,
    "SELECT public.open_provider_conversation($1,$2)",
    [adminId, onboarding.rows[0].id],
  )
  const openedConversation = await asRole("service_role", null, () =>
    db.query("SELECT public.open_provider_conversation($1,$2) AS id", [adminId, onboarding.rows[0].id]),
  )
  const repeatedConversation = await asRole("service_role", null, () =>
    db.query("SELECT public.open_provider_conversation($1,$2) AS id", [adminId, onboarding.rows[0].id]),
  )
  assert.equal(repeatedConversation.rows[0].id, openedConversation.rows[0].id)
  assert.equal(
    await scalar("SELECT count(*)::int FROM public.conversations WHERE seeker_id=$1 AND provider_id=$2", [adminId, onboarding.rows[0].id]),
    1,
  )

  await db.query("UPDATE public.profiles SET avatar_url='https://old.example/avatar.webp' WHERE id=$1", [onboardingUserId])
  await db.query("UPDATE public.providers SET avatar_url='https://old.example/provider.webp' WHERE user_id=$1", [onboardingUserId])
  await expectDenied(
    "authenticated",
    onboardingUserId,
    "SELECT public.update_profile_avatar($1,$2)",
    [onboardingUserId, "https://project.example/storage/v1/object/public/avatars/new.webp"],
  )
  const avatarUpdate = await asRole("service_role", null, () =>
    db.query("SELECT public.update_profile_avatar($1,$2) AS old_urls", [
      onboardingUserId,
      "https://project.example/storage/v1/object/public/avatars/new.webp",
    ]),
  )
  assert.deepEqual(avatarUpdate.rows[0].old_urls.sort(), [
    "https://old.example/avatar.webp",
    "https://old.example/provider.webp",
  ])
  assert.equal(
    await scalar("SELECT avatar_url FROM public.profiles WHERE id=$1", [onboardingUserId]),
    "https://project.example/storage/v1/object/public/avatars/new.webp",
  )
  assert.equal(
    await scalar("SELECT avatar_url FROM public.providers WHERE user_id=$1", [onboardingUserId]),
    "https://project.example/storage/v1/object/public/avatars/new.webp",
  )

  await db.query(
    "INSERT INTO public.providers (id,user_id,name_ar,name_en,response_time,languages,portfolio_urls) VALUES ($1,$2,'مزود','Provider','Within one day',ARRAY['ar','en'],ARRAY['https://example.test'])",
    [providerId, providerUserId],
  )
  await assert.rejects(
    db.query("INSERT INTO public.providers (user_id) VALUES ($1)", [providerUserId]),
    (error) => error.code === "23505",
  )

  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.set_provider_favorite($1,$2,true)",
    [buyerId, providerId],
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_provider_favorite($1,$2,true)", [buyerId, providerId]),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_provider_favorite($1,$2,true)", [buyerId, providerId]),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_provider_favorite($1,$2,true)", [buyerId, onboarding.rows[0].id]),
  )
  assert.equal(await scalar("SELECT count(*)::int FROM public.favorites WHERE user_id=$1", [buyerId]), 2)
  await expectDenied(
    "authenticated",buyerId,
    "SELECT public.get_favorite_provider_page($1,NULL,NULL,50)",
    [buyerId],
  )
  const firstFavoritePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_favorite_provider_page($1,NULL,NULL,1) AS page",
    [buyerId],
  ))
  assert.equal(Number(firstFavoritePage.rows[0].page.total),2)
  assert.equal(firstFavoritePage.rows[0].page.favorites.length,1)
  const firstFavorite=firstFavoritePage.rows[0].page.favorites[0]
  const secondFavoritePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_favorite_provider_page($1,$2,$3,1) AS page",
    [buyerId,firstFavorite.created_at,firstFavorite.id],
  ))
  assert.equal(Number(secondFavoritePage.rows[0].page.total),2)
  assert.equal(secondFavoritePage.rows[0].page.favorites.length,1)
  assert.notEqual(secondFavoritePage.rows[0].page.favorites[0].id,firstFavorite.id)
  const unrelatedFavoritePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_favorite_provider_page($1,NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(unrelatedFavoritePage.rows[0].page.total),0)
  assert.deepEqual(unrelatedFavoritePage.rows[0].page.favorites,[])
  await expectDenied(
    "service_role",
    null,
    "SELECT public.set_provider_favorite($1,$2,true)",
    [providerUserId, providerId],
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_provider_favorite($1,$2,false)", [buyerId, providerId]),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_provider_favorite($1,$2,false)", [buyerId, onboarding.rows[0].id]),
  )
  assert.equal(await scalar("SELECT count(*)::int FROM public.favorites WHERE user_id=$1", [buyerId]), 0)

  await db.query(
    "INSERT INTO public.services (id,provider_id,name_ar,name_en,category,price,price_type,image_urls) VALUES ($1,$2,'خدمة','Service','design',100,'fixed',ARRAY['https://example.test/service.webp'])",
    [serviceId, providerId],
  )
  await assert.rejects(
    db.query(
      "INSERT INTO public.services (provider_id,name_ar,name_en,category,price,price_type) VALUES ($1,'أ','B','design',100,'unknown')",
      [providerId],
    ),
    (error) => error.code === "23514",
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.submit_service_for_review($1,$2)", [providerUserId, serviceId]),
  )
  assert.equal(await scalar("SELECT moderation_status FROM public.services WHERE id=$1", [serviceId]), "pending_review")
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_service($1,$2,'approved','Initial approval')", [adminId, serviceId]),
  )
  assert.equal(await scalar("SELECT is_active FROM public.services WHERE id=$1", [serviceId]), true)
  const referencedImagePath=`${providerId}/${serviceId}/referenced.webp`
  await db.query(
    "UPDATE public.services SET image_urls=ARRAY['https://example.test/storage/v1/object/public/service-images/'||$2] WHERE id=$1",
    [serviceId,referencedImagePath],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.queue_service_image_cleanup($1,$2,$3,ARRAY[$4])",
      [providerUserId,providerId,serviceId,referencedImagePath],
    )),
    (error)=>error.code==="P0001",
  )
  await db.query(
    "UPDATE public.services SET image_urls=ARRAY['https://example.test/service.webp'] WHERE id=$1",
    [serviceId],
  )
  const orphanImagePath=`${providerId}/${serviceId}/orphan.webp`
  await expectDenied(
    "authenticated",providerUserId,
    "SELECT public.queue_service_image_cleanup($1,$2,$3,ARRAY[$4])",
    [providerUserId,providerId,serviceId,orphanImagePath],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.queue_service_image_cleanup($1,$2,$3,ARRAY[$4])",
      [buyerId,providerId,serviceId,orphanImagePath],
    )),
    (error)=>error.code==="42501",
  )
  assert.equal(await asRole("service_role",null,()=>scalar(
    "SELECT public.queue_service_image_cleanup($1,$2,$3,ARRAY[$4])",
    [providerUserId,providerId,serviceId,orphanImagePath],
  )),1)
  const cleanupPage=await asRole("service_role",null,()=>db.query(
    "SELECT * FROM public.get_service_image_cleanup_page($1,100)",
    [providerUserId],
  ))
  assert.equal(cleanupPage.rows.length,1)
  assert.equal(cleanupPage.rows[0].storage_path,orphanImagePath)
  assert.equal(Number(cleanupPage.rows[0].total_count),1)
  await assert.rejects(
    db.query(
      "UPDATE public.services SET image_urls=ARRAY['https://example.test/storage/v1/object/public/service-images/'||$2] WHERE id=$1",
      [serviceId,orphanImagePath],
    ),
    (error)=>error.code==="P0001",
  )
  await asRole("service_role",null,()=>db.query(
    "SELECT public.record_service_image_cleanup_result($1,ARRAY[$2::uuid],false,'Storage unavailable')",
    [providerUserId,cleanupPage.rows[0].id],
  ))
  assert.equal(await scalar("SELECT attempt_count FROM public.service_image_cleanup_jobs WHERE id=$1",[cleanupPage.rows[0].id]),1)
  await asRole("service_role",null,()=>db.query(
    "SELECT public.record_service_image_cleanup_result($1,ARRAY[$2::uuid],true,NULL)",
    [providerUserId,cleanupPage.rows[0].id],
  ))
  assert.equal(await scalar("SELECT status FROM public.service_image_cleanup_jobs WHERE id=$1",[cleanupPage.rows[0].id]),"completed")
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT * FROM public.search_service_catalog(NULL,NULL,'newest',0,12)",
  )
  const catalog = await asRole("service_role", null, () =>
    db.query("SELECT id,name_en,total_count FROM public.search_service_catalog('Service','design','newest',0,12)"),
  )
  assert.equal(catalog.rows.length, 1)
  assert.equal(catalog.rows[0].id, serviceId)
  assert.equal(Number(catalog.rows[0].total_count), 1)
  const emptyCatalog = await asRole("service_role", null, () =>
    db.query("SELECT id FROM public.search_service_catalog('missing',NULL,'newest',0,12)"),
  )
  assert.equal(emptyCatalog.rows.length, 0)

  await db.query(
    "INSERT INTO public.conversations (id,seeker_id,provider_id) VALUES ($1,$2,$3)",
    [conversationId, buyerId, providerId],
  )
  await assert.rejects(
    db.query("INSERT INTO public.conversations (seeker_id,provider_id) VALUES ($1,$2)", [buyerId, providerId]),
    (error) => error.code === "23505",
  )

  const messageRequestId = "70000000-0000-4000-8000-000000000001"
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.send_conversation_message($1,$2,$3,'hello')",
    [buyerId, conversationId, messageRequestId],
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_conversation_preference($1,$2,'archived',true)", [providerUserId, conversationId]),
  )
  const firstMessage = await asRole("service_role", null, () =>
    db.query("SELECT public.send_conversation_message($1,$2,$3,'hello') AS message", [buyerId, conversationId, messageRequestId]),
  )
  const repeatedMessage = await asRole("service_role", null, () =>
    db.query("SELECT public.send_conversation_message($1,$2,$3,'hello') AS message", [buyerId, conversationId, messageRequestId]),
  )
  assert.equal(repeatedMessage.rows[0].message.id, firstMessage.rows[0].message.id)
  assert.equal(await scalar("SELECT count(*)::int FROM public.messages WHERE client_request_id=$1", [messageRequestId]), 1)
  assert.equal(await scalar("SELECT is_archived_by_provider FROM public.conversations WHERE id=$1", [conversationId]), false)
  assert.equal(
    await asRole("service_role", null, async () =>
      scalar("SELECT unread_count::int FROM public.get_conversation_unread_counts($1) WHERE conversation_id=$2", [providerUserId, conversationId]),
    ),
    1,
  )
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.send_conversation_message($1,$2,$3,'different')", [buyerId, conversationId, messageRequestId]),
    ),
    (error) => error.code === "P0001",
  )
  const readResult = await asRole("service_role", null, () =>
    db.query("SELECT public.mark_conversation_read($1,$2) AS count", [providerUserId, conversationId]),
  )
  assert.equal(readResult.rows[0].count, 1)
  assert.equal(await scalar("SELECT is_read FROM public.messages WHERE client_request_id=$1", [messageRequestId]), true)
  assert.equal(
    await asRole("service_role", null, async () =>
      scalar("SELECT unread_count::int FROM public.get_conversation_unread_counts($1) WHERE conversation_id=$2", [providerUserId, conversationId]),
    ),
    0,
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_conversation_preference($1,$2,'archived',true)", [buyerId, conversationId]),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.send_conversation_message($1,$2,$3,'reply')", [
      providerUserId,
      conversationId,
      "70000000-0000-4000-8000-000000000002",
    ]),
  )
  await expectDenied(
    "authenticated",
    providerUserId,
    "SELECT public.create_quoted_order($1,$2,$3,'عرض','Quote','','',125,$4)",
    [conversationId,providerUserId,quoteRequestId,serviceId],
  )
  await expectDenied(
    "service_role",
    null,
    "SELECT public.send_service_card_message($1,$2,$3,$4)",
    [buyerId, conversationId, "70000000-0000-4000-8000-000000000003", serviceId],
  )
  const serviceCardMessage = await asRole("service_role", null, () =>
    db.query("SELECT public.send_service_card_message($1,$2,$3,$4) AS message", [
      providerUserId,
      conversationId,
      "70000000-0000-4000-8000-000000000003",
      serviceId,
    ]),
  )
  const serviceCard = JSON.parse(serviceCardMessage.rows[0].message.content)
  assert.equal(serviceCard.__type, "service_card")
  assert.equal(serviceCard.id, serviceId)
  assert.equal(Number(serviceCard.price), 100)
  assert.equal(await scalar("SELECT is_archived_by_seeker FROM public.conversations WHERE id=$1", [conversationId]), false)
  assert.equal(
    await asRole("service_role", null, async () =>
      scalar("SELECT unread_count::int FROM public.get_conversation_unread_counts($1) WHERE conversation_id=$2", [buyerId, conversationId]),
    ),
    2,
  )
  const newestPage = await asRole("service_role", null, () =>
    db.query("SELECT id,created_at FROM public.get_conversation_messages($1,$2,NULL,NULL,1)", [buyerId, conversationId]),
  )
  assert.equal(newestPage.rows.length, 1)
  const olderPage = await asRole("service_role", null, () =>
    db.query("SELECT id FROM public.get_conversation_messages($1,$2,$3,$4,1)", [
      buyerId,
      conversationId,
      newestPage.rows[0].created_at,
      newestPage.rows[0].id,
    ]),
  )
  assert.equal(olderPage.rows.length, 1)
  assert.notEqual(olderPage.rows[0].id, newestPage.rows[0].id)
  const cleared = await asRole("service_role", null, () =>
    db.query("SELECT public.set_conversation_preference($1,$2,'cleared',NULL) AS cleared_at", [buyerId, conversationId]),
  )
  assert.ok(cleared.rows[0].cleared_at)
  assert.equal(
    await asRole("service_role", null, async () =>
      scalar("SELECT count(*)::int FROM public.get_conversation_messages($1,$2,NULL,NULL,50)", [buyerId, conversationId]),
    ),
    0,
  )
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT * FROM public.get_conversation_page($1,false,NULL,NULL,NULL,NULL,50)",
    [buyerId],
  )
  const buyerConversationPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_conversation_page($1,false,NULL,NULL,NULL,NULL,50)", [buyerId]),
  )
  assert.equal(buyerConversationPage.rows.length, 1)
  assert.equal(Number(buyerConversationPage.rows[0].total_count), 1)
  assert.equal(buyerConversationPage.rows[0].id, conversationId)
  assert.equal(buyerConversationPage.rows[0].other_party_name_en, "Provider")
  assert.equal(Number(buyerConversationPage.rows[0].unread_count), 0)
  const searchedConversationPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_conversation_page($1,false,'مزود',NULL,NULL,NULL,50)", [buyerId]),
  )
  assert.equal(searchedConversationPage.rows.length, 1)
  const secondBuyerConversation = await asRole("service_role", null, () =>
    db.query("SELECT public.open_provider_conversation($1,$2) AS id", [buyerId,onboarding.rows[0].id]),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_conversation_preference($1,$2,'pinned',true)", [buyerId,secondBuyerConversation.rows[0].id]),
  )
  const firstConversationPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_conversation_page($1,false,NULL,NULL,NULL,NULL,1)", [buyerId]),
  )
  assert.equal(firstConversationPage.rows.length, 1)
  assert.equal(Number(firstConversationPage.rows[0].total_count), 2)
  assert.equal(firstConversationPage.rows[0].id, secondBuyerConversation.rows[0].id)
  assert.equal(firstConversationPage.rows[0].is_pinned, true)
  const secondConversationPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_conversation_page($1,false,NULL,$2,$3,$4,1)", [
      buyerId,
      firstConversationPage.rows[0].is_pinned,
      firstConversationPage.rows[0].last_message_at,
      firstConversationPage.rows[0].id,
    ]),
  )
  assert.equal(secondConversationPage.rows.length, 1)
  assert.equal(secondConversationPage.rows[0].id, conversationId)
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_conversation_preference($1,$2,'archived',true)", [buyerId,secondBuyerConversation.rows[0].id]),
  )
  const archivedConversationPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_conversation_page($1,true,NULL,NULL,NULL,NULL,50)", [buyerId]),
  )
  assert.equal(archivedConversationPage.rows.length, 1)
  assert.equal(archivedConversationPage.rows[0].id, secondBuyerConversation.rows[0].id)
  await db.query("DELETE FROM public.conversations WHERE id=$1", [secondBuyerConversation.rows[0].id])

  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.create_direct_order($1,$2)",
    [serviceId, buyerId],
  )
  const directOrder = await asRole("service_role", null, () =>
    db.query("SELECT public.create_direct_order($1,$2) AS id", [serviceId, buyerId]),
  )
  orderId = directOrder.rows[0].id
  const repeatedDirectOrder = await asRole("service_role", null, () =>
    db.query("SELECT public.create_direct_order($1,$2) AS id", [serviceId, buyerId]),
  )
  assert.equal(repeatedDirectOrder.rows[0].id, orderId)
  assert.equal(await scalar("SELECT amount::float FROM public.orders WHERE id=$1", [orderId]), 100)
  assert.equal(await scalar("SELECT platform_fee::float FROM public.orders WHERE id=$1", [orderId]), 15)
  const directSnapshots=await db.query(
    "SELECT service_snapshot,pricing_snapshot FROM public.orders WHERE id=$1",
    [orderId],
  )
  assert.equal(directSnapshots.rows[0].service_snapshot.source,"service_catalog")
  assert.equal(directSnapshots.rows[0].service_snapshot.name_en,"Service")
  assert.equal(directSnapshots.rows[0].service_snapshot.price_type,"fixed")
  assert.deepEqual(directSnapshots.rows[0].service_snapshot.features,[])
  assert.equal(directSnapshots.rows[0].pricing_snapshot.source,"service_catalog")
  assert.equal(directSnapshots.rows[0].pricing_snapshot.rule_version,"legacy-commission-15-v1")
  assert.equal(directSnapshots.rows[0].pricing_snapshot.gross_amount,100)
  assert.equal(directSnapshots.rows[0].pricing_snapshot.platform_fee,15)
  assert.equal(directSnapshots.rows[0].pricing_snapshot.provider_amount,85)
  assert.equal(directSnapshots.rows[0].pricing_snapshot.tax_amount,null)
  await assert.rejects(
    db.query(
      `UPDATE public.orders
       SET service_snapshot=jsonb_set(service_snapshot,'{name_en}','"Changed"'::jsonb)
       WHERE id=$1`,
      [orderId],
    ),
    (error)=>error.code==="23514",
  )
  await assert.rejects(
    db.query(
      `INSERT INTO public.orders(
        conversation_id,seeker_id,provider_id,service_id,service_name_ar,service_name_en,
        amount,platform_fee,provider_amount,status
      ) VALUES($1,$2,$3,$4,'طلب','Duplicate direct order',100,15,85,'pending')`,
      [conversationId,buyerId,providerId,serviceId],
    ),
    (error) => error.code === "23505",
  )

  await expectDenied(
    "service_role",
    null,
    "SELECT public.create_quoted_order($1,$2,$3,'عرض','Quote','','',125,$4)",
    [conversationId, buyerId,quoteRequestId,serviceId],
  )
  const quote = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.create_quoted_order($1,$2,$3,'عرض','Quote','','',125,$4) AS id",
      [conversationId, providerUserId,quoteRequestId,serviceId],
    ),
  )
  const repeatedQuote = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.create_quoted_order($1,$2,$3,'عرض','Quote','','',125,$4) AS id",
      [conversationId,providerUserId,quoteRequestId,serviceId],
    ),
  )
  assert.equal(repeatedQuote.rows[0].id,quote.rows[0].id)
  const quoteSnapshots=await db.query(
    "SELECT service_snapshot,pricing_snapshot FROM public.orders WHERE id=$1",
    [quote.rows[0].id],
  )
  assert.equal(quoteSnapshots.rows[0].service_snapshot.source,"provider_quote")
  assert.equal(quoteSnapshots.rows[0].service_snapshot.name_en,"Quote")
  assert.equal(quoteSnapshots.rows[0].service_snapshot.catalog.name_en,"Service")
  assert.equal(quoteSnapshots.rows[0].pricing_snapshot.source,"provider_quote")
  assert.equal(quoteSnapshots.rows[0].pricing_snapshot.gross_amount,125)
  assert.equal(quoteSnapshots.rows[0].pricing_snapshot.platform_fee,18.75)
  assert.equal(quoteSnapshots.rows[0].pricing_snapshot.provider_amount,106.25)
  assert.equal(quoteSnapshots.rows[0].pricing_snapshot.unit_price,null)
  assert.equal(quoteSnapshots.rows[0].pricing_snapshot.quantity,null)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query(
        "SELECT public.create_quoted_order($1,$2,$3,'عرض','Quote','','',126,$4)",
        [conversationId,providerUserId,quoteRequestId,serviceId],
      ),
    ),
    (error) => error.code === "P0001",
  )
  assert.equal(await scalar("SELECT amount::float FROM public.orders WHERE id=$1", [quote.rows[0].id]), 125)
  await asRole("service_role", null, () =>
    db.query("SELECT public.cancel_pending_order($1,$2)", [quote.rows[0].id, providerUserId]),
  )
  assert.equal(await scalar("SELECT status FROM public.orders WHERE id=$1", [quote.rows[0].id]), "cancelled")
  const staleAttempt=await db.query(
    "INSERT INTO public.payment_attempts(order_id,status,external_status,external_charge_id,amount,currency) VALUES($1,'unknown','UNKNOWN','chg_stale_queue',125,'SAR') RETURNING id",
    [quote.rows[0].id],
  )
  await expectDenied(
    "authenticated",
    adminId,
    "SELECT * FROM public.get_admin_payment_reconciliation_page($1,NULL,NULL,10)",
    [adminId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query("SELECT * FROM public.get_admin_payment_reconciliation_page($1,NULL,NULL,10)",[buyerId])),
    (error)=>error.code==="42501",
  )
  const paymentReconciliationPage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_admin_payment_reconciliation_page($1,NULL,NULL,10)",[adminId]),
  )
  assert.equal(paymentReconciliationPage.rows.length,1)
  assert.equal(Number(paymentReconciliationPage.rows[0].total_count),1)
  assert.equal(paymentReconciliationPage.rows[0].external_charge_id,"chg_stale_queue")
  const reconciliationAttempt=await asRole("service_role",null,()=>
    db.query("SELECT public.get_payment_attempt_for_reconciliation($1,$2) AS attempt",[adminId,staleAttempt.rows[0].id]),
  )
  assert.equal(reconciliationAttempt.rows[0].attempt.order_id,quote.rows[0].id)
  await db.query("DELETE FROM public.payment_attempts WHERE id=$1",[staleAttempt.rows[0].id])

  await assert.rejects(
    db.query(
      `INSERT INTO public.orders (
        conversation_id,seeker_id,provider_id,service_name_ar,service_name_en,
        amount,platform_fee,provider_amount
      ) VALUES ($1,$2,$3,'طلب','Broken order',100,15,80)`,
      [conversationId, buyerId, providerId],
    ),
    (error) => error.code === "23514",
  )

  const tapMigration = await readFile(
    path.join(migrationsDirectory, "20260424000000_tap_payment_fields.sql"),
    "utf8",
  )
  await db.exec(`BEGIN;\n${tapMigration}\nCOMMIT;`)
  assert.equal(await scalar("SELECT amount::float FROM public.orders WHERE id=$1", [orderId]), 100)

  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.begin_payment_attempt($1,$2)",
    [orderId,buyerId],
  )
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.begin_payment_attempt($1,$2)", [orderId,providerUserId]),
    ),
    (error) => error.code === "P0001",
  )
  const firstCheckout = await asRole("service_role", null, () =>
    db.query("SELECT public.begin_payment_attempt($1,$2) AS attempt", [orderId,buyerId]),
  )
  assert.equal(firstCheckout.rows[0].attempt.is_new, true)
  const paymentAttemptId = firstCheckout.rows[0].attempt.id
  const repeatedCheckout = await asRole("service_role", null, () =>
    db.query("SELECT public.begin_payment_attempt($1,$2) AS attempt", [orderId,buyerId]),
  )
  assert.equal(repeatedCheckout.rows[0].attempt.is_new, false)
  assert.equal(repeatedCheckout.rows[0].attempt.id, paymentAttemptId)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.cancel_pending_order($1,$2)", [orderId, buyerId]),
    ),
    (error) => error.code === "P0001",
  )
  await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_tap_charge_attempt($1,$2,'chg_test_1','AUTHORIZED','txn_1','https://checkout.test',100,'SAR')",
      [paymentAttemptId,buyerId],
    ),
  )
  const mismatchEvent = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_payment_event('webhook','chg_test_1:CAPTURED:bad','chg_test_1','CAPTURED',$1,$2,99,'SAR',true,'{\"transaction\":\"txn_1\"}') AS id",
      [orderId,paymentAttemptId],
    ),
  )
  const quarantined = await asRole("service_role", null, () =>
    db.query("SELECT public.process_payment_event($1) AS result", [mismatchEvent.rows[0].id]),
  )
  assert.equal(quarantined.rows[0].result.processing_status, "quarantined")
  assert.equal(await scalar("SELECT status FROM public.orders WHERE id=$1", [orderId]), "pending")

  const capturedEvent = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_payment_event('webhook','chg_test_1:CAPTURED:ok','chg_test_1','CAPTURED',$1,$2,100,'SAR',true,'{\"transaction\":\"txn_1\"}') AS id",
      [orderId,paymentAttemptId],
    ),
  )
  const repeatedCapturedEvent = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_payment_event('webhook','chg_test_1:CAPTURED:ok','chg_test_1','CAPTURED',$1,$2,100,'SAR',true,'{\"transaction\":\"txn_1\"}') AS id",
      [orderId,paymentAttemptId],
    ),
  )
  assert.equal(repeatedCapturedEvent.rows[0].id, capturedEvent.rows[0].id)
  const settled = await asRole("service_role", null, () =>
    db.query("SELECT public.process_payment_event($1) AS result", [capturedEvent.rows[0].id]),
  )
  assert.equal(settled.rows[0].result.order_status, "paid")
  const repeatedSettlement = await asRole("service_role", null, () =>
    db.query("SELECT public.process_payment_event($1) AS result", [capturedEvent.rows[0].id]),
  )
  assert.equal(repeatedSettlement.rows[0].result.processing_status, "processed")
  assert.equal(await scalar("SELECT count(*)::int FROM public.payment_events WHERE event_key='chg_test_1:CAPTURED:ok'"), 1)

  const staleEvent = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_payment_event('webhook','chg_test_1:FAILED:late','chg_test_1','FAILED',$1,$2,100,'SAR',true,'{}') AS id",
      [orderId,paymentAttemptId],
    ),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.process_payment_event($1)", [staleEvent.rows[0].id]),
  )
  assert.equal(await scalar("SELECT status FROM public.payment_attempts WHERE id=$1", [paymentAttemptId]), "captured")
  const timeoutQuoteRequestId="41000000-0000-4000-8000-000000000099"
  const timeoutOrder=await asRole("service_role",null,()=>db.query(
    "SELECT public.create_quoted_order($1,$2,$3,'اختبار مهلة','Timeout test','','',40,NULL) AS id",
    [conversationId,providerUserId,timeoutQuoteRequestId],
  ))
  const timeoutOrderId=timeoutOrder.rows[0].id
  const timeoutCheckout=await asRole("service_role",null,()=>db.query(
    "SELECT public.begin_payment_attempt($1,$2) AS attempt",[timeoutOrderId,buyerId],
  ))
  const timeoutAttemptId=timeoutCheckout.rows[0].attempt.id
  const recoveryCharge=JSON.stringify({
    id:"chg_timeout_1",status:"IN_PROGRESS",amount:40,currency:"SAR",
    metadata:{order_id:timeoutOrderId,payment_attempt_id:timeoutAttemptId},
    transaction:{created:"1788890400000"},reference:{transaction:"txn_timeout"},
  })
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.recover_payment_attempt_charge($1,$2,$3::jsonb,'TapOS incident recovery')",
    [adminId,timeoutAttemptId,recoveryCharge],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.recover_payment_attempt_charge($1,$2,$3::jsonb,'TapOS incident recovery')",
      [adminId,timeoutAttemptId,JSON.stringify({...JSON.parse(recoveryCharge),amount:41})],
    )),
    (error)=>error.code==="P0001",
  )
  const recoveredAttempt=await asRole("service_role",null,()=>db.query(
    "SELECT public.recover_payment_attempt_charge($1,$2,$3::jsonb,'TapOS incident recovery') AS result",
    [adminId,timeoutAttemptId,recoveryCharge],
  ))
  assert.equal(recoveredAttempt.rows[0].result.processing_status,"processed")
  assert.equal(recoveredAttempt.rows[0].result.order_status,"pending")
  assert.equal(await scalar("SELECT count(*)::int FROM public.admin_audit_log WHERE action='payment_attempt_recovery' AND target_id=$1",[timeoutAttemptId]),1)
  assert.equal(await scalar("SELECT status FROM public.payment_attempts WHERE id=$1",[timeoutAttemptId]),"pending")
  const timeoutEvent=await asRole("service_role",null,()=>db.query(
    "SELECT public.record_payment_event('webhook','chg_timeout_1:TIMEDOUT','chg_timeout_1','TIMEDOUT',$1,$2,40,'SAR',true,'{}') AS id",
    [timeoutOrderId,timeoutAttemptId],
  ))
  await asRole("service_role",null,()=>db.query(
    "SELECT public.process_payment_event($1)",[timeoutEvent.rows[0].id],
  ))
  assert.equal(await scalar("SELECT status FROM public.payment_attempts WHERE id=$1",[timeoutAttemptId]),"expired")
  const timeoutRetry=await asRole("service_role",null,()=>db.query(
    "SELECT public.begin_payment_attempt($1,$2) AS attempt",[timeoutOrderId,buyerId],
  ))
  assert.equal(timeoutRetry.rows[0].attempt.is_new,true)
  assert.notEqual(timeoutRetry.rows[0].attempt.id,timeoutAttemptId)
  const lateTimeoutCapture=await asRole("service_role",null,()=>db.query(
    "SELECT public.record_payment_event('webhook','chg_timeout_1:CAPTURED:late','chg_timeout_1','CAPTURED',$1,$2,40,'SAR',true,'{}') AS id",
    [timeoutOrderId,timeoutAttemptId],
  ))
  const lateTimeoutResult=await asRole("service_role",null,()=>db.query(
    "SELECT public.process_payment_event($1) AS result",[lateTimeoutCapture.rows[0].id],
  ))
  assert.equal(lateTimeoutResult.rows[0].result.order_status,"paid")
  assert.equal(await scalar("SELECT status FROM public.payment_attempts WHERE id=$1",[timeoutAttemptId]),"captured")
  await db.query("DELETE FROM public.admin_audit_log WHERE action='payment_attempt_recovery' AND target_id=$1",[timeoutAttemptId])
  await db.query("DELETE FROM public.payment_events WHERE linked_order_id=$1",[timeoutOrderId])
  await db.query("DELETE FROM public.payment_attempts WHERE order_id=$1",[timeoutOrderId])
  await db.query("DELETE FROM public.orders WHERE id=$1",[timeoutOrderId])
  const relinkEvent=await asRole("service_role",null,()=>db.query(
    "SELECT public.record_payment_event('webhook','chg_test_1:CAPTURED:relink','chg_test_1','CAPTURED',$1,$2,100,'SAR',true,'{\"transaction\":\"txn_1\"}') AS id",
    ["10000000-0000-4000-8000-000000000099",paymentAttemptId],
  ))
  const quarantinedRelink=await asRole("service_role",null,()=>
    db.query("SELECT public.process_payment_event($1) AS result",[relinkEvent.rows[0].id]),
  )
  assert.equal(quarantinedRelink.rows[0].result.processing_status,"quarantined")
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.relink_payment_event($1,$2,$3,$4,'Verified against Tap')",
    [adminId,relinkEvent.rows[0].id,orderId,paymentAttemptId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.relink_payment_event($1,$2,$3,$4,'Wrong order')",
      [adminId,relinkEvent.rows[0].id,quote.rows[0].id,paymentAttemptId],
    )),
    (error)=>error.code==="P0001",
  )
  const relinkResult=await asRole("service_role",null,()=>db.query(
    "SELECT public.relink_payment_event($1,$2,$3,$4,'Verified against Tap dashboard') AS result",
    [adminId,relinkEvent.rows[0].id,orderId,paymentAttemptId],
  ))
  assert.equal(relinkResult.rows[0].result.processing_status,"processed")
  assert.equal(await scalar("SELECT count(*)::int FROM public.admin_audit_log WHERE action='payment_event_relink' AND target_id=$1",[relinkEvent.rows[0].id]),1)
  const deliveryRequestId = "80000000-0000-4000-8000-000000000001"
  const deliveryFilePath = `${orderId}/${providerUserId}/${deliveryRequestId}-0.pdf`
  const deliveryFiles = JSON.stringify([{path:deliveryFilePath,name:"final.pdf",mime:"application/pdf",size:1024}])
  assert.deepEqual(
    await db.query("SELECT public,file_size_limit FROM storage.buckets WHERE id='order-deliveries'").then((result)=>result.rows[0]),
    { public:false,file_size_limit:26214400 },
  )
  await asRole("authenticated",providerUserId,()=>
    db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('order-deliveries',$1)",[deliveryFilePath]),
  )
  const unreferencedDeliveryPath=`${orderId}/${providerUserId}/${deliveryRequestId}-1.txt`
  await asRole("authenticated",providerUserId,()=>
    db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('order-deliveries',$1)",[unreferencedDeliveryPath]),
  )
  const unreferencedDelete=await asRole("authenticated",providerUserId,()=>
    db.query("DELETE FROM storage.objects WHERE bucket_id='order-deliveries' AND name=$1 RETURNING name",[unreferencedDeliveryPath]),
  )
  assert.equal(unreferencedDelete.rows.length,1)
  await expectDenied(
    "authenticated",
    buyerId,
    "INSERT INTO storage.objects(bucket_id,name) VALUES('order-deliveries',$1)",
    [`${orderId}/${buyerId}/${deliveryRequestId}-0.pdf`],
  )
  assert.equal(
    await asRole("authenticated",buyerId,async()=>scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='order-deliveries' AND name=$1",[deliveryFilePath])),
    1,
  )
  assert.equal(
    await asRole("authenticated",onboardingUserId,async()=>scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='order-deliveries' AND name=$1",[deliveryFilePath])),
    0,
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.submit_order_delivery($1,$2,$3,'Missing file',ARRAY[]::text[],$4::jsonb)",
      [orderId,providerUserId,"80000000-0000-4000-8000-000000000099",JSON.stringify([{path:`${orderId}/${providerUserId}/80000000-0000-4000-8000-000000000099-0.pdf`,name:"missing.pdf",mime:"application/pdf",size:100}])],
    )),
    (error)=>error.code==="P0001",
  )
  await expectDenied(
    "authenticated",
    providerUserId,
    "SELECT public.submit_order_delivery($1,$2,$3,'Final delivery',ARRAY['https://files.example.test/v1'],$4::jsonb)",
    [orderId,providerUserId,deliveryRequestId,deliveryFiles],
  )
  const delivered = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.submit_order_delivery($1,$2,$3,'Final delivery',ARRAY['https://files.example.test/v1'],$4::jsonb) AS delivery",
      [orderId,providerUserId,deliveryRequestId,deliveryFiles],
    ),
  )
  const repeatedDelivery = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.submit_order_delivery($1,$2,$3,'Final delivery',ARRAY['https://files.example.test/v1'],$4::jsonb) AS delivery",
      [orderId,providerUserId,deliveryRequestId,deliveryFiles],
    ),
  )
  assert.equal(repeatedDelivery.rows[0].delivery.id, delivered.rows[0].delivery.id)
  assert.equal(repeatedDelivery.rows[0].delivery.files[0].name,"final.pdf")
  assert.equal((await db.query("SELECT latest_delivery_files FROM public.orders WHERE id=$1",[orderId])).rows[0].latest_delivery_files[0].path,deliveryFilePath)
  const referencedFileDelete=await asRole("authenticated",providerUserId,()=>
    db.query("DELETE FROM storage.objects WHERE bucket_id='order-deliveries' AND name=$1 RETURNING name",[deliveryFilePath]),
  )
  assert.equal(referencedFileDelete.rows.length,0)
  assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='order-deliveries' AND name=$1",[deliveryFilePath]),1)
  await expectDenied(
    "authenticated",
    providerUserId,
    "SELECT public.get_order_delivery_request($1,$2,$3)",
    [providerUserId,orderId,deliveryRequestId],
  )
  const recoveredDelivery=await asRole("service_role",null,()=>
    db.query("SELECT public.get_order_delivery_request($1,$2,$3) AS delivery",[providerUserId,orderId,deliveryRequestId]),
  )
  assert.equal(recoveredDelivery.rows[0].delivery.id,delivered.rows[0].delivery.id)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query(
        "SELECT public.submit_order_delivery($1,$2,$3,'Different delivery',ARRAY['https://files.example.test/v1'])",
        [orderId,providerUserId,"80000000-0000-4000-8000-000000000001"],
      ),
    ),
    (error) => error.code === "P0001",
  )
  assert.equal(await scalar("SELECT status FROM public.orders WHERE id=$1", [orderId]), "awaiting_confirmation")
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.request_order_revision($1,$2,'Please revise')", [orderId,providerUserId]),
    ),
    (error) => error.code === "P0001",
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.request_order_revision($1,$2,'Please update the source file')", [orderId,buyerId]),
  )
  assert.equal(await scalar("SELECT status FROM public.orders WHERE id=$1", [orderId]), "revision_requested")
  assert.equal(
    await scalar("SELECT status FROM public.order_deliveries WHERE id=$1", [delivered.rows[0].delivery.id]),
    "revision_requested",
  )
  const redelivered = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.submit_order_delivery($1,$2,$3,'Updated final delivery',ARRAY['https://files.example.test/v2']) AS delivery",
      [orderId,providerUserId,"80000000-0000-4000-8000-000000000002"],
    ),
  )
  assert.equal(redelivered.rows[0].delivery.version, 2)
  assert.equal(await scalar("SELECT delivery_version FROM public.orders WHERE id=$1", [orderId]), 2)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.confirm_order($1,$2)", [orderId, providerUserId]),
    ),
    (error) => error.code === "P0001",
  )
  const confirmed = await asRole("service_role", null, () =>
    db.query("SELECT public.confirm_order($1,$2) AS status", [orderId, buyerId]),
  )
  assert.equal(confirmed.rows[0].status, "completed")
  await asRole("service_role", null, () =>
    db.query("SELECT public.confirm_order($1,$2)", [orderId, buyerId]),
  )
  assert.equal(await scalar("SELECT count(*)::int FROM public.service_history WHERE order_id=$1", [orderId]), 1)
  assert.equal(await scalar("SELECT completed_projects FROM public.providers WHERE id=$1", [providerId]), 1)
  assert.equal(await scalar("SELECT count(*)::int FROM public.order_deliveries WHERE order_id=$1", [orderId]), 2)
  assert.equal(await scalar("SELECT status FROM public.order_deliveries WHERE id=$1", [redelivered.rows[0].delivery.id]), "accepted")
  assert.equal(
    await asRole("authenticated", buyerId, async () =>
      scalar("SELECT count(*)::int FROM public.order_deliveries WHERE order_id=$1", [orderId]),
    ),
    2,
  )
  assert.equal(
    await asRole("authenticated", "10000000-0000-4000-8000-000000000099", async () =>
      scalar("SELECT count(*)::int FROM public.order_deliveries WHERE order_id=$1", [orderId]),
    ),
    0,
  )
  const earnedBalance = await asRole("service_role", null, () =>
    db.query("SELECT public.get_provider_balance($1,$2) AS balance", [providerId,providerUserId]),
  )
  assert.equal(Number(earnedBalance.rows[0].balance.available), 85)
  assert.equal(Number(earnedBalance.rows[0].balance.reserved), 0)
  const lateSettlement = await asRole("service_role", null, () =>
    db.query("SELECT public.process_payment_event($1) AS result", [capturedEvent.rows[0].id]),
  )
  assert.equal(lateSettlement.rows[0].result.processing_status, "processed")

  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.save_order_review($1,$2,5,'Great')",
    [buyerId, orderId],
  )
  await expectDenied(
    "service_role",
    null,
    "SELECT public.save_order_review($1,$2,5,'Great')",
    [providerUserId, orderId],
  )
  const savedReview = await asRole("service_role", null, () =>
    db.query("SELECT public.save_order_review($1,$2,5,'Great') AS id", [buyerId, orderId]),
  )
  const updatedReview = await asRole("service_role", null, () =>
    db.query("SELECT public.save_order_review($1,$2,2,'Updated') AS id", [buyerId, orderId]),
  )
  assert.equal(updatedReview.rows[0].id, savedReview.rows[0].id)
  assert.equal(await scalar("SELECT count(*)::int FROM public.reviews WHERE order_id=$1", [orderId]), 1)

  for (let index = 0; index < 10; index += 1) {
    const extraOrder = await db.query(
      `INSERT INTO public.orders(
        conversation_id,seeker_id,provider_id,service_id,service_name_ar,service_name_en,
        amount,platform_fee,provider_amount,status
      ) VALUES($1,$2,$3,$4,'طلب','Review order',100,100,0,'completed') RETURNING id`,
      [conversationId,buyerId,providerId,serviceId],
    )
    await asRole("service_role", null, () =>
      db.query("SELECT public.save_order_review($1,$2,$3,$4)", [
        buyerId,
        extraOrder.rows[0].id,
        index % 5 + 1,
        `Review ${index}`,
      ]),
    )
  }
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT * FROM public.get_service_review_page($1,NULL,NULL,10)",
    [serviceId],
  )
  const reviewPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_service_review_page($1,NULL,NULL,10)", [serviceId]),
  )
  assert.equal(reviewPage.rows.length, 10)
  assert.equal(Number(reviewPage.rows[0].total_count), 11)
  assert.equal(
    ["five_count","four_count","three_count","two_count","one_count"]
      .reduce((sum,key) => sum + Number(reviewPage.rows[0][key]),0),
    11,
  )
  const oldestReview = reviewPage.rows.at(-1)
  const secondReviewPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_service_review_page($1,$2,$3,10)", [
      serviceId,oldestReview.created_at,oldestReview.id,
    ]),
  )
  assert.equal(secondReviewPage.rows.length, 1)
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT * FROM public.get_customer_order_page($1,0,5)",
    [buyerId],
  )
  const customerOrders = await asRole("service_role", null, () =>
    db.query("SELECT id,status,total_count FROM public.get_customer_order_page($1,0,5)", [buyerId]),
  )
  assert.equal(customerOrders.rows.length, 5)
  assert.equal(Number(customerOrders.rows[0].total_count), 12)
  assert.ok(customerOrders.rows.some((item) => item.status === "completed"))
  await asRole("service_role", null, () =>
    db.query("SELECT public.delete_order_review($1,$2)", [buyerId,savedReview.rows[0].id]),
  )
  assert.equal(await scalar("SELECT count(*)::int FROM public.reviews WHERE id=$1", [savedReview.rows[0].id]), 0)

  await expectDenied(
    "authenticated",
    buyerId,
    "UPDATE public.profiles SET is_admin=true WHERE id=$1",
    [buyerId],
  )
  assert.equal(
    await asRole("authenticated", buyerId, async () =>
      scalar("SELECT count(*)::int FROM public.profiles WHERE id=$1", [providerUserId]),
    ),
    0,
  )
  assert.equal(
    await asRole("anon", null, async () => scalar("SELECT count(*)::int FROM public.public_profiles")),
    4,
  )

  await expectDenied(
    "authenticated",
    providerUserId,
    `INSERT INTO public.services (
      provider_id,name_ar,name_en,category,price,is_active
    ) VALUES ($1,'خدمة','Published directly','design',100,true)`,
    [providerId],
  )
  await asRole("service_role", null, () =>
    db.query("UPDATE public.services SET is_active=true WHERE id=$1", [serviceId]),
  )
  await expectDenied("anon",null,"SELECT id FROM public.services WHERE id=$1",[serviceId])
  await expectDenied("authenticated",providerUserId,"SELECT tap_destination_id FROM public.providers WHERE id=$1",[providerId])
  await expectDenied("authenticated",buyerId,"SELECT id FROM public.reviews LIMIT 1")
  await expectDenied("authenticated",buyerId,"SELECT id FROM public.favorites LIMIT 1")
  await expectDenied(
    "authenticated",
    providerUserId,
    "UPDATE public.services SET is_active=false WHERE id=$1",
    [serviceId],
  )
  await expectDenied(
    "authenticated",
    providerUserId,
    "UPDATE public.services SET name_en='Edited service' WHERE id=$1",
    [serviceId],
  )

  assert.equal(
    await asRole("authenticated", providerUserId, async () =>
      scalar("SELECT count(*)::int FROM public.messages WHERE conversation_id=$1", [conversationId]),
    ),
    3,
  )
  assert.equal(
    await asRole("authenticated", "10000000-0000-4000-8000-000000000099", async () =>
      scalar("SELECT count(*)::int FROM public.messages"),
    ),
    0,
  )
  await expectDenied(
    "authenticated",
    buyerId,
    "UPDATE public.conversations SET is_pinned_by_provider=true WHERE id=$1",
    [conversationId],
  )

  await asRole("authenticated", buyerId, () =>
    db.query("INSERT INTO storage.objects (bucket_id,name) VALUES ('avatars',$1)", [`${buyerId}/avatar.webp`]),
  )
  await expectDenied(
    "authenticated",
    providerUserId,
    "INSERT INTO storage.objects (bucket_id,name) VALUES ('avatars',$1)",
    [`${buyerId}/overwrite.webp`],
  )

  const serviceBucket = await db.query(
    "SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='service-images'",
  )
  assert.equal(serviceBucket.rows[0].public, true)
  const providerImagePath=`${providerId}/service.webp`
  await asRole("authenticated",providerUserId,()=>
    db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('service-images',$1)",[providerImagePath]),
  )
  await expectDenied(
    "authenticated",buyerId,
    "INSERT INTO storage.objects(bucket_id,name) VALUES('service-images',$1)",[`${providerId}/overwrite.webp`],
  )
  assert.equal(Number(serviceBucket.rows[0].file_size_limit), 10 * 1024 * 1024)
  assert.deepEqual(serviceBucket.rows[0].allowed_mime_types, ["image/jpeg", "image/png", "image/webp"])

  const createServiceSql = `SELECT public.create_service_draft(
    $1,'مسودة','Draft service','','','design',250,'fixed','3 days',ARRAY['Feature']
  ) AS id`
  await expectDenied("authenticated", providerUserId, createServiceSql, [providerUserId])
  const draft = await asRole("service_role", null, () => db.query(createServiceSql, [providerUserId]))
  const draftId = draft.rows[0].id
  assert.equal(await scalar("SELECT is_active FROM public.services WHERE id=$1", [draftId]), false)
  await asRole("service_role", null, () =>
    db.query(
      `SELECT public.update_service_draft(
        $1,$2,'مسودة محدثة','Updated draft','','','design',275,'fixed','4 days',
        ARRAY['Feature'],ARRAY['https://example.test/draft.webp']
      )`,
      [providerUserId, draftId],
    ),
  )
  assert.equal(await scalar("SELECT price::float FROM public.services WHERE id=$1", [draftId]), 275)
  assert.equal(await scalar("SELECT cardinality(image_urls) FROM public.services WHERE id=$1", [draftId]), 1)
  await asRole("service_role", null, () =>
    db.query("SELECT public.delete_service($1,$2)", [providerUserId, draftId]),
  )
  assert.equal(await scalar("SELECT count(*)::int FROM public.services WHERE id=$1", [draftId]), 0)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.delete_service($1,$2)", [providerUserId, serviceId]),
    ),
    (error) => error.code === "P0001",
  )

  await expectDenied(
    "authenticated",
    adminId,
    "SELECT public.apply_admin_action($1,'verify_provider',$2,'true',NULL)",
    [adminId, providerId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query("SELECT public.apply_admin_action($1,'verify_provider',$2,'true',NULL)",[adminId,providerId])),
    (error)=>error.code==="P0001",
  )
  const verificationClientId="d0000000-0000-4000-8000-000000000001"
  const verificationPath=`${providerId}/${providerUserId}/${verificationClientId}-0.pdf`
  const verificationDocuments=JSON.stringify([{path:verificationPath,name:"credential.pdf",mime:"application/pdf",size:1024}])
  await asRole("authenticated",providerUserId,()=>
    db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('provider-verification',$1)",[verificationPath]),
  )
  await expectDenied(
    "authenticated",providerUserId,
    "SELECT public.request_provider_verification($1,$2,$3,'Professional credentials',$4::jsonb)",
    [providerUserId,providerId,verificationClientId,verificationDocuments],
  )
  const verificationRequest=await asRole("service_role",null,()=>db.query(
    "SELECT public.request_provider_verification($1,$2,$3,'Professional credentials',$4::jsonb) AS request",
    [providerUserId,providerId,verificationClientId,verificationDocuments],
  ))
  const repeatedVerificationRequest=await asRole("service_role",null,()=>db.query(
    "SELECT public.request_provider_verification($1,$2,$3,'Professional credentials',$4::jsonb) AS request",
    [providerUserId,providerId,verificationClientId,verificationDocuments],
  ))
  assert.equal(repeatedVerificationRequest.rows[0].request.id,verificationRequest.rows[0].request.id)
  assert.equal(await asRole("authenticated",providerUserId,async()=>scalar("SELECT count(*)::int FROM public.provider_verification_documents")),1)
  assert.equal(await asRole("authenticated",buyerId,async()=>scalar("SELECT count(*)::int FROM public.provider_verification_documents")),0)
  const adminVerificationPage=await asRole("service_role",null,()=>db.query(
    "SELECT * FROM public.get_provider_verification_page($1,true,NULL,NULL,10)",[adminId],
  ))
  assert.equal(adminVerificationPage.rows.length,1)
  assert.equal(adminVerificationPage.rows[0].documents[0].name,"credential.pdf")
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.review_provider_verification($1,$2,'approved','Documents verified')",
    [adminId,verificationRequest.rows[0].request.id],
  )
  await asRole("service_role",null,()=>db.query(
    "SELECT public.review_provider_verification($1,$2,'approved','Documents verified')",
    [adminId,verificationRequest.rows[0].request.id],
  ))
  assert.equal(await scalar("SELECT is_verified FROM public.providers WHERE id=$1", [providerId]), true)
  await expectDenied(
    "authenticated",adminId,
    "SELECT * FROM public.get_admin_provider_page($1,NULL,'all',NULL,NULL,50)",
    [adminId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT * FROM public.get_admin_provider_page($1,NULL,'all',NULL,NULL,50)",
      [buyerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstAdminProviderPage=await asRole("service_role",null,()=>db.query(
    "SELECT * FROM public.get_admin_provider_page($1,NULL,'all',NULL,NULL,1)",
    [adminId],
  ))
  assert.equal(firstAdminProviderPage.rows.length,1)
  assert.equal(Number(firstAdminProviderPage.rows[0].total_count),2)
  const secondAdminProviderPage=await asRole("service_role",null,()=>db.query(
    "SELECT * FROM public.get_admin_provider_page($1,NULL,'all',$2,$3,1)",
    [adminId,firstAdminProviderPage.rows[0].created_at,firstAdminProviderPage.rows[0].id],
  ))
  assert.equal(secondAdminProviderPage.rows.length,1)
  assert.notEqual(secondAdminProviderPage.rows[0].id,firstAdminProviderPage.rows[0].id)
  const verifiedAdminProvider=await asRole("service_role",null,()=>db.query(
    "SELECT * FROM public.get_admin_provider_page($1,'Provider','verified',NULL,NULL,50)",
    [adminId],
  ))
  assert.deepEqual(verifiedAdminProvider.rows.map((row)=>row.id),[providerId])
  const unverifiedAdminProvider=await asRole("service_role",null,()=>db.query(
    "SELECT * FROM public.get_admin_provider_page($1,'New','unverified',NULL,NULL,50)",
    [adminId],
  ))
  assert.deepEqual(unverifiedAdminProvider.rows.map((row)=>row.id),[onboarding.rows[0].id])
  const referencedVerificationDelete=await asRole("authenticated",providerUserId,()=>
    db.query("DELETE FROM storage.objects WHERE bucket_id='provider-verification' AND name=$1 RETURNING name",[verificationPath]),
  )
  assert.equal(referencedVerificationDelete.rows.length,0)

  await asRole("service_role",null,()=>db.query(
    `SELECT public.update_service_draft(
      $1,$2,'خدمة محدثة','Edited service','وصف','Description','design',100,'fixed','3 days',
      ARRAY['Feature'],ARRAY['https://example.test/service.webp']
    )`,
    [providerUserId,serviceId],
  ))
  await asRole("service_role", null, () =>
    db.query("SELECT public.submit_service_for_review($1,$2)", [providerUserId, serviceId]),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_service($1,$2,'rejected','Add delivery details')", [adminId, serviceId]),
  )
  assert.equal(await scalar("SELECT moderation_status FROM public.services WHERE id=$1", [serviceId]), "rejected")
  assert.equal(await scalar("SELECT moderation_note FROM public.services WHERE id=$1", [serviceId]), "Add delivery details")
  await asRole("service_role", null, () =>
    db.query("SELECT public.submit_service_for_review($1,$2)", [providerUserId, serviceId]),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_service($1,$2,'approved','Approved after edit')", [adminId, serviceId]),
  )
  assert.equal(await scalar("SELECT is_active FROM public.services WHERE id=$1", [serviceId]), true)

  await db.query(
    "UPDATE public.providers SET tap_destination_id='dest_verified',tap_account_status='active',tap_onboarding_completed=true WHERE id=$1",
    [providerId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.request_provider_withdrawal($1,$2,80)",[providerId,providerUserId],
    )),
    (error)=>error.code==="P0001",
  )
  await expectDenied(
    "authenticated",providerUserId,
    "SELECT public.sync_provider_tap_destination_status($1,$2,'dest_verified','active',true,true)",
    [providerUserId,providerId],
  )
  await expectDenied(
    "service_role",null,
    "SELECT public.sync_provider_tap_destination_status($1,$2,'dest_verified','active',true,true)",
    [buyerId,providerId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.sync_provider_tap_destination_status($1,$2,'dest_verified','pending',true,false)",
      [providerUserId,providerId],
    )),
    (error)=>error.code==="P0001",
  )
  await asRole("service_role",null,()=>db.query(
    "SELECT public.sync_provider_tap_destination_status($1,$2,'dest_verified','active',true,true)",
    [providerUserId,providerId],
  ))
  assert.deepEqual(
    await db.query(
      "SELECT tap_account_status,tap_charges_enabled,tap_payouts_enabled,tap_onboarding_completed,tap_status_source,tap_status_checked_at IS NOT NULL AS checked FROM public.providers WHERE id=$1",
      [providerId],
    ).then((result)=>result.rows[0]),
    {tap_account_status:"active",tap_charges_enabled:true,tap_payouts_enabled:true,
      tap_onboarding_completed:true,tap_status_source:"tap_destination_api",checked:true},
  )
  await db.query("UPDATE public.providers SET tap_status_checked_at=now()-interval '6 minutes' WHERE id=$1",[providerId])
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.request_provider_withdrawal($1,$2,80)",[providerId,providerUserId],
    )),
    (error)=>error.code==="P0001",
  )
  await asRole("service_role",null,()=>db.query(
    "SELECT public.sync_provider_tap_destination_status($1,$2,'dest_verified','active',true,true)",
    [providerUserId,providerId],
  ))
  const syncedAdminProvider=await asRole("service_role",null,()=>db.query(
    "SELECT * FROM public.get_admin_provider_page($1,$2,'all',NULL,NULL,10)",[adminId,providerId],
  ))
  assert.equal(syncedAdminProvider.rows[0].tap_charges_enabled,true)
  assert.equal(syncedAdminProvider.rows[0].tap_payouts_enabled,true)
  assert.ok(syncedAdminProvider.rows[0].tap_status_checked_at)
  await expectDenied(
    "authenticated",
    providerUserId,
    "SELECT public.request_provider_withdrawal($1,$2,80)",
    [providerId, providerUserId],
  )
  const withdrawal = await asRole("service_role", null, () =>
    db.query("SELECT public.request_provider_withdrawal($1,$2,80) AS id", [providerId, providerUserId]),
  )
  const withdrawalId = withdrawal.rows[0].id
  const reservedBalance = await asRole("service_role", null, () =>
    db.query("SELECT public.get_provider_balance($1,$2) AS balance", [providerId,providerUserId]),
  )
  assert.equal(Number(reservedBalance.rows[0].balance.available), 5)
  assert.equal(Number(reservedBalance.rows[0].balance.reserved), 80)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.request_provider_withdrawal($1,$2,6)", [providerId, providerUserId]),
    ),
    (error) => error.code === "P0001",
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_withdrawal_request($1,$2,'rejected','Needs updated bank details')", [adminId,withdrawalId]),
  )
  const releasedBalance = await asRole("service_role", null, () =>
    db.query("SELECT public.get_provider_balance($1,$2) AS balance", [providerId,providerUserId]),
  )
  assert.equal(Number(releasedBalance.rows[0].balance.available), 85)
  assert.equal(Number(releasedBalance.rows[0].balance.reserved), 0)
  const approvedWithdrawal = await asRole("service_role", null, () =>
    db.query("SELECT public.request_provider_withdrawal($1,$2,50) AS id", [providerId,providerUserId]),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_withdrawal_request($1,$2,'approved','Reviewed')", [adminId,approvedWithdrawal.rows[0].id]),
  )
  assert.equal(await scalar("SELECT status FROM public.withdrawal_requests WHERE id=$1", [approvedWithdrawal.rows[0].id]), "approved")
  const approvedBalance = await asRole("service_role", null, () =>
    db.query("SELECT public.get_provider_balance($1,$2) AS balance", [providerId,providerUserId]),
  )
  assert.equal(Number(approvedBalance.rows[0].balance.available), 35)
  assert.equal(Number(approvedBalance.rows[0].balance.reserved), 50)
  await expectDenied(
    "authenticated",
    providerUserId,
    "SELECT * FROM public.ledger_entries WHERE provider_id=$1",
    [providerId],
  )
  await expectDenied("service_role", null, "DELETE FROM public.ledger_entries")
  assert.equal(
    await asRole("authenticated", adminId, async () => scalar("SELECT count(*)::int FROM public.admin_audit_log")),
    7,
  )
  assert.equal(
    await asRole("authenticated", providerUserId, async () => scalar("SELECT count(*)::int FROM public.admin_audit_log")),
    0,
  )
  await expectDenied(
    "authenticated",
    adminId,
    "SELECT public.set_account_suspension($1,$2,true,'Policy violation')",
    [adminId,providerUserId],
  )
  await expectDenied(
    "service_role",
    null,
    "SELECT public.set_account_suspension($1,$2,true,'Unauthorized')",
    [buyerId,providerUserId],
  )
  await expectDenied(
    "authenticated",
    providerUserId,
    "UPDATE public.profiles SET suspended_at=now(),suspension_reason='Self change',suspended_by=$1 WHERE id=$1",
    [providerUserId],
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_account_suspension($1,$2,true,'Policy violation')", [adminId,providerUserId]),
  )
  assert.equal(await scalar("SELECT public.is_account_active($1)", [providerUserId]), false)
  assert.equal(
    await asRole("service_role", null, async () =>
      scalar("SELECT count(*)::int FROM public.search_service_catalog(NULL,NULL,'newest',0,12)"),
    ),
    0,
  )
  assert.equal(
    await asRole("authenticated", providerUserId, async () =>
      scalar("SELECT count(*)::int FROM public.messages WHERE conversation_id=$1", [conversationId]),
    ),
    0,
  )
  await expectDenied(
    "authenticated",
    adminId,
    "SELECT * FROM public.get_admin_audit_page($1,'suspend_user',0,10)",
    [adminId],
  )
  const suspensionAudit = await asRole("service_role", null, () =>
    db.query("SELECT action,target_id,total_count FROM public.get_admin_audit_page($1,'suspend_user',0,10)", [adminId]),
  )
  assert.equal(suspensionAudit.rows[0].action, "suspend_user")
  assert.equal(suspensionAudit.rows[0].target_id, providerUserId)
  assert.equal(Number(suspensionAudit.rows[0].total_count), 1)
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_account_suspension($1,$2,false,'Appeal approved')", [adminId,providerUserId]),
  )
  assert.equal(await scalar("SELECT public.is_account_active($1)", [providerUserId]), true)
  assert.equal(
    await asRole("service_role", null, async () =>
      scalar("SELECT count(*)::int FROM public.search_service_catalog(NULL,NULL,'newest',0,12)"),
    ),
    1,
  )
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.create_support_ticket($1,$2,'Payment question','I need help understanding this order','en',$3)",
    [buyerId,"90000000-0000-4000-8000-000000000001",orderId],
  )
  const supportTicket = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.create_support_ticket($1,$2,'Payment question','I need help understanding this order','en',$3) AS ticket",
      [buyerId,"90000000-0000-4000-8000-000000000001",orderId],
    ),
  )
  const repeatedSupportTicket = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.create_support_ticket($1,$2,'Payment question','I need help understanding this order','en',$3) AS ticket",
      [buyerId,"90000000-0000-4000-8000-000000000001",orderId],
    ),
  )
  const supportTicketId = supportTicket.rows[0].ticket.id
  assert.equal(repeatedSupportTicket.rows[0].ticket.id, supportTicketId)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query(
        "SELECT public.create_support_ticket($1,$2,'Different subject','I need help understanding this order','en',$3)",
        [buyerId,"90000000-0000-4000-8000-000000000001",orderId],
      ),
    ),
    (error) => error.code === "P0001",
  )
  await expectDenied(
    "service_role",
    null,
    "SELECT * FROM public.get_support_ticket_messages($1,$2)",
    [onboardingUserId,supportTicketId],
  )
  const buyerReply = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.reply_support_ticket($1,$2,$3,'Here are more details') AS message",
      [buyerId,supportTicketId,"90000000-0000-4000-8000-000000000002"],
    ),
  )
  const repeatedBuyerReply = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.reply_support_ticket($1,$2,$3,'Here are more details') AS message",
      [buyerId,supportTicketId,"90000000-0000-4000-8000-000000000002"],
    ),
  )
  assert.equal(repeatedBuyerReply.rows[0].message.id, buyerReply.rows[0].message.id)
  await asRole("service_role", null, () =>
    db.query(
      "SELECT public.reply_support_ticket($1,$2,$3,'An administrator is reviewing this request')",
      [adminId,supportTicketId,"90000000-0000-4000-8000-000000000003"],
    ),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.set_support_ticket_status($1,$2,'closed','Question answered')", [adminId,supportTicketId]),
  )
  assert.equal(await scalar("SELECT status FROM public.support_tickets WHERE id=$1", [supportTicketId]), "closed")
  assert.equal(await scalar("SELECT count(*)::int FROM public.support_ticket_messages WHERE ticket_id=$1", [supportTicketId]), 2)
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT * FROM public.get_support_ticket_page($1,false,NULL,NULL,50)",
    [buyerId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query("SELECT * FROM public.get_support_ticket_page($1,true,NULL,NULL,50)",[buyerId])),
    (error)=>error.code==="42501",
  )
  const userTicketPage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_support_ticket_page($1,false,NULL,NULL,1)",[buyerId]),
  )
  assert.equal(userTicketPage.rows.length,1)
  assert.equal(Number(userTicketPage.rows[0].total_count),1)
  const adminTicketPage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_support_ticket_page($1,true,NULL,NULL,1)",[adminId]),
  )
  assert.equal(adminTicketPage.rows[0].requester_email,"buyer@example.test")
  const firstSupportMessagePage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_support_ticket_message_page($1,$2,NULL,NULL,1)",[buyerId,supportTicketId]),
  )
  assert.equal(Number(firstSupportMessagePage.rows[0].total_count),2)
  const secondSupportMessagePage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_support_ticket_message_page($1,$2,$3,$4,1)",[
      buyerId,supportTicketId,firstSupportMessagePage.rows[0].created_at,firstSupportMessagePage.rows[0].id,
    ]),
  )
  assert.equal(secondSupportMessagePage.rows.length,1)
  assert.notEqual(secondSupportMessagePage.rows[0].id,firstSupportMessagePage.rows[0].id)
  assert.equal(
    await asRole("authenticated", buyerId, async () =>
      scalar("SELECT count(*)::int FROM public.support_tickets WHERE id=$1", [supportTicketId]),
    ),
    1,
  )
  assert.equal(
    await asRole("authenticated", onboardingUserId, async () =>
      scalar("SELECT count(*)::int FROM public.support_tickets WHERE id=$1", [supportTicketId]),
    ),
    0,
  )
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT * FROM public.get_user_notifications($1,100)",
    [buyerId],
  )
  const buyerNotifications = await asRole("service_role", null, () =>
    db.query("SELECT id,unread_count FROM public.get_user_notifications($1,100)", [buyerId]),
  )
  assert.ok(buyerNotifications.rows.length > 0)
  assert.ok(Number(buyerNotifications.rows[0].unread_count) > 0)
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT * FROM public.get_user_notification_page($1,NULL,NULL,2)",
    [buyerId],
  )
  const firstNotificationPage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_user_notification_page($1,NULL,NULL,2)",[buyerId]),
  )
  assert.equal(firstNotificationPage.rows.length,2)
  const notificationCursor=firstNotificationPage.rows.at(-1)
  const secondNotificationPage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_user_notification_page($1,$2,$3,2)",[
      buyerId,notificationCursor.created_at,notificationCursor.id,
    ]),
  )
  assert.ok(secondNotificationPage.rows.length>0)
  assert.ok(!firstNotificationPage.rows.some((notification)=>notification.id===secondNotificationPage.rows[0].id))
  assert.equal(Number(secondNotificationPage.rows[0].unread_count),Number(firstNotificationPage.rows[0].unread_count))
  await asRole("service_role", null, () =>
    db.query("SELECT public.mark_notification_read($1,$2)", [buyerId,buyerNotifications.rows[0].id]),
  )
  await expectDenied(
    "service_role",
    null,
    "SELECT public.mark_notification_read($1,$2)",
    [providerUserId,buyerNotifications.rows[0].id],
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.mark_all_notifications_read($1)", [buyerId]),
  )
  assert.equal(await scalar("SELECT count(*)::int FROM public.notifications WHERE user_id=$1 AND read_at IS NULL", [buyerId]), 0)
  await expectDenied("authenticated", buyerId, "SELECT * FROM public.get_active_ai_knowledge()")
  const knowledgeRows = await asRole("service_role", null, () =>
    db.query("SELECT article_key,version FROM public.get_active_ai_knowledge()"),
  )
  assert.equal(knowledgeRows.rows.length, 5)
  const aiSessionClientId = "a0000000-0000-4000-8000-000000000001"
  const aiRequestId = "a0000000-0000-4000-8000-000000000002"
  const firstAITurn = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.begin_ai_chat_turn($1,NULL,$2,$3,'What is my order status?','en') AS turn",
      [buyerId,aiSessionClientId,aiRequestId],
    ),
  )
  const aiSessionId = firstAITurn.rows[0].turn.session_id
  assert.equal(firstAITurn.rows[0].turn.turn_status, "pending")
  const repeatedAITurn = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.begin_ai_chat_turn($1,$2,$3,$4,'What is my order status?','en') AS turn",
      [buyerId,aiSessionId,aiSessionClientId,aiRequestId],
    ),
  )
  assert.equal(repeatedAITurn.rows[0].turn.session_id, aiSessionId)
  await expectDenied(
    "service_role",
    null,
    "SELECT public.get_ai_chat_session($1,$2)",
    [onboardingUserId,aiSessionId],
  )
  const ownedOrderContext = await asRole("service_role", null, () =>
    db.query("SELECT public.get_ai_order_context($1,$2) AS context", [buyerId,orderId]),
  )
  assert.equal(ownedOrderContext.rows[0].context.status, "completed")
  const hiddenOrderContext = await asRole("service_role", null, () =>
    db.query("SELECT public.get_ai_order_context($1,$2) AS context", [onboardingUserId,orderId]),
  )
  assert.equal(hiddenOrderContext.rows[0].context, null)
  await asRole("service_role", null, () =>
    db.query("SELECT public.complete_ai_chat_turn($1,$2,$3,'Your order is completed.')", [buyerId,aiSessionId,aiRequestId]),
  )
  const cachedAITurn = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.begin_ai_chat_turn($1,$2,$3,$4,'What is my order status?','en') AS turn",
      [buyerId,aiSessionId,aiSessionClientId,aiRequestId],
    ),
  )
  assert.equal(cachedAITurn.rows[0].turn.turn_status, "completed")
  assert.equal(cachedAITurn.rows[0].turn.assistant_content, "Your order is completed.")
  const secondAIRequestId = "a0000000-0000-4000-8000-000000000003"
  const secondAITurn = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.begin_ai_chat_turn($1,$2,$3,$4,'What can I do next?','en') AS turn",
      [buyerId,aiSessionId,aiSessionClientId,secondAIRequestId],
    ),
  )
  assert.equal(secondAITurn.rows[0].turn.context_turns.length, 1)
  await asRole("service_role", null, () =>
    db.query("SELECT public.fail_ai_chat_turn($1,$2,$3,'timeout')", [buyerId,aiSessionId,secondAIRequestId]),
  )
  const retriedAITurn = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.begin_ai_chat_turn($1,$2,$3,$4,'What can I do next?','en') AS turn",
      [buyerId,aiSessionId,aiSessionClientId,secondAIRequestId],
    ),
  )
  assert.equal(retriedAITurn.rows[0].turn.turn_status, "pending")
  await asRole("service_role", null, () =>
    db.query("SELECT public.complete_ai_chat_turn($1,$2,$3,'Create a support ticket if needed.')", [buyerId,aiSessionId,secondAIRequestId]),
  )
  const restoredAISession = await asRole("service_role", null, () =>
    db.query("SELECT public.get_ai_chat_session($1,$2) AS session", [buyerId,aiSessionId]),
  )
  assert.equal(restoredAISession.rows[0].session.turns.length, 2)
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.request_order_refund($1,$2,$3,20,'Customer requested partial refund')",
    [buyerId,orderId,"b0000000-0000-4000-8000-000000000001"],
  )
  await expectDenied(
    "service_role",
    null,
    "SELECT public.request_order_refund($1,$2,$3,20,'Unauthorized requester')",
    [onboardingUserId,orderId,"b0000000-0000-4000-8000-000000000001"],
  )
  const cancellableRefund = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.request_order_refund($1,$2,$3,20,'Customer requested partial refund') AS refund",
      [buyerId,orderId,"b0000000-0000-4000-8000-000000000001"],
    ),
  )
  const repeatedRefund = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.request_order_refund($1,$2,$3,20,'Customer requested partial refund') AS refund",
      [buyerId,orderId,"b0000000-0000-4000-8000-000000000001"],
    ),
  )
  assert.equal(repeatedRefund.rows[0].refund.id, cancellableRefund.rows[0].refund.id)
  await asRole("service_role", null, () =>
    db.query("SELECT public.cancel_order_refund($1,$2)", [buyerId,cancellableRefund.rows[0].refund.id]),
  )
  assert.equal(await scalar("SELECT refund_status FROM public.orders WHERE id=$1", [orderId]), "none")

  const rejectedRefund = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.request_order_refund($1,$2,$3,20,'Second partial refund request') AS refund",
      [buyerId,orderId,"b0000000-0000-4000-8000-000000000002"],
    ),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_order_refund($1,$2,'rejected','Request not supported by evidence')", [adminId,rejectedRefund.rows[0].refund.id]),
  )
  assert.equal(await scalar("SELECT refund_status FROM public.orders WHERE id=$1", [orderId]), "none")

  const approvedRefund = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.request_order_refund($1,$2,$3,20,'Approved partial refund request') AS refund",
      [buyerId,orderId,"b0000000-0000-4000-8000-000000000003"],
    ),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_order_refund($1,$2,'approved','Approved for external execution')", [adminId,approvedRefund.rows[0].refund.id]),
  )
  await expectDenied(
    "authenticated",
    adminId,
    "SELECT public.begin_refund_attempt($1)",
    [approvedRefund.rows[0].refund.id],
  )
  const refundAttempt = await asRole("service_role", null, () =>
    db.query("SELECT public.begin_refund_attempt($1) AS attempt", [approvedRefund.rows[0].refund.id]),
  )
  const acceptedRefundEvent = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_refund_event('checkout','re_test_1:ACCEPTED','re_test_1','ACCEPTED',$1,$2,'chg_test_1',20,'SAR',true,'{}') AS id",
      [approvedRefund.rows[0].refund.id,refundAttempt.rows[0].attempt.id],
    ),
  )
  const repeatedAcceptedEvent = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_refund_event('checkout','re_test_1:ACCEPTED','re_test_1','ACCEPTED',$1,$2,'chg_test_1',20,'SAR',true,'{}') AS id",
      [approvedRefund.rows[0].refund.id,refundAttempt.rows[0].attempt.id],
    ),
  )
  assert.equal(repeatedAcceptedEvent.rows[0].id, acceptedRefundEvent.rows[0].id)
  const acceptedResult = await asRole("service_role", null, () =>
    db.query("SELECT public.process_refund_event($1) AS result", [acceptedRefundEvent.rows[0].id]),
  )
  assert.equal(acceptedResult.rows[0].result.result, "unknown")
  assert.equal(await scalar("SELECT refund_status FROM public.orders WHERE id=$1", [orderId]), "unknown")
  await assert.rejects(
    asRole("service_role", null, () => db.query("SELECT public.request_account_deletion($1)", [buyerId])),
    (error) => error.code === "P0001",
  )
  const completedRefundEvent = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_refund_event('webhook','re_test_1:REFUNDED','re_test_1','REFUNDED',$1,$2,'chg_test_1',20,'SAR',true,'{}') AS id",
      [approvedRefund.rows[0].refund.id,refundAttempt.rows[0].attempt.id],
    ),
  )
  const completedResult = await asRole("service_role", null, () =>
    db.query("SELECT public.process_refund_event($1) AS result", [completedRefundEvent.rows[0].id]),
  )
  assert.equal(completedResult.rows[0].result.result, "succeeded")
  assert.equal(await scalar("SELECT refunded_amount::float FROM public.orders WHERE id=$1", [orderId]), 20)
  assert.equal(await scalar("SELECT refund_status FROM public.orders WHERE id=$1", [orderId]), "partial")
  assert.equal(await scalar("SELECT status FROM public.orders WHERE id=$1", [orderId]), "completed")
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query(
        "SELECT public.request_order_refund($1,$2,$3,81,'Exceeds remaining amount')",
        [buyerId,orderId,"b0000000-0000-4000-8000-000000000004"],
      ),
    ),
    (error) => error.code === "P0001",
  )
  const postRefundBalance = await asRole("service_role", null, () =>
    db.query("SELECT public.get_provider_balance($1,$2) AS balance", [providerId,providerUserId]),
  )
  assert.equal(Number(postRefundBalance.rows[0].balance.total_earned), 68)
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.create_order_dispute($1,$2,$3,'quality','Delivered work does not match the agreed scope','Please review the delivered work')",
    [buyerId,orderId,"c0000000-0000-4000-8000-000000000001"],
  )
  await expectDenied(
    "service_role",
    null,
    "SELECT public.create_order_dispute($1,$2,$3,'quality','Unauthorized dispute description','Please review this')",
    [onboardingUserId,orderId,"c0000000-0000-4000-8000-000000000001"],
  )
  const firstDispute = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.create_order_dispute($1,$2,$3,'quality','Delivered work does not match the agreed scope','Please review the delivered work') AS dispute",
      [buyerId,orderId,"c0000000-0000-4000-8000-000000000001"],
    ),
  )
  const firstDisputeId = firstDispute.rows[0].dispute.id
  assert.equal(Number(firstDispute.rows[0].dispute.ledger_hold_amount), 68)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query(
        "SELECT public.request_order_refund($1,$2,$3,1,'Blocked by open dispute')",
        [buyerId,orderId,"c0000000-0000-4000-8000-000000000002"],
      ),
    ),
    (error) => error.code === "P0001",
  )
  await assert.rejects(
    asRole("service_role", null, () => db.query("SELECT public.request_account_deletion($1)", [buyerId])),
    (error) => error.code === "P0001",
  )
  const evidencePath = `${firstDisputeId}/${buyerId}/evidence.pdf`
  await asRole("authenticated", buyerId, () =>
    db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('dispute-evidence',$1)", [evidencePath]),
  )
  await expectDenied(
    "authenticated",
    onboardingUserId,
    "INSERT INTO storage.objects(bucket_id,name) VALUES('dispute-evidence',$1)",
    [`${firstDisputeId}/${onboardingUserId}/unauthorized.pdf`],
  )
  const evidenceRecord = await asRole("service_role", null, () =>
    db.query("SELECT public.add_dispute_evidence($1,$2,$3,'Delivery screenshot') AS evidence", [buyerId,firstDisputeId,evidencePath]),
  )
  assert.equal(evidenceRecord.rows[0].evidence.storage_path, evidencePath)
  assert.equal(
    await asRole("authenticated", providerUserId, async () =>
      scalar("SELECT count(*)::int FROM public.dispute_evidence WHERE dispute_id=$1", [firstDisputeId]),
    ),
    1,
  )
  assert.equal(
    await asRole("authenticated", providerUserId, async () =>
      scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='dispute-evidence' AND name=$1", [evidencePath]),
    ),
    1,
  )
  assert.equal(
    await asRole("authenticated", onboardingUserId, async () =>
      scalar("SELECT count(*)::int FROM public.dispute_evidence WHERE dispute_id=$1", [firstDisputeId]),
    ),
    0,
  )
  assert.equal(
    await asRole("authenticated", onboardingUserId, async () =>
      scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='dispute-evidence' AND name=$1", [evidencePath]),
    ),
    0,
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_order_dispute($1,$2,'under_review','Reviewing submitted evidence',NULL)", [adminId,firstDisputeId]),
  )
  assert.equal(await scalar("SELECT dispute_status FROM public.orders WHERE id=$1", [orderId]), "under_review")
  await asRole("service_role", null, () =>
    db.query("SELECT public.review_order_dispute($1,$2,'continue_order','No refund required after review',NULL)", [adminId,firstDisputeId]),
  )
  assert.equal(await scalar("SELECT status FROM public.disputes WHERE id=$1", [firstDisputeId]), "resolved")

  const secondDispute = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.create_order_dispute($1,$2,$3,'payment','Provider requests review of the remaining payment','Resolve the remaining payment') AS dispute",
      [providerUserId,orderId,"c0000000-0000-4000-8000-000000000003"],
    ),
  )
  const secondDisputeId = secondDispute.rows[0].dispute.id
  const refundResolution = await asRole("service_role", null, () =>
    db.query("SELECT public.review_order_dispute($1,$2,'refund','Partial refund required by dispute decision',20) AS dispute", [adminId,secondDisputeId]),
  )
  assert.equal(refundResolution.rows[0].dispute.resolution, "refund")
  assert.ok(refundResolution.rows[0].dispute.resolution_refund_id)
  assert.equal(
    await scalar("SELECT status FROM public.refund_requests WHERE id=$1", [refundResolution.rows[0].dispute.resolution_refund_id]),
    "approved",
  )
  assert.equal(await scalar("SELECT refund_status FROM public.orders WHERE id=$1", [orderId]), "approved")
  assert.equal(await scalar("SELECT dispute_status FROM public.orders WHERE id=$1", [orderId]), "resolved")
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.begin_payout_tracking($1,$2,'tap_dashboard','payout_external_1','Initiated in Tap dashboard')", [adminId,approvedWithdrawal.rows[0].id]),
    ),
    (error) => error.code === "P0001",
  )
  const disputeRefundAttempt = await asRole("service_role", null, () =>
    db.query("SELECT public.begin_refund_attempt($1) AS attempt", [refundResolution.rows[0].dispute.resolution_refund_id]),
  )
  const failedDisputeRefundEvent = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_refund_event('webhook','re_dispute_failed:FAILED','re_dispute_failed','FAILED',$1,$2,'chg_test_1',20,'SAR',true,'{}') AS id",
      [refundResolution.rows[0].dispute.resolution_refund_id,disputeRefundAttempt.rows[0].attempt.id],
    ),
  )
  await asRole("service_role", null, () =>
    db.query("SELECT public.process_refund_event($1)", [failedDisputeRefundEvent.rows[0].id]),
  )
  assert.equal(await scalar("SELECT refund_status FROM public.orders WHERE id=$1", [orderId]), "partial")
  const payoutAttempt = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.begin_payout_tracking($1,$2,'tap_dashboard','payout_external_1','Initiated in Tap dashboard') AS attempt",
      [adminId,approvedWithdrawal.rows[0].id],
    ),
  )
  const repeatedPayoutAttempt = await asRole("service_role", null, () =>
    db.query(
      "SELECT public.begin_payout_tracking($1,$2,'tap_dashboard','payout_external_1','Initiated in Tap dashboard') AS attempt",
      [adminId,approvedWithdrawal.rows[0].id],
    ),
  )
  assert.equal(repeatedPayoutAttempt.rows[0].attempt.id,payoutAttempt.rows[0].attempt.id)
  await expectDenied(
    "authenticated",
    providerUserId,
    "SELECT public.record_payout_tracking_result($1,$2,'paid','report-row-1','Verified PAID_OUT')",
    [adminId,payoutAttempt.rows[0].attempt.id],
  )
  await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_payout_tracking_result($1,$2,'unknown','report-pending','Payout is not terminal')",
      [adminId,payoutAttempt.rows[0].attempt.id],
    ),
  )
  assert.equal(await scalar("SELECT status FROM public.withdrawal_requests WHERE id=$1", [approvedWithdrawal.rows[0].id]), "unknown")
  await asRole("service_role", null, () =>
    db.query(
      "SELECT public.record_payout_tracking_result($1,$2,'paid','report-row-1','Verified PAID_OUT')",
      [adminId,payoutAttempt.rows[0].attempt.id],
    ),
  )
  assert.equal(await scalar("SELECT status FROM public.withdrawal_requests WHERE id=$1", [approvedWithdrawal.rows[0].id]), "paid")
  assert.equal(
    await asRole("authenticated", providerUserId, async () =>
      scalar("SELECT count(*)::int FROM public.payout_attempts WHERE id=$1", [payoutAttempt.rows[0].attempt.id]),
    ),
    1,
  )
  const postDisputeBalance = await asRole("service_role", null, () =>
    db.query("SELECT public.get_provider_balance($1,$2) AS balance", [providerId,providerUserId]),
  )
  assert.equal(Number(postDisputeBalance.rows[0].balance.total_earned), 68)
  assert.equal(Number(postDisputeBalance.rows[0].balance.available), 18)
  assert.equal(Number(postDisputeBalance.rows[0].balance.reserved), 0)
  assert.equal(Number(postDisputeBalance.rows[0].balance.paid), 50)
  await expectDenied(
    "authenticated",providerUserId,
    "SELECT * FROM public.get_provider_ledger_page($1,$2,NULL,NULL,5)",
    [providerUserId,providerId],
  )
  const firstLedgerPage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_provider_ledger_page($1,$2,NULL,NULL,5)",[providerUserId,providerId]),
  )
  assert.equal(firstLedgerPage.rows.length,5)
  assert.equal(Number(firstLedgerPage.rows[0].total_count),16)
  const ledgerCursor=firstLedgerPage.rows.at(-1)
  const secondLedgerPage=await asRole("service_role",null,()=>
    db.query("SELECT * FROM public.get_provider_ledger_page($1,$2,$3,$4,5)",[
      providerUserId,providerId,ledgerCursor.created_at,ledgerCursor.id,
    ]),
  )
  assert.equal(secondLedgerPage.rows.length,5)
  assert.ok(!firstLedgerPage.rows.some((entry)=>entry.id===secondLedgerPage.rows[0].id))
  await expectDenied(
    "authenticated",
    providerUserId,
    "SELECT public.get_provider_dashboard_snapshot($1,$2,0,5)",
    [providerUserId,providerId],
  )
  await expectDenied(
    "authenticated",
    adminId,
    "SELECT * FROM public.get_admin_order_page($1,NULL,NULL,0,5)",
    [adminId],
  )
  await expectDenied(
    "authenticated",
    adminId,
    "SELECT public.get_admin_operations_summary($1)",
    [adminId],
  )
  const providerDashboard = await asRole("service_role", null, () =>
    db.query("SELECT public.get_provider_dashboard_snapshot($1,$2,0,5) AS snapshot", [providerUserId,providerId]),
  )
  assert.equal(Number(providerDashboard.rows[0].snapshot.total_orders), 12)
  assert.equal(providerDashboard.rows[0].snapshot.orders.length, 5)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.active_orders), 0)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.completed_orders), 11)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.pending_earnings), 0)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.gross_completed), 1100)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.refunded_amount), 20)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.open_refunds), 0)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.open_disputes), 0)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.available_balance), 18)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.reserved_balance), 0)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.paid_balance), 50)
  assert.equal(Number(providerDashboard.rows[0].snapshot.stats.total_earned), 68)

  const adminSummary = await asRole("service_role", null, () =>
    db.query("SELECT public.get_admin_operations_summary($1) AS summary", [adminId]),
  )
  assert.equal(Number(adminSummary.rows[0].summary.total_users), 4)
  assert.equal(Number(adminSummary.rows[0].summary.total_orders), 12)
  assert.equal(Number(adminSummary.rows[0].summary.completed_orders), 11)
  assert.equal(Number(adminSummary.rows[0].summary.gross_completed), 1100)
  assert.equal(Number(adminSummary.rows[0].summary.refunded_amount), 20)
  assert.equal(Number(adminSummary.rows[0].summary.open_refunds), 0)
  assert.equal(Number(adminSummary.rows[0].summary.open_disputes), 0)
  assert.equal(Number(adminSummary.rows[0].summary.pending_withdrawals), 0)
  assert.equal(Number(adminSummary.rows[0].summary.payment_exceptions), 1)
  assert.equal(Number(adminSummary.rows[0].summary.provider_available), 18)
  assert.equal(Number(adminSummary.rows[0].summary.provider_reserved), 0)
  assert.equal(Number(adminSummary.rows[0].summary.provider_paid), 50)

  await db.query(
    `INSERT INTO public.payment_events(
      source,event_key,external_charge_id,external_status,signature_valid,processing_status
    ) VALUES
      ('webhook','late-pending-1','chg_late_pending_1','CAPTURED',false,'pending'),
      ('webhook','late-pending-2','chg_late_pending_2','CAPTURED',false,'pending')`,
  )
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.get_admin_payment_exception_page($1,'all',NULL,NULL,50)",
    [adminId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_admin_payment_exception_page($1,'all',NULL,NULL,50)",
      [buyerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstPaymentExceptionPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_payment_exception_page($1,'all',NULL,NULL,2) AS page",
    [adminId],
  ))
  assert.equal(Number(firstPaymentExceptionPage.rows[0].page.total),3)
  assert.equal(Number(firstPaymentExceptionPage.rows[0].page.pending_count),2)
  assert.equal(Number(firstPaymentExceptionPage.rows[0].page.quarantined_count),1)
  assert.equal(firstPaymentExceptionPage.rows[0].page.events.length,2)
  const lastPaymentException=firstPaymentExceptionPage.rows[0].page.events.at(-1)
  const secondPaymentExceptionPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_payment_exception_page($1,'all',$2,$3,2) AS page",
    [adminId,lastPaymentException.received_at,lastPaymentException.id],
  ))
  assert.equal(Number(secondPaymentExceptionPage.rows[0].page.total),3)
  assert.equal(secondPaymentExceptionPage.rows[0].page.events.length,1)
  const quarantinedPaymentExceptionPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_payment_exception_page($1,'quarantined',NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(quarantinedPaymentExceptionPage.rows[0].page.total),1)
  assert.equal(quarantinedPaymentExceptionPage.rows[0].page.events[0].processing_status,"quarantined")

  await expectDenied(
    "authenticated",adminId,
    "SELECT public.get_admin_withdrawal_page($1,NULL,NULL,NULL,50)",
    [adminId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_admin_withdrawal_page($1,NULL,NULL,NULL,50)",
      [buyerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstAdminWithdrawalPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_withdrawal_page($1,NULL,NULL,NULL,1) AS page",
    [adminId],
  ))
  assert.equal(Number(firstAdminWithdrawalPage.rows[0].page.total),2)
  assert.equal(Number(firstAdminWithdrawalPage.rows[0].page.pending_count),0)
  assert.equal(firstAdminWithdrawalPage.rows[0].page.withdrawals.length,1)
  const firstAdminWithdrawal=firstAdminWithdrawalPage.rows[0].page.withdrawals[0]
  const secondAdminWithdrawalPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_withdrawal_page($1,NULL,$2,$3,1) AS page",
    [adminId,firstAdminWithdrawal.requested_at,firstAdminWithdrawal.id],
  ))
  assert.equal(Number(secondAdminWithdrawalPage.rows[0].page.total),2)
  assert.equal(secondAdminWithdrawalPage.rows[0].page.withdrawals.length,1)
  assert.notEqual(secondAdminWithdrawalPage.rows[0].page.withdrawals[0].id,firstAdminWithdrawal.id)
  const paidAdminWithdrawalPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_withdrawal_page($1,'paid',NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(paidAdminWithdrawalPage.rows[0].page.total),1)
  assert.equal(paidAdminWithdrawalPage.rows[0].page.withdrawals[0].id,approvedWithdrawal.rows[0].id)
  assert.equal(paidAdminWithdrawalPage.rows[0].page.withdrawals[0].payout_attempts.length,1)
  const pendingAdminWithdrawalPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_withdrawal_page($1,'pending',NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(pendingAdminWithdrawalPage.rows[0].page.total),0)
  assert.deepEqual(pendingAdminWithdrawalPage.rows[0].page.withdrawals,[])
  await expectDenied(
    "authenticated",providerUserId,
    "SELECT public.get_provider_withdrawal_page($1,$2,NULL,NULL,50)",
    [providerUserId,providerId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_provider_withdrawal_page($1,$2,NULL,NULL,50)",
      [buyerId,providerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstProviderWithdrawalPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_provider_withdrawal_page($1,$2,NULL,NULL,1) AS page",
    [providerUserId,providerId],
  ))
  assert.equal(Number(firstProviderWithdrawalPage.rows[0].page.total),2)
  assert.equal(firstProviderWithdrawalPage.rows[0].page.withdrawals.length,1)
  const firstProviderWithdrawal=firstProviderWithdrawalPage.rows[0].page.withdrawals[0]
  const secondProviderWithdrawalPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_provider_withdrawal_page($1,$2,$3,$4,1) AS page",
    [providerUserId,providerId,firstProviderWithdrawal.requested_at,firstProviderWithdrawal.id],
  ))
  assert.equal(Number(secondProviderWithdrawalPage.rows[0].page.total),2)
  assert.equal(secondProviderWithdrawalPage.rows[0].page.withdrawals.length,1)
  assert.notEqual(secondProviderWithdrawalPage.rows[0].page.withdrawals[0].id,firstProviderWithdrawal.id)
  await expectDenied(
    "authenticated",buyerId,
    "SELECT public.get_refund_eligible_order_page($1,NULL,NULL,50)",
    [buyerId],
  )
  const eligibleRefundOrders=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_refund_eligible_order_page($1,NULL,NULL,50) AS page",
    [buyerId],
  ))
  assert.equal(Number(eligibleRefundOrders.rows[0].page.total),1)
  assert.equal(eligibleRefundOrders.rows[0].page.orders[0].id,orderId)
  assert.equal(Number(eligibleRefundOrders.rows[0].page.orders[0].active_refund_amount),0)
  assert.equal(Number(eligibleRefundOrders.rows[0].page.orders[0].available_refund_amount),80)
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.get_refund_request_page($1,true,NULL,NULL,NULL,50)",
    [adminId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_refund_request_page($1,true,NULL,NULL,NULL,50)",
      [buyerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstUserRefundPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_refund_request_page($1,false,NULL,NULL,NULL,2) AS page",
    [buyerId],
  ))
  assert.equal(Number(firstUserRefundPage.rows[0].page.total),4)
  assert.equal(Number(firstUserRefundPage.rows[0].page.open_count),0)
  assert.equal(firstUserRefundPage.rows[0].page.refunds.length,2)
  const lastUserRefund=firstUserRefundPage.rows[0].page.refunds.at(-1)
  const secondUserRefundPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_refund_request_page($1,false,NULL,$2,$3,2) AS page",
    [buyerId,lastUserRefund.requested_at,lastUserRefund.id],
  ))
  assert.equal(Number(secondUserRefundPage.rows[0].page.total),4)
  assert.equal(secondUserRefundPage.rows[0].page.refunds.length,2)
  const adminRefundPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_refund_request_page($1,true,NULL,NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(adminRefundPage.rows[0].page.total),4)
  assert.equal(adminRefundPage.rows[0].page.refunds.length,4)
  assert.ok(adminRefundPage.rows[0].page.refunds.every((refund)=>refund.requester.email==="buyer@example.test"))
  const unrelatedRefundPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_refund_request_page($1,false,NULL,NULL,NULL,50) AS page",
    [onboardingUserId],
  ))
  assert.equal(Number(unrelatedRefundPage.rows[0].page.total),0)
  assert.deepEqual(unrelatedRefundPage.rows[0].page.refunds,[])
  await expectDenied(
    "authenticated",buyerId,
    "SELECT public.get_dispute_eligible_order_page($1,NULL,NULL,50)",
    [buyerId],
  )
  const eligibleDisputeOrders=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_dispute_eligible_order_page($1,NULL,NULL,5) AS page",
    [buyerId],
  ))
  assert.equal(Number(eligibleDisputeOrders.rows[0].page.total),11)
  assert.equal(eligibleDisputeOrders.rows[0].page.orders.length,5)
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.get_dispute_page($1,true,NULL,NULL,NULL,50)",
    [adminId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_dispute_page($1,true,NULL,NULL,NULL,50)",
      [buyerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstUserDisputePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_dispute_page($1,false,NULL,NULL,NULL,1) AS page",
    [buyerId],
  ))
  assert.equal(Number(firstUserDisputePage.rows[0].page.total),2)
  assert.equal(Number(firstUserDisputePage.rows[0].page.open_count),0)
  assert.equal(firstUserDisputePage.rows[0].page.disputes.length,1)
  const firstUserDispute=firstUserDisputePage.rows[0].page.disputes[0]
  const secondUserDisputePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_dispute_page($1,false,NULL,$2,$3,1) AS page",
    [buyerId,firstUserDispute.updated_at,firstUserDispute.id],
  ))
  assert.equal(Number(secondUserDisputePage.rows[0].page.total),2)
  assert.equal(secondUserDisputePage.rows[0].page.disputes.length,1)
  assert.notEqual(secondUserDisputePage.rows[0].page.disputes[0].id,firstUserDispute.id)
  const adminDisputePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_dispute_page($1,true,NULL,NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(adminDisputePage.rows[0].page.total),2)
  assert.equal(adminDisputePage.rows[0].page.disputes.length,2)
  assert.ok(adminDisputePage.rows[0].page.disputes.every((dispute)=>dispute.opener.email))
  const unrelatedDisputePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_dispute_page($1,false,NULL,NULL,NULL,50) AS page",
    [onboardingUserId],
  ))
  assert.equal(Number(unrelatedDisputePage.rows[0].page.total),0)
  await expectDenied(
    "authenticated",buyerId,
    "SELECT public.get_dispute_evidence_page($1,$2,NULL,NULL,50)",
    [buyerId,firstDisputeId],
  )
  const disputeEvidencePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_dispute_evidence_page($1,$2,NULL,NULL,50) AS page",
    [buyerId,firstDisputeId],
  ))
  assert.equal(Number(disputeEvidencePage.rows[0].page.total),1)
  assert.equal(disputeEvidencePage.rows[0].page.evidence[0].storage_path,evidencePath)
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_dispute_evidence_page($1,$2,NULL,NULL,50)",
      [onboardingUserId,firstDisputeId],
    )),
    (error)=>error.code==="42501",
  )
  const pendingServiceId="30000000-0000-4000-8000-000000000010"
  const draftServiceId="30000000-0000-4000-8000-000000000011"
  await db.query(
    `INSERT INTO public.services(
      id,provider_id,name_ar,name_en,category,price,price_type,image_urls,moderation_status,provider_publish_intent
    ) VALUES
      ($1,$3,'خدمة معلقة','Pending Service','design',120,'fixed',ARRAY['https://example.test/pending.webp'],'pending_review',true),
      ($2,$3,'مسودة','Draft Service','writing',80,'fixed',ARRAY['https://example.test/draft.webp'],'draft',false)`,
    [pendingServiceId,draftServiceId,providerId],
  )
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.get_admin_service_page($1,NULL,'all',NULL,NULL,50)",
    [adminId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_admin_service_page($1,NULL,'all',NULL,NULL,50)",
      [buyerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstAdminServicePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_service_page($1,NULL,'all',NULL,NULL,2) AS page",
    [adminId],
  ))
  assert.equal(Number(firstAdminServicePage.rows[0].page.total),3)
  assert.equal(Number(firstAdminServicePage.rows[0].page.pending_count),1)
  assert.equal(firstAdminServicePage.rows[0].page.services.length,2)
  const lastAdminService=firstAdminServicePage.rows[0].page.services.at(-1)
  const secondAdminServicePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_service_page($1,NULL,'all',$2,$3,2) AS page",
    [adminId,lastAdminService.created_at,lastAdminService.id],
  ))
  assert.equal(Number(secondAdminServicePage.rows[0].page.total),3)
  assert.equal(secondAdminServicePage.rows[0].page.services.length,1)
  const pendingAdminServicePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_service_page($1,'Pending','pending_review',NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(pendingAdminServicePage.rows[0].page.total),1)
  assert.equal(pendingAdminServicePage.rows[0].page.services[0].id,pendingServiceId)
  await expectDenied(
    "authenticated",providerUserId,
    "SELECT public.get_provider_service_page($1,$2,NULL,'created_at','desc','en',NULL,NULL,NULL,NULL,12)",
    [providerUserId,providerId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_provider_service_page($1,$2,NULL,'created_at','desc','en',NULL,NULL,NULL,NULL,12)",
      [buyerId,providerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstProviderServicePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_provider_service_page($1,$2,'Service','price','asc','en',NULL,NULL,NULL,NULL,1) AS page",
    [providerUserId,providerId],
  ))
  assert.equal(Number(firstProviderServicePage.rows[0].page.total),3)
  assert.equal(firstProviderServicePage.rows[0].page.services.length,1)
  assert.equal(Number(firstProviderServicePage.rows[0].page.services[0].price),80)
  const firstProviderService=firstProviderServicePage.rows[0].page.services[0]
  const secondProviderServicePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_provider_service_page($1,$2,'Service','price','asc','en',NULL,$3,NULL,$4,1) AS page",
    [providerUserId,providerId,firstProviderService.price,firstProviderService.id],
  ))
  assert.equal(Number(secondProviderServicePage.rows[0].page.total),3)
  assert.equal(Number(secondProviderServicePage.rows[0].page.services[0].price),100)
  const nameProviderServicePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_provider_service_page($1,$2,'Service','name','asc','en',NULL,NULL,NULL,NULL,3) AS page",
    [providerUserId,providerId],
  ))
  assert.deepEqual(nameProviderServicePage.rows[0].page.services.map((service)=>service.name_en),[
    "Draft Service","Edited service","Pending Service",
  ])
  await expectDenied(
    "anon",null,
    "SELECT public.get_public_provider_service_page($1,NULL,NULL,12)",
    [providerId],
  )
  const publicProviderServices=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_public_provider_service_page($1,NULL,NULL,12) AS page",
    [providerId],
  ))
  assert.equal(Number(publicProviderServices.rows[0].page.total),1)
  assert.deepEqual(publicProviderServices.rows[0].page.services.map((service)=>service.id),[serviceId])
  const emptyPublicProviderServices=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_public_provider_service_page($1,NULL,NULL,12) AS page",
    [onboarding.rows[0].id],
  ))
  assert.equal(Number(emptyPublicProviderServices.rows[0].page.total),0)
  assert.deepEqual(emptyPublicProviderServices.rows[0].page.services,[])
  await expectDenied(
    "anon",null,
    "SELECT public.get_public_service_detail($1)",
    [serviceId],
  )
  const publicServiceDetail=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_public_service_detail($1) AS detail",
    [serviceId],
  ))
  assert.equal(publicServiceDetail.rows[0].detail.service.id,serviceId)
  assert.equal(publicServiceDetail.rows[0].detail.service.providers.id,providerId)
  assert.equal(publicServiceDetail.rows[0].detail.related_services.length,0)
  assert.equal(Object.hasOwn(publicServiceDetail.rows[0].detail.service,"moderation_note"),false)
  const unavailableServiceDetail=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_public_service_detail($1) AS detail",
    [pendingServiceId],
  ))
  assert.equal(unavailableServiceDetail.rows[0].detail,null)
  await expectDenied(
    "authenticated",buyerId,
    "SELECT public.get_public_provider_detail($1)",[providerId],
  )
  const publicProviderDetail=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_public_provider_detail($1) AS detail",[providerId],
  ))
  assert.equal(publicProviderDetail.rows[0].detail.id,providerId)
  assert.equal(publicProviderDetail.rows[0].detail.name_en,"Provider")
  assert.equal(Object.hasOwn(publicProviderDetail.rows[0].detail,"tap_destination_id"),false)
  const unavailableProviderDetail=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_public_provider_detail($1) AS detail",["20000000-0000-4000-8000-000000000099"],
  ))
  assert.equal(unavailableProviderDetail.rows[0].detail,null)
  await expectDenied(
    "authenticated",buyerId,
    "SELECT public.get_conversation_order_page($1,$2,NULL,NULL,50)",
    [buyerId,conversationId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_conversation_order_page($1,$2,NULL,NULL,50)",
      [onboardingUserId,conversationId],
    )),
    (error)=>error.code==="42501",
  )
  const firstConversationOrderPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_conversation_order_page($1,$2,NULL,NULL,5) AS page",
    [buyerId,conversationId],
  ))
  assert.equal(Number(firstConversationOrderPage.rows[0].page.total),12)
  assert.equal(firstConversationOrderPage.rows[0].page.orders.length,5)
  const lastConversationOrder=firstConversationOrderPage.rows[0].page.orders.at(-1)
  const secondConversationOrderPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_conversation_order_page($1,$2,$3,$4,5) AS page",
    [buyerId,conversationId,lastConversationOrder.created_at,lastConversationOrder.id],
  ))
  assert.equal(Number(secondConversationOrderPage.rows[0].page.total),12)
  assert.equal(secondConversationOrderPage.rows[0].page.orders.length,5)
  assert.ok(!firstConversationOrderPage.rows[0].page.orders.some((order)=>
    secondConversationOrderPage.rows[0].page.orders.some((second)=>second.id===order.id)))
  await db.query("UPDATE public.conversations SET seeker_cleared_at=clock_timestamp() WHERE id=$1",[conversationId])
  const clearedConversationOrders=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_conversation_order_page($1,$2,NULL,NULL,50) AS page",
    [buyerId,conversationId],
  ))
  assert.equal(Number(clearedConversationOrders.rows[0].page.total),0)
  const providerConversationOrders=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_conversation_order_page($1,$2,NULL,NULL,50) AS page",
    [providerUserId,conversationId],
  ))
  assert.equal(Number(providerConversationOrders.rows[0].page.total),12)
  await db.query("UPDATE public.conversations SET seeker_cleared_at=NULL WHERE id=$1",[conversationId])

  const adminOrderPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_admin_order_page($1,NULL,NULL,0,5)", [adminId]),
  )
  assert.equal(adminOrderPage.rows.length, 5)
  assert.equal(Number(adminOrderPage.rows[0].total_count), 12)
  const searchedAdminOrder = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_admin_order_page($1,$2,NULL,0,5)", [adminId,orderId]),
  )
  assert.equal(searchedAdminOrder.rows.length, 1)
  assert.equal(searchedAdminOrder.rows[0].id, orderId)
  const adminUserPage = await asRole("service_role", null, () =>
    db.query("SELECT * FROM public.get_admin_user_page($1,NULL,0,2)", [adminId]),
  )
  assert.equal(adminUserPage.rows.length, 2)
  assert.equal(Number(adminUserPage.rows[0].total_count), 4)
  const adminReport = await asRole("service_role", null, () =>
    db.query("SELECT public.export_admin_order_report($1,NULL,NULL,5000) AS report", [adminId]),
  )
  assert.equal(Number(adminReport.rows[0].report.row_count), 12)
  assert.equal(adminReport.rows[0].report.orders.length, 12)
  assert.equal(adminReport.rows[0].report.orders[0].service_snapshot.schema_version,1)
  assert.equal(adminReport.rows[0].report.orders[0].pricing_snapshot.schema_version,1)
  await assert.rejects(
    asRole("service_role", null, () =>
      db.query("SELECT public.export_admin_order_report($1,NULL,NULL,5)", [adminId]),
    ),
    (error) => error.code === "P0001",
  )
  await expectDenied(
    "authenticated",
    buyerId,
    "SELECT public.export_user_data_snapshot($1)",
    [buyerId],
  )
  await expectDenied(
    "service_role",
    null,
    "SELECT public.export_user_data_snapshot($1)",
    ["10000000-0000-4000-8000-000000000099"],
  )
  const buyerExport = await asRole("service_role", null, () =>
    db.query("SELECT public.export_user_data_snapshot_v10($1) AS snapshot", [buyerId]),
  )
  assert.equal(buyerExport.rows[0].snapshot.schema_version, 10)
  assert.equal(buyerExport.rows[0].snapshot.profile.location,"Riyadh")
  assert.equal(buyerExport.rows[0].snapshot.profile.bio,"Profile bio")
  assert.equal(buyerExport.rows[0].snapshot.orders_as_seeker.length, 12)
  assert.equal(buyerExport.rows[0].snapshot.orders_as_seeker[0].service_snapshot.schema_version,1)
  assert.equal(buyerExport.rows[0].snapshot.orders_as_seeker[0].pricing_snapshot.schema_version,1)
  assert.equal(buyerExport.rows[0].snapshot.messages_sent_and_received.length, 3)
  assert.equal(buyerExport.rows[0].snapshot.order_deliveries.length, 2)
  assert.ok(buyerExport.rows[0].snapshot.order_deliveries.some((delivery)=>delivery.files?.some((file)=>file.path===deliveryFilePath)))
  assert.equal(buyerExport.rows[0].snapshot.payment_attempts.length, 1)
  assert.equal(buyerExport.rows[0].snapshot.support_tickets.length, 1)
  assert.equal(buyerExport.rows[0].snapshot.support_ticket_messages.length, 2)
  assert.ok(buyerExport.rows[0].snapshot.notifications.length > 0)
  assert.equal(buyerExport.rows[0].snapshot.admin_actions_targeting_support.length, 1)
  assert.equal(buyerExport.rows[0].snapshot.ai_chat_sessions.length, 1)
  assert.equal(buyerExport.rows[0].snapshot.ai_chat_turns.length, 2)
  assert.equal(buyerExport.rows[0].snapshot.refund_requests.length, 4)
  assert.equal(buyerExport.rows[0].snapshot.refund_attempts.length, 2)
  assert.equal(buyerExport.rows[0].snapshot.refund_events.length, 3)
  assert.equal(buyerExport.rows[0].snapshot.admin_actions_targeting_refunds.length, 2)
  assert.equal(buyerExport.rows[0].snapshot.disputes.length, 2)
  assert.equal(buyerExport.rows[0].snapshot.dispute_evidence.length, 1)
  assert.equal(buyerExport.rows[0].snapshot.admin_actions_targeting_disputes.length, 3)
  const providerExport = await asRole("service_role", null, () =>
    db.query("SELECT public.export_user_data_snapshot_v10($1) AS snapshot", [providerUserId]),
  )
  assert.equal(providerExport.rows[0].snapshot.orders_as_provider.length, 12)
  assert.equal(providerExport.rows[0].snapshot.withdrawal_requests.length, 2)
  assert.equal(providerExport.rows[0].snapshot.ledger_entries.length, 16)
  assert.equal(providerExport.rows[0].snapshot.reviews_received.length, 10)
  assert.equal(providerExport.rows[0].snapshot.admin_actions_targeting_account.length, 11)
  assert.equal(providerExport.rows[0].snapshot.provider_verification_requests.length,1)
  assert.equal(providerExport.rows[0].snapshot.provider_verification_documents.length,1)
  assert.equal(providerExport.rows[0].snapshot.service_image_cleanup_jobs.length,1)
  assert.equal(providerExport.rows[0].snapshot.payout_attempts.length, 1)
  assert.equal(providerExport.rows[0].snapshot.admin_actions_targeting_payouts.length, 3)
  await expectDenied(
    "authenticated",
    onboardingUserId,
    "SELECT public.request_account_deletion($1)",
    [onboardingUserId],
  )
  const deletionRequest = await asRole("service_role", null, () =>
    db.query("SELECT public.request_account_deletion($1) AS request", [onboardingUserId]),
  )
  const repeatedDeletionRequest = await asRole("service_role", null, () =>
    db.query("SELECT public.request_account_deletion($1) AS request", [onboardingUserId]),
  )
  assert.equal(repeatedDeletionRequest.rows[0].request.id, deletionRequest.rows[0].request.id)
  assert.equal(await scalar("SELECT public.is_account_active($1)", [onboardingUserId]), true)
  assert.equal(
    await asRole("authenticated", onboardingUserId, async () =>
      scalar("SELECT count(*)::int FROM public.account_deletion_requests WHERE status='requested'"),
    ),
    1,
  )
  const deletionExport = await asRole("service_role", null, () =>
    db.query("SELECT public.export_user_data_snapshot_v10($1) AS snapshot", [onboardingUserId]),
  )
  assert.equal(deletionExport.rows[0].snapshot.account_deletion_requests.length, 1)
  await asRole("service_role", null, () =>
    db.query("SELECT public.cancel_account_deletion($1)", [onboardingUserId]),
  )
  assert.equal(await scalar("SELECT status FROM public.account_deletion_requests WHERE id=$1", [deletionRequest.rows[0].request.id]), "cancelled")
  const secondDeletionRequest = await asRole("service_role", null, () =>
    db.query("SELECT public.request_account_deletion($1) AS request", [onboardingUserId]),
  )
  assert.notEqual(secondDeletionRequest.rows[0].request.id, deletionRequest.rows[0].request.id)
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.get_admin_account_deletion_page($1,'all',NULL,NULL,50)",
    [adminId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.get_admin_account_deletion_page($1,'all',NULL,NULL,50)",
      [buyerId],
    )),
    (error)=>error.code==="42501",
  )
  const firstDeletionPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_account_deletion_page($1,'all',NULL,NULL,1) AS page",
    [adminId],
  ))
  assert.equal(Number(firstDeletionPage.rows[0].page.total),2)
  assert.equal(Number(firstDeletionPage.rows[0].page.requested_count),1)
  assert.equal(Number(firstDeletionPage.rows[0].page.processing_count),0)
  assert.equal(Number(firstDeletionPage.rows[0].page.failed_count),0)
  assert.equal(firstDeletionPage.rows[0].page.requests.length,1)
  const firstDeletion=firstDeletionPage.rows[0].page.requests[0]
  const secondDeletionPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_account_deletion_page($1,'all',$2,$3,1) AS page",
    [adminId,firstDeletion.requested_at,firstDeletion.id],
  ))
  assert.equal(Number(secondDeletionPage.rows[0].page.total),2)
  assert.equal(secondDeletionPage.rows[0].page.requests.length,1)
  assert.notEqual(secondDeletionPage.rows[0].page.requests[0].id,firstDeletion.id)
  const openDeletionPage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_account_deletion_page($1,'open',NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(openDeletionPage.rows[0].page.total),1)
  assert.equal(openDeletionPage.rows[0].page.requests[0].id,secondDeletionRequest.rows[0].request.id)
  await assert.rejects(
    asRole("service_role", null, () => db.query("SELECT public.request_account_deletion($1)", [providerUserId])),
    (error) => error.code === "P0001",
  )
  const knowledgeRequestId="e0000000-0000-4000-8000-000000000001"
  assert.equal(await scalar("SELECT count(*)::int FROM public.ai_knowledge_articles WHERE is_active"),5)
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.publish_ai_knowledge_version($1,$2,'marketplace','نطاق محدث','Updated scope','نص محدث','Updated body','Clarify marketplace scope')",
    [adminId,knowledgeRequestId],
  )
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.publish_ai_knowledge_version($1,$2,'marketplace','نطاق محدث','Updated scope','نص محدث','Updated body','Clarify marketplace scope')",
      [buyerId,knowledgeRequestId],
    )),
    (error)=>error.code==="42501",
  )
  const publishedKnowledge=await asRole("service_role",null,()=>db.query(
    "SELECT public.publish_ai_knowledge_version($1,$2,'marketplace','نطاق محدث','Updated scope','نص محدث','Updated body','Clarify marketplace scope') AS article",
    [adminId,knowledgeRequestId],
  ))
  const repeatedKnowledge=await asRole("service_role",null,()=>db.query(
    "SELECT public.publish_ai_knowledge_version($1,$2,'marketplace','نطاق محدث','Updated scope','نص محدث','Updated body','Clarify marketplace scope') AS article",
    [adminId,knowledgeRequestId],
  ))
  assert.equal(repeatedKnowledge.rows[0].article.id,publishedKnowledge.rows[0].article.id)
  assert.equal(Number(publishedKnowledge.rows[0].article.version),2)
  assert.equal(await scalar("SELECT count(*)::int FROM public.ai_knowledge_articles WHERE article_key='marketplace' AND is_active"),1)
  await assert.rejects(
    asRole("service_role",null,()=>db.query(
      "SELECT public.publish_ai_knowledge_version($1,$2,'marketplace','مختلف','Different','نص محدث','Updated body','Clarify marketplace scope')",
      [adminId,knowledgeRequestId],
    )),
    (error)=>error.code==="P0001",
  )
  await expectDenied(
    "authenticated",adminId,
    "SELECT public.get_admin_ai_knowledge_page($1,NULL,NULL,NULL,50)",
    [adminId],
  )
  const knowledgePage=await asRole("service_role",null,()=>db.query(
    "SELECT public.get_admin_ai_knowledge_page($1,'market',NULL,NULL,50) AS page",
    [adminId],
  ))
  assert.equal(Number(knowledgePage.rows[0].page.total),2)
  assert.equal(knowledgePage.rows[0].page.articles.length,2)
  const originalMarketplaceId=await scalar(
    "SELECT id FROM public.ai_knowledge_articles WHERE article_key='marketplace' AND version=1",
  )
  await asRole("service_role",null,()=>db.query(
    "SELECT public.set_ai_knowledge_version_active($1,$2,true,'Rollback after content review')",
    [adminId,originalMarketplaceId],
  ))
  assert.equal(await scalar("SELECT version FROM public.ai_knowledge_articles WHERE article_key='marketplace' AND is_active"),1)
  assert.equal(await scalar("SELECT count(*)::int FROM public.admin_audit_log WHERE action='ai_knowledge_publish'"),2)
  assert.equal(await scalar("SELECT version FROM public.get_active_ai_knowledge() WHERE article_key='marketplace'"),1)
  await expectDenied("service_role", null, "DELETE FROM public.admin_audit_log")

  console.log(`Database verification passed: ${migrations.length} migrations, fresh install, constraints and role isolation.`)
} finally {
  await db.close()
}
