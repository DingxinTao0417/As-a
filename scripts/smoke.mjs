// Public-page smoke tests deliberately use an unreachable local Supabase instance.
// This artifact is never a deployable production build; run `npm run build` with real public config before deploying.
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { prepareStandalone } from "./prepare-standalone.mjs"

const mode = process.argv[2]
if (!["build", "serve"].includes(mode)) throw new Error("Usage: node scripts/smoke.mjs build|serve")
if (mode === "serve") {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once("error", () => reject(new Error("Smoke-test port 3107 is occupied; refusing to reuse or stop another service")))
    probe.listen(3107, "127.0.0.1", resolve)
  })
  await new Promise((resolve) => probe.close(resolve))
}
const env = {
  ...process.env,
  NODE_ENV: "production",
  ASAA_BUILD_TARGET: "smoke",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "smoke-anon-key-not-a-credential",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3107",
  NEXT_PUBLIC_ENABLE_ANALYTICS: "false",
  SUPABASE_SERVICE_ROLE_KEY: "",
  TAP_SECRET_KEY: "",
  TAP_PAYMENTS_ENABLED: "false",
  AI_CHAT_ENABLED: "false",
  DEEPSEEK_API_KEY: "",
  OPENAI_API_KEY: "",
}
const child = spawn(process.execPath, mode === "build"
  ? ["node_modules/next/dist/bin/next", "build"]
  : [".next-smoke/standalone/server.js"], {
  stdio: "inherit", env: { ...env, PORT: "3107", HOSTNAME: "127.0.0.1" },
})
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
child.on("exit", async (code) => {
  if (mode === "build" && code === 0) {
    prepareStandalone(".next-smoke", { mode: "smoke", env })
  }
  process.exitCode = code ?? 1
})
