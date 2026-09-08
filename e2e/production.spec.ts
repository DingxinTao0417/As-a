import { expect, test } from "@playwright/test"

test("production HTTP boundaries are present", async ({ request }) => {
  const health = await request.get("/api/health")
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: "ok" })
  expect(health.headers()["cache-control"]).toContain("no-store")
  const home = await request.get("/")
  expect(home.headers()["x-content-type-options"]).toBe("nosniff")
  expect(home.headers()["x-frame-options"]).toBe("DENY")
  expect(home.headers()["x-powered-by"]).toBeUndefined()
  const csp = home.headers()["content-security-policy"]
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).not.toContain("unsafe-eval")
  const chat = await request.post("/api/chat", { data: { messages: [{ role: "user", content: "hello" }] } })
  expect(chat.status()).toBe(503)
  expect(await chat.json()).toEqual({ error: "Chat service unavailable" })
})

test("mobile navigation and Arabic/English rendering work without runtime errors", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page.getByRole("link", { name: "ابحث عن محترف", exact: true }).locator("..")).toHaveCSS("opacity", "1")
  await page.screenshot({ path: testInfo.outputPath("home-ar-mobile.png"), fullPage: true })
  await page.getByRole("button", { name: "القائمة", exact: true }).click()
  await page.getByRole("button", { name: "English", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr")
  await expect(page.getByRole("link", { name: "Login", exact: true })).toBeVisible()
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(size.content).toBeLessThanOrEqual(size.viewport)
  await page.screenshot({ path: testInfo.outputPath("home-en-mobile.png"), fullPage: true })
  expect(errors).toEqual([])
})

test("desktop home hydrates with usable primary actions", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await page.getByRole("button", { name: "EN", exact: true }).click()
  await expect(page.getByRole("link", { name: "Find a Professional", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Find a Professional", exact: true }).locator("..")).toHaveCSS("opacity", "1")
  await page.screenshot({ path: testInfo.outputPath("home-en-desktop.png"), fullPage: true })
  expect(errors).toEqual([])
})
