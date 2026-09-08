export function validateEnvironment(env, { production = false } = {}) {
  const errors = []
  const appEnvironment = env.APP_ENV || "production"
  if (!["development", "staging", "production"].includes(appEnvironment)) errors.push("APP_ENV must be development, staging, or production")
  if (production && appEnvironment === "development") errors.push("Production server startup requires APP_ENV=staging or production")
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL"]
  if (production) required.push("SUPABASE_SERVICE_ROLE_KEY")
  const placeholder = /^(your-|replace|\*+$)|example\.(com|org)|your-project|smoke-anon|_xxx$/i
  for (const key of required) {
    const value = env[key]?.trim()
    if (!value || placeholder.test(value)) errors.push(`${key} is missing or contains a placeholder`)
  }
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SITE_URL"]) {
    try {
      const url = new URL(env[key])
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        errors.push(`${key} must be an HTTP(S) origin without a path, query, or credentials`)
      }
      if (production && (url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
        errors.push(`${key} must use a public HTTPS origin in production`)
      }
    } catch { errors.push(`${key} must be a valid URL`) }
  }
  for (const key of ["AI_CHAT_ENABLED", "TAP_PAYMENTS_ENABLED", "NEXT_PUBLIC_ENABLE_ANALYTICS"]) {
    if (env[key] && !["true", "false"].includes(env[key])) errors.push(`${key} must be true or false`)
  }
  if (env.TAP_PAYMENTS_ENABLED === "true") {
    const key = env.TAP_SECRET_KEY || ""
    if (!/^sk_(test|live)_.+/.test(key) || placeholder.test(key)) errors.push("TAP_SECRET_KEY must be configured when payments are enabled")
    if (appEnvironment === "production" && !key.startsWith("sk_live_")) errors.push("Production payments require a live Tap key; keep TAP_PAYMENTS_ENABLED=false until acceptance")
    if (appEnvironment === "staging" && !key.startsWith("sk_test_")) errors.push("Staging payments require a test Tap key")
    if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push("Payments require SUPABASE_SERVICE_ROLE_KEY")
  }
  if (env.AI_CHAT_ENABLED === "true") {
    const provider = env.AI_MODEL_PROVIDER || "deepseek"
    if (!["deepseek", "openai"].includes(provider)) errors.push("AI_MODEL_PROVIDER must be deepseek or openai")
    const keyName = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"
    if (!env[keyName] || placeholder.test(env[keyName])) errors.push(`${keyName} is required when chat is enabled`)
    if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push("Chat rate limiting requires SUPABASE_SERVICE_ROLE_KEY")
    const maxTokens = Number(env.AI_MAX_TOKENS || 500)
    const temperature = Number(env.AI_TEMPERATURE || 0.7)
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2000) errors.push("AI_MAX_TOKENS must be an integer between 1 and 2000")
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) errors.push("AI_TEMPERATURE must be between 0 and 2")
  }
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY === env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY) {
    errors.push("Public and service role keys must be different")
  }
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  if (publicKey.startsWith("sb_secret_")) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY must never contain a secret key")
  try {
    const payload = JSON.parse(Buffer.from(publicKey.split(".")[1] || "", "base64url").toString())
    if (payload.role === "service_role") errors.push("A service role key must never be exposed through NEXT_PUBLIC_SUPABASE_ANON_KEY")
  } catch { /* Supabase publishable keys are not JWTs. */ }
  if (env.ASAA_BUILD_TARGET && env.ASAA_BUILD_TARGET !== "production") errors.push("ASAA_BUILD_TARGET is reserved for isolated smoke builds")
  return errors
}
