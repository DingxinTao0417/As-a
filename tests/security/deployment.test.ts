// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, cpSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { validateEnvironment } from "@/scripts/environment.mjs"

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://database.supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_fixture_public_value",
  NEXT_PUBLIC_SITE_URL: "https://marketplace.test",
  NEXT_PUBLIC_ENABLE_ANALYTICS: "false",
}
const configuredEnv = { ...publicEnv, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture_server_value", TAP_PAYMENTS_ENABLED: "false", AI_CHAT_ENABLED: "false" }
const temporaryParent = realpathSync(os.tmpdir())
const fixtures: string[] = []
const startScript = path.resolve("scripts/start.mjs")
function runStart(mode: string, overrides: Record<string, string> = {}, withSecret = true, packaged = false) {
  const folder = mkdtempSync(path.join(temporaryParent, "asaa-start-test-"))
  fixtures.push(folder)
  const standalone = packaged ? folder : path.join(folder, ".next", "standalone")
  mkdirSync(standalone, { recursive: true })
  writeFileSync(path.join(standalone, "build-config.json"), JSON.stringify({ mode, publicEnv }))
  writeFileSync(path.join(standalone, "server.js"), "console.log('validated-fixture-server-started')")
  let entry = startScript
  if (packaged) {
    mkdirSync(path.join(folder, "scripts"))
    for (const name of ["start.mjs", "environment.mjs", "check-env.mjs"]) cpSync(path.resolve("scripts", name), path.join(folder, "scripts", name))
    cpSync(path.resolve("node_modules/@next/env"), path.join(folder, "node_modules/@next/env"), { recursive: true })
    entry = path.join(folder, "scripts/start.mjs")
  }
  return spawnSync(process.execPath, [entry, ...(packaged ? ["--standalone"] : [])], {
    cwd: folder,
    encoding: "utf8",
    timeout: 5000,
    env: {
      NODE_ENV: "production",
      ...(withSecret ? { SUPABASE_SERVICE_ROLE_KEY: configuredEnv.SUPABASE_SERVICE_ROLE_KEY } : {}),
      ...overrides,
    },
  })
}
afterAll(() => {
  for (const folder of fixtures) {
    if (path.dirname(folder) !== temporaryParent || !path.basename(folder).startsWith("asaa-start-test-")) throw new Error("Unexpected cleanup target")
    rmSync(folder, { recursive: true, force: true })
  }
})

describe("production environment validation", () => {
  it("accepts structurally configured production values without any network call", () => {
    expect(validateEnvironment(configuredEnv, { production: true })).toEqual([])
  })
  it("requires server credentials at runtime", () => {
    expect(validateEnvironment(publicEnv, { production: true })).toContain("SUPABASE_SERVICE_ROLE_KEY is missing or contains a placeholder")
  })
  it("rejects secret keys accidentally exposed as public configuration without echoing them", () => {
    const errors = validateEnvironment({ ...configuredEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_do_not_echo" }, { production: true })
    expect(errors.some((error: string) => error.includes("secret key"))).toBe(true)
    expect(errors.join(" ")).not.toContain("do_not_echo")
  })
  it("rejects HTTP production origins and isolated smoke selection", () => {
    const errors = validateEnvironment({ ...configuredEnv, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3107", ASAA_BUILD_TARGET: "smoke" }, { production: true })
    expect(errors).toHaveLength(2)
  })
  it("permits test payments on explicitly configured HTTPS staging", () => {
    expect(validateEnvironment({ ...configuredEnv, APP_ENV: "staging", TAP_PAYMENTS_ENABLED: "true", TAP_SECRET_KEY: "sk_test_fixture_value" }, { production: true })).toEqual([])
  })
  it("rejects test payments on production and live payments on staging", () => {
    expect(validateEnvironment({ ...configuredEnv, TAP_PAYMENTS_ENABLED: "true", TAP_SECRET_KEY: "sk_test_fixture_value" }, { production: true })).toContain("Production payments require a live Tap key; keep TAP_PAYMENTS_ENABLED=false until acceptance")
    expect(validateEnvironment({ ...configuredEnv, APP_ENV: "staging", TAP_PAYMENTS_ENABLED: "true", TAP_SECRET_KEY: "sk_live_fixture_value" }, { production: true })).toContain("Staging payments require a test Tap key")
  })
  it("keeps HTTPS and private credentials mandatory on staging", () => {
    const errors = validateEnvironment({ ...publicEnv, APP_ENV: "staging", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3107" }, { production: true })
    expect(errors).toContain("SUPABASE_SERVICE_ROLE_KEY is missing or contains a placeholder")
    expect(errors).toContain("NEXT_PUBLIC_SITE_URL must use a public HTTPS origin in production")
  })
})

describe("production startup gate", () => {
  it("refuses a smoke artifact before launching the server", () => {
    const result = runStart("smoke")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Refusing to start a smoke-test artifact")
    expect(result.stdout).not.toContain("validated-fixture-server-started")
  })
  it("refuses runtime public configuration from a different deployment", () => {
    const result = runStart("production", { NEXT_PUBLIC_SITE_URL: "https://other-marketplace.test" })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("differs from the compiled build")
  })
  it("refuses missing server credentials", () => {
    const result = runStart("production", {}, false)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY is missing")
  })
  it("loads the build's public configuration and starts a validated artifact", () => {
    const result = runStart("production")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("validated-fixture-server-started")
  })
  it("runs from the same isolated script/dependency layout used by the Docker image", () => {
    const result = runStart("production", {}, true, true)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("validated-fixture-server-started")
  })
  it("starts an explicit staging deployment with sandbox payment credentials", () => {
    const result = runStart("production", { APP_ENV: "staging", TAP_PAYMENTS_ENABLED: "true", TAP_SECRET_KEY: "sk_test_fixture_value" })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("validated-fixture-server-started")
  })
})
