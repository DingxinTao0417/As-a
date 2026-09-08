import { cpSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import nextEnv from "@next/env"

export const publicConfigKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_ENABLE_ANALYTICS"]

export function prepareStandalone(distDir = ".next", { mode = "production", env = process.env } = {}) {
  if (![".next", ".next-smoke"].includes(distDir)) throw new Error("Unexpected build output directory")
  const standalone = path.join(distDir, "standalone")
  // Next's standalone output excludes public/static assets unless copied explicitly.
  cpSync(path.join(distDir, "static"), path.join(standalone, distDir, "static"), { recursive: true })
  cpSync("public", path.join(standalone, "public"), { recursive: true })
  mkdirSync(path.join(standalone, "scripts"), { recursive: true })
  for (const name of ["start.mjs", "environment.mjs", "check-env.mjs"]) {
    cpSync(path.join("scripts", name), path.join(standalone, "scripts", name), { recursive: true })
  }
  cpSync("node_modules/@next/env", path.join(standalone, "node_modules/@next/env"), { recursive: true })
  // Public values are compiled into client/server bundles. Never copy secret env values.
  const publicEnv = Object.fromEntries(publicConfigKeys.map((key) => [key, env[key] || (key === "NEXT_PUBLIC_ENABLE_ANALYTICS" ? "false" : "")]))
  writeFileSync(path.join(standalone, "build-config.json"), JSON.stringify({ mode, publicEnv }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  nextEnv.loadEnvConfig(process.cwd())
  if (process.env.VERCEL === "1" && process.env.ASAA_BUILD_TARGET !== "smoke") {
    console.log("Vercel adapter packages the deployment; standalone preparation skipped.")
  } else {
    prepareStandalone()
  }
}
