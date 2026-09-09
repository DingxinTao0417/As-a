# As'a

As'a is a bilingual Arabic and English professional-services marketplace built with Next.js, React, TypeScript, Supabase, and a Tap payment adapter. The interface supports persistent Arabic/English direction and system/light/dark themes. The current local implementation includes account authentication, provider onboarding, moderated service listings, catalog search, favorites, messaging, quotes and orders, versioned delivery and revisions, reviews, payment/refund event tracking, disputes with private evidence, provider ledger and payout tracking, support tickets, notifications, administrator controls, operational reporting, data export, and cancellable account-deletion requests.

Payment onboarding, real charges, refunds, payouts, subscriptions, human support, and public deployment are not enabled by this repository alone. They require approved product rules, provider sandbox credentials, and environment-specific acceptance before release. The detailed implementation state and remaining work are tracked in [功能补全实施规划.md](功能补全实施规划.md).

## Requirements

- Node.js 20.19, 22.13, or 24 and later, as declared in `package.json`
- npm; `package-lock.json` is the only lockfile used by this project
- A Supabase project for authenticated integration testing
- Tap and AI credentials only when deliberately testing those external features

The repository includes `.nvmrc` with the Node 20 baseline.

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Configure these Supabase values before testing authenticated pages:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`SUPABASE_SERVICE_ROLE_KEY`, `TAP_SECRET_KEY`, `TAP_MARKETPLACE_SECRET_KEY`, webhook secrets, and AI keys are server-only and must never use a `NEXT_PUBLIC_` prefix.

Keep `TAP_MARKETPLACE_ENABLED=false` until Tap has issued Marketplace credentials for an isolated test account. When enabled, provider status is retrieved from Tap with the separate Marketplace secret; a stored local onboarding flag never authorizes a withdrawal. Keep `TAP_PAYMENTS_ENABLED=false` until the selected Tap merchant sandbox has passed charge and callback acceptance. `TAP_PAYMENT_RECONCILIATION_ENABLED` separately allows administrators to retrieve an already recorded Charge and persist its observation; it never creates a Charge. Keep `TAP_REFUNDS_ENABLED=false` until partial/full refunds, signed refund webhooks, pending/accepted reconciliation, and merchant-wallet behavior are verified. `TAP_PAYOUT_RECONCILIATION_ENABLED` controls whether administrators may persist an externally verified payout result; it does not initiate a payout. With a gate disabled, the corresponding action returns an explicit unavailable result and does not create an external transaction.

## Database

The ordered files in `supabase/migrations/` define the fresh-install application contract. Run the local isolated verification with:

```bash
npm run test:db
```

Do not apply the fresh baseline to an existing Supabase project without a schema-only inventory, backup and restore exercise, and a reviewed adoption migration. Existing policies combine permissively in PostgreSQL and unknown policies must not be silently retained. Existing Tap amounts must be reconciled against settled transaction evidence before any cents/SAR conversion.

See [supabase/README.md](supabase/README.md) for installation and adoption rules, [docs/base-01-database-and-config-inventory.md](docs/base-01-database-and-config-inventory.md) for the read-only remote inventory, and [docs/operations-runbook.md](docs/operations-runbook.md) for release, reconciliation, incident, backup and recovery procedures.

No command in the normal local test workflow writes to the configured remote database.

## Verification

Run the same checks used by CI:

```bash
npm run lint
npm run check:boundaries
npx tsc --noEmit --incremental false
npm test
npm run test:db
npm run build
npm run test:e2e
```

For a gateway-level local integration run, start Docker and execute:

```bash
npm run supabase:start
supabase db reset
npm run test:supabase
npm run lint:db
npm run test:e2e:supabase
npm run supabase:stop
```

`supabase:start` uses a temporary empty Docker credential configuration only while pulling public Supabase images, avoiding a stalled desktop credential helper without modifying `~/.docker/config.json`. The tests create disposable local Auth users and verify one-time email confirmation/recovery, password lifecycle, provider onboarding, PostgREST grants/RLS, public/private Storage ownership, trusted order/delivery/verification/dispute flows and Realtime using the ephemeral keys returned by `supabase status`. `lint:db` fails on any PL/pgSQL warning in the final public schema. Reset the local database before each run. These commands do not connect to a hosted Supabase project.

`npm run test:e2e` builds the application on port 3107 with unreachable Supabase placeholders and covers public rendering, protected-route redirects, authentication forms, catalog failure states, theme/language persistence, accessible public buttons and 390px overflow. The ten Docker-backed scenarios are skipped in that default run. `npm run test:e2e:supabase` injects Supabase Local credentials and verifies real Auth/provider onboarding, administrator review, service and order lifecycles, provider verification, authenticated data export, account-deletion request/cancellation, partial refunds, private files, Realtime updates, and the administrator support handoff through the production server. Tap and AI provider integration still require their separate sandboxes.

## Main application areas

- `/services/seeker`: server-filtered service catalog
- `/services/[id]` and `/provider/[id]`: public service details and provider profiles with cursor-paged approved services
- `/messages`: server-filtered and cursor-paged conversations/messages/orders, unread state, quotes, payment entry, versioned delivery with private files, and revision review
- `/my-services`: cursor-paged provider service drafts, images, reviews, moderation submission and publication intent
- `/verification`: provider verification requests, private supporting documents and review history
- `/dashboard`: paged provider orders, refund/dispute workload, ledger-derived available/reserved/paid balances and cursor-paged payout history
- `/history`: customer order history and eligible reviews
- `/favorites`: cursor-paged provider favorites with unavailable-target handling
- `/refunds`: customer full/partial refund requests, database-derived eligible balances and cursor-paged status history
- `/disputes`: cursor-paged participant dispute records and private evidence
- `/profile`: profile management, streamed JSON/private-file data archives and deletion-request lifecycle
- `/support`: user-created support tickets and administrator replies
- `/notifications`: message, order, withdrawal and support updates
- `/admin`: aggregate operations summary plus service/provider/withdrawal/order controls, paged service/provider/withdrawal/order/user search, bounded JSON order export, refund/dispute/support queues, cursor-paged payment exceptions, audit history and cursor-paged deletion queue and versioned assistant-knowledge publishing
- `/api/webhooks/tap`: signed Tap event ingestion
- `/api/jobs/payment-reconciliation`: secret-protected, gated reconciliation of existing stale Tap Charges
- `/api/user-data-export`: authenticated, no-store streaming `tar.gz` export with JSON and private files
- `/api/chat`: bounded general-help assistant

Routes and server actions enforce the authoritative role from `profiles.role`. Administrator, money, moderation, account-status, and order transitions use trusted server RPCs that re-check the actor inside the transaction.

## AI assistant

Guest help conversations are stateless; signed-in conversations restore completed database turns. The assistant uses versioned platform knowledge and can receive a minimal owned-order status only after server-side participant verification. It cannot modify account or business data. Users can explicitly move an issue to the persisted support-ticket queue; no support response time is promised. Configuration, request limits, failure behavior, and the status of local adapter assets are documented in [AI_CUSTOMER_SERVICE_README.md](AI_CUSTOMER_SERVICE_README.md).

## Delivery and release boundary

Local green checks establish the code and fresh-database contract only. Before public release, complete the remaining roadmap decisions and validate email redirects, RLS through Supabase gateways, Realtime reconnect behavior, private file storage, Tap sandbox callbacks and reconciliation, refunds and payouts, AI provider quality, backup/restore, monitoring, legal entity details, tax/refund rules, and official support channels.
