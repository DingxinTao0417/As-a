# AI support integration

The implemented endpoint is `POST /api/chat` in `app/api/chat/route.ts`. The customer-service widgets in `components/` call this endpoint. Historical documentation describing `lib/ai-customer-service/` or `/api/ai-customer-service` was obsolete; those modules are not implemented.

Enable only after database migrations and staging tests:

```dotenv
AI_CHAT_ENABLED=true
AI_MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=<server-secret>
DEEPSEEK_MODEL=deepseek-chat
AI_MAX_TOKENS=500
AI_TEMPERATURE=0.7
SUPABASE_SERVICE_ROLE_KEY=<server-secret>
```

Alternatively set `AI_MODEL_PROVIDER=openai`, `OPENAI_API_KEY` and `AI_MODEL`. Endpoints are restricted to the two implemented provider hosts. No custom inference endpoint or local adapter loading is currently supported. `ai_services/` is experimental training data and adapters, not a hosted inference runtime.

Request shape:

```json
{"messages":[{"role":"user","content":"How can I find my orders?"}]}
```

The endpoint requires a valid active user session. It accepts 1–20 user/assistant text messages, at most 4,000 characters per message, 12,000 total characters and 32 KiB of incoming bytes. Client-supplied system messages are rejected. It checks Origin when supplied and uses the database `consume_rate_limit` function to enforce 10 requests/minute and 200/day per user across application instances. If the limiter fails, the model is not called. Apply edge/WAF limits as well for volumetric abuse and configure provider account budgets before enabling.

Upstream requests have a 20-second timeout and a maximum of 2,000 output tokens configured server-side. Statuses are 401 (sign in), 400/413/415 (invalid input), 403 (origin), 429 (rate limit, with Retry-After), 502 (upstream failure), and 503 (disabled or unavailable). Responses are not cacheable. Logs intentionally exclude prompts, secrets and upstream error bodies.

The assistant cannot read or modify private orders, verify payment, issue refunds, or act as human support. Conversations supplied in requests are sent to the configured AI provider. Review the actual provider terms, retention settings and privacy notice before enabling. `AI_CHAT_ENABLED=false` disables new chat requests immediately after the runtime environment change is applied.

Test the endpoint without external calls using `npm test -- tests/api/chat.test.ts`.
