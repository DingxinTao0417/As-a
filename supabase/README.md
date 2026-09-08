# Database installation and adoption

These SQL files define an auditable database contract reconstructed from repository queries. They do not describe or verify the current remote Supabase schema. No migration has been applied to a remote service by this change.

For a **new Supabase project**, apply `supabase/migrations` in filename order using a reviewed Supabase migration workflow. The initial migration deliberately refuses to run if application tables already exist. The following security migration refuses existing application policies, because an old permissive policy can bypass a newly added policy. Use a transaction for each migration and stop on any error.

For an **existing installation**, first back up the database and prove restore in a staging project. Run `checks/preflight.sql` read-only, obtain a schema-only dump and migration history, and compare every column, constraint, function, grant, policy, storage bucket and Realtime subscription with this contract. Explicitly reconcile differences in a new migration in staging. Never mark the baseline applied merely to get past its guard. Existing administrator grants and unknown SECURITY DEFINER functions need an independent review. Do not blindly drop policies, tables, or data to make this migration pass.

The historical Tap migration normalizes legacy integer cents into decimal SAR. It is retained for migration-history compatibility. Before adopting a legacy installation, verify units and disagreements between parallel cents/SAR columns against actual settled payment records; preserve a backup. Existing migrations already recorded as applied must not be rerun. Fresh installations already use decimal SAR and do not undergo a conversion.

`npm run test:db` runs actual PostgreSQL SQL through an in-memory PGlite database, with minimal Auth/Storage schemas and roles. It tests migrations, row and column authorization, deletion, money transitions and RPC privileges without connecting to Supabase. It does not replace staging tests against Supabase Auth, PostgREST, Storage MIME validation, Realtime, Tap sandbox, or concurrent database connections. Run those integration checks before release.

Account deletion is a **deletion request**, not physical erasure. It blocks active orders/withdrawals and unsettled provider earnings, disables authenticated access via RLS, hides provider listings, and removes public profile details. Auth identity, email, messages and financial history remain for a reviewed retention/erasure process. An operator must handle legal retention and eventual Auth/Storage erasure; the app must not claim that all copies were deleted immediately.

`public_profiles` intentionally projects only ID, display name and avatar. `profiles` with email/phone is limited to the owner and active administrators. Clients cannot create administrators, verify providers, publish listings, change order/payment fields or write money ledgers. Trusted server actions and service-only RPCs perform these operations. Service edits return listings to moderation.

Rate-limit buckets are atomic and private to the service role. Production maintenance should periodically delete expired `rate_limits` rows (for example older than 24 hours) using an authorized server maintenance job. No scheduled production job is enabled by these migrations. The expiry index supports that cleanup.

Storage bucket definitions restrict new buckets to JPEG/PNG/WebP and bounded size. Existing buckets are preserved by `ON CONFLICT DO NOTHING` and must be checked before release. Existing Storage policies also need review: policies combine permissively. Public object URLs are public by design; store no private documents in these buckets.
