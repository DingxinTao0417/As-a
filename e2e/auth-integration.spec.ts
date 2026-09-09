import { expect,test,type APIRequestContext } from "@playwright/test"

test.skip(process.env.SUPABASE_INTEGRATION!=="true","requires Supabase Local")

const mailpit=process.env.MAILPIT_URL||"http://127.0.0.1:54324"

async function waitForAuthLink(request:APIRequestContext,email:string,type:"signup"|"recovery"){
  for(let attempt=0;attempt<30;attempt+=1){
    const listResponse=await request.get(`${mailpit}/api/v1/messages`)
    expect(listResponse.ok()).toBeTruthy()
    const list=await listResponse.json()
    const messages=(list.messages||[]).filter((item:{To?:Array<{Address?:string}>})=>
      (item.To||[]).some(recipient=>recipient.Address===email))
    for(const message of messages){
      const detailResponse=await request.get(`${mailpit}/api/v1/message/${encodeURIComponent(message.ID)}`)
      const detail=await detailResponse.json()
      const matches=[...(detail.HTML||"").matchAll(/https?:\/\/[^\s"<>]+/g),
        ...(detail.Text||"").matchAll(/https?:\/\/[^\s"<>]+/g)]
      const link=matches.map((match:RegExpMatchArray)=>match[0].replaceAll("&amp;","&"))
        .find((value:string)=>{const url=new URL(value);return url.pathname==="/auth/v1/verify"&&url.searchParams.get("type")===type})
      if(link)return link
    }
    await new Promise(resolve=>setTimeout(resolve,200))
  }
  throw new Error(`Mailpit did not receive a ${type} link`)
}

test("completes email confirmation and one-time password recovery through the app callback",async({page,request})=>{
  test.setTimeout(90_000)
  await request.delete(`${mailpit}/api/v1/messages`)
  const email="browser-auth@as-a.local"
  const oldPassword="BrowserAuth!2026"
  const newPassword="BrowserAuth!2026-Recovered"

  await page.addInitScript(()=>window.localStorage.setItem("language","en"))
  await page.goto("/auth/signup")
  await page.getByLabel("Full Name").fill("Browser Auth")
  await page.getByLabel("Email",{exact:true}).fill(email)
  await page.getByLabel("Password",{exact:true}).fill(oldPassword)
  await page.getByLabel("Repeat Password").fill(oldPassword)
  await page.getByRole("checkbox").check()
  await page.getByRole("button",{name:"Sign up"}).click()
  await expect(page.getByRole("status")).toContainText("check your email")

  const confirmationLink=await waitForAuthLink(request,email,"signup")
  await page.goto(confirmationLink)
  await expect(page).toHaveURL(/^http:\/\/(?:127\.0\.0\.1|localhost):3107\/$/)
  await expect(page.getByRole("button",{name:"browser-auth"})).toBeVisible()
  await page.getByRole("button",{name:"browser-auth"}).click()
  await page.getByText("Logout",{exact:true}).click()
  await expect(page.getByRole("link",{name:"Login"})).toBeVisible()

  await page.goto("/auth/forgot-password")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button",{name:"Send reset link"}).click()
  await expect(page.getByRole("status")).toContainText("If an account exists")
  const recoveryLink=await waitForAuthLink(request,email,"recovery")
  await page.goto(recoveryLink)
  await expect(page).toHaveURL(/\/auth\/reset-password$/)
  await expect(page.getByLabel("New password")).toBeVisible()
  await page.getByLabel("New password").fill(newPassword)
  await page.getByLabel("Confirm password").fill(newPassword)
  await page.getByRole("button",{name:"Update password"}).click()
  await expect(page.getByRole("status")).toContainText("password has been updated")

  await page.goto("/")
  await page.getByRole("button",{name:"browser-auth"}).click()
  await page.getByText("Logout",{exact:true}).click()
  await expect(page.getByRole("link",{name:"Login"})).toBeVisible()
  await page.goto("/auth/login")
  await page.getByLabel("Email",{exact:true}).fill(email)
  await page.getByLabel("Password",{exact:true}).fill(oldPassword)
  await page.getByRole("button",{name:"Login",exact:true}).click()
  await expect(page.getByRole("alert")).toBeVisible()
  await page.getByLabel("Password",{exact:true}).fill(newPassword)
  await page.getByRole("button",{name:"Login",exact:true}).click()
  await expect(page).toHaveURL(/^http:\/\/(?:127\.0\.0\.1|localhost):3107\/$/)
  await expect(page.getByRole("button",{name:"browser-auth"})).toBeVisible()
})

test("resumes provider onboarding after confirmation and creates one provider profile",async({page,request})=>{
  test.setTimeout(60_000)
  await request.delete(`${mailpit}/api/v1/messages`)
  const email="browser-provider@as-a.local"
  const password="BrowserProvider!2026"
  await page.addInitScript(()=>window.localStorage.setItem("language","en"))
  await page.goto("/auth/signup?role=provider")
  await page.getByLabel("Full Name").fill("Browser Provider")
  await page.getByLabel("Email",{exact:true}).fill(email)
  await page.getByLabel("Password",{exact:true}).fill(password)
  await page.getByLabel("Repeat Password").fill(password)
  await page.getByRole("radio",{name:"Service Provider"}).check()
  await page.getByRole("checkbox").check()
  await page.getByRole("button",{name:"Sign up"}).click()
  await expect(page.getByRole("status")).toContainText("check your email")
  await page.goto(await waitForAuthLink(request,email,"signup"))
  await expect(page).toHaveURL(/\/register\/provider$/)

  await page.getByLabel("Name in Arabic").fill("مزود المتصفح")
  await page.getByLabel("Name in English").fill("Browser Provider")
  await page.getByLabel("Job Title in Arabic").fill("مصمم")
  await page.getByLabel("Job Title in English").fill("Designer")
  await page.getByLabel("Starting Price (SAR)").fill("100")
  await page.getByRole("button",{name:"Next"}).click()
  await page.getByText("Design",{exact:true}).click()
  await page.getByLabel("Skills").fill("Figma")
  await page.getByRole("button",{name:"Add skill"}).click()
  await page.getByRole("button",{name:"Next"}).click()
  await page.getByLabel("Bio in English").fill("Local browser integration provider")
  await page.getByRole("button",{name:"Create Service"}).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole("heading",{name:"Provider Dashboard"})).toBeVisible()
})
