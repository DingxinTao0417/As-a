import { createClient } from "@supabase/supabase-js"
import { expect,test } from "@playwright/test"

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

test("reviews a service with an audit trail and rejects a non-admin browser",async({page})=>{
  test.setTimeout(60_000)
  const trusted=trustedClient()
  const password="BrowserAdmin!2026"
  const adminEmail="browser-admin@as-a.local"
  const providerEmail="admin-flow-provider@as-a.local"
  const buyerEmail="admin-flow-buyer@as-a.local"
  const users:Record<string,string>={}
  for(const [key,email,role] of [
    ["admin",adminEmail,"seeker"],["provider",providerEmail,"provider"],["buyer",buyerEmail,"seeker"],
  ] as const){
    const created=await trusted.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:key,role}})
    expect(created.error).toBeNull()
    users[key]=created.data.user!.id
  }
  expect((await trusted.from("profiles").update({is_admin:true}).eq("id",users.admin)).error).toBeNull()
  const providerId=await rpc(trusted,"register_provider_profile",{
    p_actor_id:users.provider,p_name_ar:"مزود الإدارة",p_name_en:"Admin Flow Provider",
    p_title_ar:"مصمم",p_title_en:"Designer",p_bio_ar:"",p_bio_en:"",p_starting_price:100,
    p_skills:["Figma"],p_categories:["design"],p_avatar_url:"/placeholder.svg",
  })
  expect(providerId).toBeTruthy()
  const serviceId=await rpc(trusted,"create_service_draft",{
    p_actor_id:users.provider,p_name_ar:"خدمة مراجعة",p_name_en:"Pending Browser Service",
    p_description_ar:"وصف",p_description_en:"Review flow",p_category:"design",p_price:125,
    p_price_type:"fixed",p_delivery_time:"3 days",p_features:["Source file"],
  })
  await rpc(trusted,"update_service_draft",{
    p_actor_id:users.provider,p_service_id:serviceId,p_name_ar:"خدمة مراجعة",p_name_en:"Pending Browser Service",
    p_description_ar:"وصف",p_description_en:"Review flow",p_category:"design",p_price:125,
    p_price_type:"fixed",p_delivery_time:"3 days",p_features:["Source file"],
    p_image_urls:["https://images.local.test/service.png"],
  })
  await rpc(trusted,"submit_service_for_review",{p_actor_id:users.provider,p_service_id:serviceId})

  await page.addInitScript(()=>window.localStorage.setItem("language","en"))
  await page.goto("/auth/login")
  await page.getByLabel("Email",{exact:true}).fill(adminEmail)
  await page.getByLabel("Password",{exact:true}).fill(password)
  await page.getByRole("button",{name:"Login",exact:true}).click()
  await expect(page.getByRole("button",{name:"browser-admin"})).toBeVisible()
  await page.goto("/admin/services")
  const pendingRow=page.getByRole("row").filter({hasText:"Pending Browser Service"})
  await expect(pendingRow).toBeVisible()
  await pendingRow.getByRole("button",{name:"Approve"}).click()
  await expect(page.getByText("Review decision saved",{exact:true})).toBeVisible()
  await page.getByRole("button",{name:"Approved",exact:true}).click()
  await expect(page.getByRole("row").filter({hasText:"Pending Browser Service"})).toBeVisible()

  await page.goto(`/services/seeker?q=${encodeURIComponent("Pending Browser Service")}`)
  await expect(page.getByText("Pending Browser Service",{exact:true})).toBeVisible()
  await page.goto("/admin/audit")
  await page.getByPlaceholder("Action, actor email, or target ID").fill(String(serviceId))
  await page.getByRole("button",{name:"Search"}).click()
  const auditRow=page.getByRole("row").filter({hasText:String(serviceId)})
  await expect(auditRow.getByText("set_service_active",{exact:true})).toBeVisible()

  await page.getByRole("button",{name:"Sign Out"}).click()
  await expect(page).toHaveURL(/\/auth\/login$/)
  await page.getByLabel("Email",{exact:true}).fill(buyerEmail)
  await page.getByLabel("Password",{exact:true}).fill(password)
  await page.getByRole("button",{name:"Login",exact:true}).click()
  await expect(page.getByRole("button",{name:"admin-flow-buyer"})).toBeVisible()
  await page.goto("/admin")
  await expect(page).toHaveURL(/^http:\/\/(?:127\.0\.0\.1|localhost):3107\/$/)
  trusted.realtime.disconnect()
})
