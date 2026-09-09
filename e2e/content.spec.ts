import { expect, test } from "@playwright/test"

test.describe("Public content integrity", () => {
  test("does not publish placeholder registrations, contacts, or invented platform statistics", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByText(/XXXXXXXXXX|support@asa\.sa/)).toHaveCount(0)

    await page.goto("/about")
    await expect(page.getByText(/5,000\+|12,000\+|98%|٥٠٠٠|١٢٠٠٠|٩٨٪/)).toHaveCount(0)
  })

  test("labels paid provider plans as unavailable and exposes no inert purchase button", async ({ page }) => {
    await page.goto("/services/provider")
    await expect(page.getByRole("heading", {
      name: /التسجيل متاح، والباقات المدفوعة غير مطروحة بعد|Registration Is Available; Paid Plans Are Not Yet Offered/i,
    })).toBeVisible()
    await expect(page.getByRole("button", { name: /اختر هذه الباقة|Choose This Plan/i })).toHaveCount(0)
  })

  test("visible public buttons have an accessible name",async({page})=>{
    for(const path of ["/","/about","/services/provider","/auth/login","/auth/signup"]){
      await page.goto(path)
      const unlabeled=await page.locator("button").evaluateAll((buttons)=>buttons.filter((button)=>{
        const element=button as HTMLElement
        if(!element.offsetParent)return false
        const labelledBy=element.getAttribute("aria-labelledby")
        const referencedLabel=labelledBy?.split(/\s+/).some((id)=>document.getElementById(id)?.textContent?.trim())
        const explicitLabel=element.id?document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim():""
        const wrappingLabel=element.closest("label")?.textContent?.trim()
        return !element.innerText.trim()&&!element.getAttribute("aria-label")&&!element.getAttribute("title")&&!referencedLabel&&!explicitLabel&&!wrappingLabel
      }).map((button)=>button.outerHTML.slice(0,200)))
      expect(unlabeled,`Unlabeled buttons on ${path}`).toEqual([])
    }
  })
})
