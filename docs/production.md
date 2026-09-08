# Production deployment and acceptance

This change prepares the repository for a reviewed release. It does **not** assert that a remote deployment, merchant account, database, email provider, legal policy or recovery plan has been validated. No commit, push, remote migration, paid resource, transfer or deployment was performed by this work.

## Environment isolation and release gates

Use separate development, staging and production Supabase projects and application environments. Never run smoke tests, migration experiments, training jobs or model experiments against a live database. Production defaults keep new payments, AI chat and analytics disabled. Keep them disabled until their acceptance steps pass.

Before a public launch, record the actual operator, domain, support channel, privacy and terms approval, refund/dispute handling, retention policy and financial operations owner. Public pages no longer claim made-up user counts, tax registrations, guaranteed escrow or unimplemented subscription plans. These edits do not constitute legal approval. The repository does not establish regulatory eligibility or tax treatment.

Required release evidence:

| Gate | Evidence to record |
| --- | --- |
| Repository checks | `npm run verify` output on Node 24, clean dependency audit, reviewed diff |
| Database | Backup/restore proof; applied migration history; RLS, Storage and RPC acceptance on the target staging project |
| Authentication | Real signup/confirmation, login/logout, refresh, recovery and deletion-request tests using multiple roles |
| Marketplace | Create provider → submit listing → administrator review → search → conversation → actual order workflow |
| Payment | Tap sandbox capture, failure, abandonment, duplicate callbacks and recovery after a lost callback; match provider records to database |
| Financial operations | Approved merchant/KYC details, live credentials, reconciliation owner, manual transfer reference and refund/dispute procedure |
| Public operations | Verified domain/contact/policies, HTTPS, error alerts, database backups and restore exercise |

## Configuration

Use `.env.example` as the variable inventory. Public values are embedded into the client and must be configured **before** building. Secret variables are runtime-only and must be provisioned using the hosting provider's secret store, never Docker build arguments.

`npm run check:env` checks HTTPS origins, missing/placeholder configuration, payment mode and accidental public service-role secrets without contacting a service. It cannot establish that a credential works or a database has been migrated. Set `APP_ENV=staging` for staging: enabled payments must use test keys. The default `APP_ENV=production` requires live keys for enabled payments. Both require HTTPS and server credentials. Ordinary `npm run build` validates public build configuration; the production preflight is a separate required step.

Set `NEXT_PUBLIC_SITE_URL` to the exact canonical HTTPS origin without a path. Set Supabase Auth's Site URL and redirect allow-list to the real environments. Permit `/auth/callback` for signup and password recovery, including the callback query used by the app. Do not add an unrestricted wildcard covering arbitrary customer-controlled domains. Test email confirmation and recovery on a real browser; PKCE links need the initiating browser's verifier cookie. Configure and verify an SMTP sender and delivery controls in Supabase before opening registration to the public.

