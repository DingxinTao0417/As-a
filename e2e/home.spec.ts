import { expect, test } from "@playwright/test"

test.describe("Home Page", () => {
  test("loads successfully", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveTitle(/أسعى|As/i)
  })

  test("primary navigation exposes services", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("link", { name: /services|خدمات/i }).first()).toBeVisible()
  })
})
