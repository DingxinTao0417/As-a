import { expect, test } from "@playwright/test"

test.describe("Authentication", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/auth/login")
    await expect(page.locator("#email")).toBeVisible()
    await expect(page.locator("#password")).toHaveAttribute("autocomplete", "current-password")
    await expect(page.locator('a[href="/auth/forgot-password"]')).toBeVisible()
  })

  for (const route of ["/messages", "/dashboard", "/profile", "/favorites", "/history", "/refunds", "/disputes", "/my-services", "/verification", "/register/provider", "/support", "/notifications", "/admin", "/admin/orders", "/admin/withdrawals", "/admin/payments", "/admin/audit", "/admin/deletions", "/admin/support", "/admin/refunds", "/admin/disputes", "/admin/knowledge"]) {
    test(`anonymous visitors cannot access ${route}`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/auth\/login\?next=/)
      expect(new URL(page.url()).searchParams.get("next")).toBe(route)
    })
  }

  test("forgot password page is reachable from login", async ({ page }) => {
    await page.goto("/auth/login")
    await page.locator('a[href="/auth/forgot-password"]').click()
    await expect(page).toHaveURL(/\/auth\/forgot-password$/)
    await expect(page.locator("#email")).toBeVisible()
  })

  test("reset password requires a valid session", async ({ page }) => {
    await page.goto("/auth/reset-password")
    await expect(page.locator('p[role="alert"]')).toBeVisible()
    await expect(page.locator('a[href="/auth/forgot-password"]')).toBeVisible()
    await expect(page.locator("#password")).toHaveCount(0)
  })

  test("callback failure stays on this site even with an external next URL", async ({ page }) => {
    await page.goto("/auth/callback?next=https%3A%2F%2Fevil.example")
    await expect(page).toHaveURL(/\/auth\/login\?error=auth_callback_failed$/)
    await expect(page.locator('p[role="alert"]')).toBeVisible()
  })

  test("unknown routes provide a useful 404 page", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist")
    expect(response?.status()).toBe(404)
    await expect(page.getByRole("heading", { name: /^404$/ })).toBeVisible()
  })
})
