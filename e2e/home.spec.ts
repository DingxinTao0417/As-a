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

  test("language direction and theme persist across reloads",async({page})=>{
    await page.addInitScript(()=>{if(!window.localStorage.getItem("theme"))window.localStorage.setItem("theme","dark")})
    await page.goto("/")
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.getByRole("button",{name:/التبديل إلى الوضع الفاتح|Switch to light theme/i}).click()
    await expect(page.locator("html")).toHaveClass(/light/)
    await page.getByRole("button",{name:"EN",exact:true}).click()
    await expect(page.locator("html")).toHaveAttribute("lang","en")
    await expect(page.locator("html")).toHaveAttribute("dir","ltr")
    await page.reload()
    await expect(page.locator("html")).toHaveClass(/light/)
    await expect(page.locator("html")).toHaveAttribute("lang","en")
    await expect(page.locator("html")).toHaveAttribute("dir","ltr")
  })

  test("public entry pages do not overflow a 390px viewport",async({page})=>{
    await page.setViewportSize({width:390,height:844})
    for(const path of ["/","/about","/services/provider","/auth/login"]){
      await page.goto(path)
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true)
    }
  })
})
