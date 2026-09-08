# As'aa / أسعى

Arabic/English professional-services marketplace built with Next.js App Router, Supabase Auth/PostgreSQL/Storage/Realtime, and Tap hosted checkout. Provider onboarding, moderated listings, conversations, orders, reviews, favorites and administrator review are implemented. AI assistance is optional and requires an authenticated account.

## Local setup

Use Node.js 24 LTS and npm. `package-lock.json` is the authoritative lockfile; the stale duplicate pnpm lockfile has been removed (the previous version remains recoverable in Git).

```sh
npm ci
```

Copy `.env.example` to `.env.local`, set the public Supabase URL/key and site origin, and use an isolated development Supabase project. Apply the reviewed database setup in [supabase/README.md](supabase/README.md). Set `SUPABASE_SERVICE_ROLE_KEY` only in server environment variables. Never expose it in `NEXT_PUBLIC_*`, browser code, screenshots or logs.

```sh
npm run dev
```

The default development port is 3000; choose another port with `npm run dev -- --port 3108` if it is occupied. Production deployment and operational acceptance are documented in [docs/production.md](docs/production.md).

## Verification without external accounts

```sh
npx playwright install chromium
npm run verify
```

`verify` runs lint, route/type generation, unit/route/UI tests, real PostgreSQL migration and authorization tests with PGlite, dependency audit, a production-mode smoke build, and Chromium tests. Browser tests start an isolated server on `127.0.0.1:3107`, reject an occupied port and stop their server afterward. The smoke build is isolated in `.next-smoke`, uses fake public configuration and an unreachable local Supabase URL, and does not replace production `.next`. It tests guest behavior and local boundaries; it cannot demonstrate real Auth, PostgREST, Storage, Realtime, SMTP or Tap integration. **Never deploy the smoke build.**

Focused commands: `npm test`, `npm run test:db`, `npm run test:e2e`, `npm run test:coverage`, `npm run typecheck`, `npm run lint`. Run `npm run build:smoke` before E2E tests after changing application code. Tests and coverage artifacts are ignored by Git. CI uses Node 24, executes the same checks and needs no production secrets.

## Production build

```sh
npm run check:env
npm run build
npm start
```

The environment preflight validates configuration without contacting services. `build` embeds public environment values, generates `.next/standalone` and copies public/static assets plus the validated startup entry point. `start` checks the public build metadata and server configuration before launching; it rejects smoke artifacts and mismatched runtime public values. Deployment services should provide runtime secrets directly; public values can be restored from build metadata. Rebuild for each different public Supabase project, site origin or analytics setting. An independently copied standalone folder uses `node scripts/start.mjs --standalone`.

Set `APP_ENV=staging` explicitly for HTTPS staging and Tap test keys. Production defaults to `APP_ENV=production` and only permits live Tap keys when payments are enabled. Both modes require server credentials and HTTPS; neither starts with development placeholders. Use `npm run dev` for local HTTP development.

A multi-stage [Dockerfile](Dockerfile) is included with a non-root runtime and `/api/health` liveness probe. It requires the three public build arguments and server secrets at runtime; consult the runbook. Docker execution still requires verification on a host with Docker installed.

## Financial and security boundaries

- `TAP_PAYMENTS_ENABLED=false` prevents new charges. Existing charge reconciliation remains available so disabling new checkout does not strand earlier successful payments. Tap webhooks use Tap's `hashstring` protocol and the same API secret; there is no separate `TAP_WEBHOOK_SECRET`.
- Amounts are decimal SAR with a 15% platform fee, calculated in integer minor units. Checkout uses database prices. No extra VAT is calculated by this code.
- Payout requests reserve available earnings atomically. Transfers are performed outside this application, then an administrator records the actual transfer reference. The app does not claim to provide automated marketplace payouts or regulated escrow.
- Administrator mutations run through a privileged transaction that checks the actor again and records a durable `admin_audit_log` entry. Browser administrators cannot erase audit entries.
- RLS and database triggers protect ownership and sensitive columns even when callers bypass the UI. Client edits return listings to moderation. Private contact fields are not in the public profile projection.
- Deleting an account creates a deletion request and disables access. It does not immediately erase authentication, messages, financial records or all stored files; operator retention/erasure handling is required.
- `AI_CHAT_ENABLED=false` by default. When enabled, chat enforces authentication, payload limits, shared per-user rate limits, provider timeouts and generic errors. Analytics is also opt-in.

See [AI_CUSTOMER_SERVICE_README.md](AI_CUSTOMER_SERVICE_README.md) for the actual AI integration. `ai_services/` contains experimental training artifacts; it is not a running production inference service and is excluded from Docker builds.
