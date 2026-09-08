import nextEnv from "@next/env"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { validateEnvironment } from "./environment.mjs"

nextEnv.loadEnvConfig(process.cwd())
const standalone = process.argv.includes("--standalone") ? "." : ".next/standalone"
let buildConfig
try {
  buildConfig = JSON.parse(readFileSync(path.join(standalone, "build-config.json"), "utf8"))
} catch {
  throw new Error("Production build metadata is missing. Run npm run build with the deployment's public configuration.")
}
if (buildConfig.mode !== "production" || !buildConfig.publicEnv) throw new Error("Refusing to start a smoke-test artifact as production")
const publicKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_ENABLE_ANALYTICS"]
for (const key of publicKeys) {
  if (typeof buildConfig.publicEnv[key] !== "string") throw new Error("Production build metadata is invalid. Rebuild before starting.")
  if (process.env[key] && process.env[key] !== buildConfig.publicEnv[key]) {
    throw new Error(`${key} differs from the compiled build. Rebuild for the intended environment.`)
  }
  process.env[key] = buildConfig.publicEnv[key]
}
const errors = validateEnvironment(process.env, { production: true })
if (errors.length) throw new Error(`Production environment validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`)

const child = spawn(process.execPath, [path.join(standalone, "server.js")], {
  stdio: "inherit", env: { ...process.env, NODE_ENV: "production" },
})
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
child.on("error", (error) => { console.error("Production server failed to start", error.message); process.exitCode = 1 })
child.on("exit", (code) => { process.exitCode = code ?? 1 })
