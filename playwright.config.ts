import { defineConfig, devices } from "@playwright/test"

const port = 3107
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node scripts/smoke.mjs serve",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
