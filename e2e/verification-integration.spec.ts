import { createClient } from "@supabase/supabase-js"
import { expect,test,type APIRequestContext,type BrowserContext,type Page } from "@playwright/test"

test.skip(process.env.SUPABASE_INTEGRATION!=="true","requires Supabase Local")

function trustedClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key)throw new Error("Supabase Local credentials are unavailable")
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
}

async function rpc(supabase:ReturnType<typeof trustedClient>,name:string,params:Record<string,unknown>){
  const result=await supabase.rpc(name,params)
  expect(result.error,`${name}: ${result.error?.message||"failed"}`).toBeNull()
  return result.data
}

async function login(page:Page,email:string,password:string){
  await page.goto("/auth/login")
  await page.getByLabel("Email",{exact:true}).fill(email)
  await page.getByLabel("Password",{exact:true}).fill(password)
  await page.getByRole("button",{name:"Login",exact:true}).click()
  await expect(page.getByRole("button",{name:email.split("@")[0]})).toBeVisible()
}

async function assertSignedDocument(request:APIRequestContext,page:Page,name:string,contents:string){
  const link=page.getByRole("link",{name,exact:true})
  await expect(link).toHaveAttribute("href",/\/storage\/v1\/object\/sign\/provider-verification\//)
  const href=await link.getAttribute("href")
  const response=await request.get(href!)
  expect(response.ok()).toBeTruthy()
  expect(await response.text()).toContain(contents)
}

test("submits private provider evidence and completes administrator verification",async({browser,request})=>{
  test.setTimeout(90_000)
  const trusted=trustedClient()
  const password="BrowserVerify!2026"
  const adminEmail="verification-flow-admin@as-a.local"
  const providerEmail="verification-flow-provider@as-a.local"
  const providerName="Browser Verification Provider"
  let providerContext:BrowserContext|undefined
  let adminContext:BrowserContext|undefined

  try{
    const admin=await trusted.auth.admin.createUser({
      email:adminEmail,password,email_confirm:true,
      user_metadata:{full_name:"Browser Verification Admin",role:"seeker"},
    })
    const provider=await trusted.auth.admin.createUser({
      email:providerEmail,password,email_confirm:true,
      user_metadata:{full_name:providerName,role:"provider"},
    })
    expect(admin.error).toBeNull()
    expect(provider.error).toBeNull()
    expect((await trusted.from("profiles").update({is_admin:true}).eq("id",admin.data.user!.id)).error).toBeNull()
    const providerId=await rpc(trusted,"register_provider_profile",{
      p_actor_id:provider.data.user!.id,p_name_ar:"مزود توثيق",p_name_en:providerName,
      p_title_ar:"مستشار",p_title_en:"Consultant",p_bio_ar:"",p_bio_en:"",p_starting_price:200,
      p_skills:["Research"],p_categories:["consulting"],p_avatar_url:"/placeholder.svg",
    })

    providerContext=await browser.newContext()
    adminContext=await browser.newContext()
    const providerPage=await providerContext.newPage()
    const adminPage=await adminContext.newPage()
    await Promise.all([
      providerPage.addInitScript(()=>window.localStorage.setItem("language","en")),
      adminPage.addInitScript(()=>window.localStorage.setItem("language","en")),
    ])
    await Promise.all([
      login(providerPage,providerEmail,password),
      login(adminPage,adminEmail,password),
    ])

    await providerPage.goto("/verification")
    await providerPage.getByPlaceholder("Describe your service and what the documents support...")
      .fill("Evidence for the browser verification workflow")
    await providerPage.locator('input[type="file"]').setInputFiles({
      name:"verification-evidence.pdf",mimeType:"application/pdf",
      buffer:Buffer.from("%PDF-1.4\nBrowser verification evidence\n%%EOF\n"),
    })
    await providerPage.getByRole("button",{name:"Submit for Review",exact:true}).click()
    await expect(providerPage.getByText("Verification request submitted",{exact:true})).toBeVisible()
    await expect(providerPage.getByText("pending",{exact:true})).toBeVisible()
    await assertSignedDocument(request,providerPage,"verification-evidence.pdf","Browser verification evidence")

    await adminPage.goto("/admin/providers")
    await expect(adminPage.getByRole("heading",{name:providerName,exact:true})).toBeVisible()
    await assertSignedDocument(request,adminPage,"verification-evidence.pdf","Browser verification evidence")
    await adminPage.getByRole("button",{name:"Approve",exact:true}).click()
    const reviewDialog=adminPage.getByRole("dialog",{name:"Approve Verification"})
    await reviewDialog.getByLabel("Decision reason").fill("Evidence reviewed in the browser flow")
    await reviewDialog.getByRole("button",{name:"Save Decision",exact:true}).click()
    await expect(adminPage.getByText("Verification decision saved",{exact:true})).toBeVisible()

    await providerPage.reload()
    await expect(providerPage.getByText("approved",{exact:true})).toBeVisible()
    await expect(providerPage.getByText(/Evidence reviewed in the browser flow/)).toBeVisible()
    const verification=await trusted.from("provider_verification_requests")
      .select("status,review_note,provider_id").eq("provider_id",providerId).single()
    expect(verification.error).toBeNull()
    expect(verification.data).toEqual({
      status:"approved",review_note:"Evidence reviewed in the browser flow",provider_id:providerId,
    })
    const providerState=await trusted.from("providers").select("is_verified").eq("id",providerId).single()
    expect(providerState.error).toBeNull()
    expect(providerState.data?.is_verified).toBe(true)
  }finally{
    await Promise.allSettled([providerContext?.close(),adminContext?.close()])
    trusted.realtime.disconnect()
  }
})
