import { expect, test } from "@playwright/test"

test.describe("Service catalog", () => {
  test("restores shareable filters from the URL", async ({ page }) => {
    await page.goto("/services/seeker?q=design&category=design&sort=rating&page=2")
    await expect(page.getByPlaceholder(/ابحث عن خدمة|Search for a service/i)).toHaveValue("design")
    await expect(page).toHaveURL(/q=design/)
    await expect(page).toHaveURL(/category=design/)
    await expect(page).toHaveURL(/sort=rating/)
    await expect(page).toHaveURL(/page=2/)
  })

  test("distinguishes a backend failure from an empty catalog and allows retry", async ({ page }) => {
    await page.goto("/services/seeker")
    await expect(page.getByRole("heading", { name: /تعذر تحميل الخدمات|Could not load services/i })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: /إعادة المحاولة|Try Again/i })).toBeVisible({ timeout: 30_000 })
  })

  test("public detail pages replace failed reads with an explicit retry state", async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto("/services/30000000-0000-4000-8000-000000000001")
    await expect(page.getByRole("heading", { name:/تعذر تحميل الخدمة|Could not load service/i })).toBeVisible({ timeout:15_000 })
    await expect(page.getByRole("button", { name:/إعادة المحاولة|Retry/i })).toBeVisible()

    await page.goto("/provider/20000000-0000-4000-8000-000000000001")
    await expect(page.getByRole("heading", { name:/تعذر تحميل مقدم الخدمة|Could not load provider/i })).toBeVisible({ timeout:15_000 })
    await expect(page.getByRole("button", { name:/إعادة المحاولة|Retry/i })).toBeVisible()
  })
})