Set `SUPABASE_SERVICE_ROLE_KEY` only server-side. Tap uses `TAP_SECRET_KEY` to sign the webhook as documented by [Tap's webhook protocol](https://developers.tap.company/docs/webhook); remove any obsolete separate `TAP_WEBHOOK_SECRET` deployment variable. Use test keys in staging. Keep old charge reconciliation running when new checkout is disabled. Never swap test/live keys in a shared order database.

## Database rollout

Read [the database adoption guide](../supabase/README.md) first. The baseline intentionally refuses an existing application schema, and security migrations refuse unknown existing policies. For a new project, apply all migrations in filename order through the reviewed Supabase migration workflow. For an existing project, run [preflight.sql](../supabase/checks/preflight.sql) read-only, compare its actual schema and grants, and rehearse explicit adoption migrations on a restored staging copy. Do not bypass guards by dropping data or blindly marking migrations applied.

The legacy Tap migration contains a cents-to-SAR conversion. It must never be rerun against a database where migration history already records it. Verify actual monetary units and constraints before any adoption. Do not infer units from column names alone.

Create the first administrator only through an explicitly authorized operator database action on a verified user's UUID, after checking the account's email and ownership. Never trust signup metadata to grant administration. Subsequent grants and moderation actions use the in-app administrative transaction and write `admin_audit_log`. Review audit records without deleting them. Manual changes outside the application require separate operator change records.

Check that `messages`, `conversations` and `orders` are in the `supabase_realtime` publication. Confirm two distinct browser sessions receive new messages and order changes without seeing other users' records. Verify the `avatars` and `service-images` buckets enforce their MIME/size/owner rules through the Storage API; PGlite tests emulate the SQL layer, not the Storage gateway.

## Hosting

### Vercel with Supabase

Create/configure a dedicated application only when deployment is authorized. Choose Node 24 and the Next.js preset, use `npm ci` and `npm run build`, and scope variables separately to preview/staging/production. Run production environment validation in the release pipeline. Build a fresh artifact with the intended environment's public values. Smoke artifacts are isolated in `.next-smoke` and must never be deployed; production output is `.next`. Attach the approved HTTPS domain and validate security headers on actual responses.

### Docker or another Node host

The included Dockerfile builds a standalone app and runs as a non-root user. Supply `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL` as public build arguments; supply runtime secrets through the container platform. The startup gate reads public build metadata, rejects mismatched runtime public values and validates secrets before starting. You can copy `.next/standalone` independently and run `node scripts/start.mjs --standalone` inside it. Bind the app behind an HTTPS reverse proxy, set appropriate request/body/time limits, and keep the database/service keys outside the image. Container traffic uses port 3000 internally; choose an unused host port. The public `/api/health` probe reports process liveness only, not database, payment or email readiness.

Docker was not available in the local validation host. Build/run the image and test shutdown, asset serving, permissions and health checks on the target platform before relying on this deployment path. `npm run build` plus `npm start` is the alternative standalone Node path.

## Acceptance scenarios

Use a buyer, provider, administrator and unrelated user in staging. Verify that clients cannot edit `is_admin`, payment state, provider verification, review ownership or another person's messages through direct REST calls. Check inactive/deletion-requested accounts using an existing JWT, not just after logout.

For payments, test duplicate checkout clicks, invalid amounts, non-SAR records, a captured charge belonging to another order, wrong webhook signatures, modified unsigned metadata, a lost browser redirect, repeated and late callbacks, and an unavailable database during the callback. Tap retries or an operator reconciliation must resolve failed delivery; do not assume the redirect alone proves payment. Compare each captured charge, amount, currency and merchant mode with the order row. Follow [Tap's idempotency recommendations](https://developers.tap.company/docs/recommendations-best-practices).

For withdrawals, issue overlapping requests against the same provider with **separate PostgreSQL connections** and verify pending/approved/completed amounts cannot exceed earnings. PGlite exercises row-lock transactions and rollback but has a single connection and does not prove multi-session race behavior. A pending request reserves funds. A reviewer may reject it or mark it completed only after checking the external transfer and recording its reference. No automatic transfer is initiated by this application.

An unpaid order can be cancelled by a participant only before checkout has started. `checkout_started_at` is set atomically before contacting Tap, and cancellation locks the same order. A non-null timestamp with no charge ID can represent an unknown external result, including a lost network response. Investigate the merchant record and idempotency reference; never clear this marker merely to allow cancellation or account deletion. The UI keeps such orders pending reconciliation.

Verify service edits return the listing to moderation, data export is complete or explicitly fails, and deletion requests reject active orders/withdrawals and unwithdrawn provider earnings. Deletion is access disablement plus a request; Auth identities, financial history and files need an approved retention/erasure process. Do not tell a customer all data was physically erased by the button.

## Operations and rollback

Configure hosting error/latency alerts and external liveness checks. Monitor failed Tap callbacks, payment verification failures, reconciliation backlog, pending withdrawals, failed database actions and chat 429/5xx rates. This code includes structured or sanitized server logs; it does not configure a Sentry project or an alert receiver. Preserve operational logs and administrator audit records under the approved retention policy.

Before enabling AI, set provider spending limits and edge/WAF limits. The application enforces per-user shared limits and bounded requests but cannot prevent volumetric traffic from reaching the hosting edge. Periodically clean expired rate-limit rows through an authorized maintenance workflow. No paid monitoring, scheduler or maintenance automation is enabled by this repository change.

Record the deployed revision and public build configuration. Keep the previous release artifact available. To stop new financial activity, set `TAP_PAYMENTS_ENABLED=false` while preserving the same Tap credentials for existing charge reconciliation; do not delete unsettled orders. Disable chat independently using `AI_CHAT_ENABLED=false`. Roll back application code only to a version compatible with the current schema. Never reverse monetary migrations, restore an old database over newer captured payments, or delete audit/history records as a rollback shortcut. Reconcile external captures and transfers before any database restore decision.

## Local verification record

The local validation record and remaining release blockers are summarized in [readiness.md](readiness.md). Local checks do not authorize deployment or substitute for the staging evidence above.
