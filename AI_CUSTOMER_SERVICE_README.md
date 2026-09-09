# AI customer service

The application exposes its help endpoint at `POST /api/chat`. Guest conversations are stateless. Signed-in conversations use database-backed sessions and idempotent turns, and the two clients restore completed turns after refresh. The floating site assistant is implemented by `components/global-customer-service.tsx`; `components/ai-chat.tsx` is a second reusable client for the same endpoint.

The endpoint supports DeepSeek and OpenAI-compatible chat-completion APIs. It provides general platform navigation and marketplace help and cannot perform business actions. Versioned knowledge comes from `ai_knowledge_articles`. Administrators publish, deactivate, or roll back bilingual versions from `/admin/knowledge`; every change requires a reason and is audited. If a signed-in user includes an order UUID, the server may add a minimal order-status snapshot only after verifying that the user is the client or provider on that order. Client-supplied history and order claims are never treated as authorization. Users who need administrator review must explicitly create a support ticket at `/support`; ticket replies and related updates are persisted and shown through `/notifications`, without a promised response time.

## Configuration

Configure server-side variables in `.env.local`:

```bash
AI_MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=replace-with-a-server-secret
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_ENDPOINT=https://api.deepseek.com
AI_MAX_TOKENS=500
AI_TEMPERATURE=0.7
```

To use OpenAI instead:

```bash
AI_MODEL_PROVIDER=openai
OPENAI_API_KEY=replace-with-a-server-secret
AI_MODEL=gpt-4o-mini
```

`AI_MAX_TOKENS` must be between 1 and 2000. `AI_TEMPERATURE` must be between 0 and 2. Keys must never use a `NEXT_PUBLIC_` prefix.

## Request contract

```json
{
  "messages": [
    { "role": "user", "content": "How do I find a provider?" }
  ],
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "sessionClientId": "22222222-2222-4222-8222-222222222222",
  "clientRequestId": "33333333-3333-4333-8333-333333333333",
  "language": "en"
}
```

The API accepts 1–20 `user` or `assistant` messages, with at most 4,000 characters per message and 16,000 characters in total. The latest message must be from the user. Client-supplied system messages, non-text parts, malformed JSON, and bodies over 64 KiB are rejected before the model is called. Signed-in clients send stable session and turn UUIDs; completed duplicate turns return the stored response without calling the model again. Model context is rebuilt from the last ten completed database turns, while restore returns up to fifty completed turns.

Guests receive eight requests per five minutes and signed-in users receive twenty. Limits are stored through the database `consume_rate_limit` function, so they apply across application instances. Guest identifiers are one-way hashes of proxy-provided network and user-agent values; raw IP addresses are not stored by this feature.

Upstream requests time out after 20 seconds. Configuration errors return 503, rate limits return 429, timeouts return 504, and upstream failures return 502. Logs contain only a stable failure category and HTTP status, not API keys, provider response bodies, or conversation text.

## Local model assets

`ai_services/` contains training data, adapter checkpoints, and experiment configuration. The Next.js runtime does not load or serve those files. A production local-model route would require a separately reviewed inference service, health checks, resource limits, evaluation, and deployment configuration before `AI_MODEL_PROVIDER` can point to it.

## Verification

Run:

```bash
npm test -- --run tests/api/chat.test.ts
npm run test:db
```

The API tests cover input validation, body limits, shared rate limiting, trusted knowledge, authenticated context replacement, owned-order injection, duplicate response reuse, configuration failure, and sanitized upstream errors. Database verification covers the shared rate-limit function, session ownership, retry state, knowledge versions, order isolation, and export. Real provider credentials and model quality remain sandbox acceptance work.
