import { expect, test } from "@playwright/test"

test.describe("Authentication", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/auth/login")
    await expect(page.getByRole("heading")).toBeVisible()
  })

  test("unauthenticated user is redirected from protected routes", async ({ page }) => {
    await page.goto("/messages")
    await expect(page).toHaveURL(/\/auth\/login/)
  })

  test("unauthenticated user is redirected from admin", async ({ page }) => {
    await page.goto("/admin")
    await expect(page).toHaveURL(/\/auth\/login|\/$/)
  })
})
