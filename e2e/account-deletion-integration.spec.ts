import { createClient } from "@supabase/supabase-js"
import { expect,test,type BrowserContext,type Page } from "@playwright/test"

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

async function requestDeletion(page:Page){
  await page.getByRole("button",{name:"Request Account Deletion",exact:true}).click()
  const dialog=page.getByRole("alertdialog",{name:"Request Account Deletion"})
  await dialog.getByRole("button",{name:"Submit Request",exact:true}).click()
}

test("blocks ineligible deletion and keeps an eligible request cancellable and visible to administrators",async({browser})=>{
  test.setTimeout(90_000)
  const trusted=trustedClient()
  const password="BrowserDeletion!2026"
  const adminEmail="deletion-flow-admin@as-a.local"
  const providerEmail="deletion-flow-provider@as-a.local"
  const blockedEmail="deletion-flow-blocked@as-a.local"
  const eligibleEmail="deletion-flow-eligible@as-a.local"
  const users:Record<string,string>={}
  const contexts:BrowserContext[]=[]

  try{
    for(const [key,email,role,name] of [
      ["admin",adminEmail,"seeker","Browser Deletion Admin"],
      ["provider",providerEmail,"provider","Browser Deletion Provider"],
      ["blocked",blockedEmail,"seeker","Browser Blocked User"],
      ["eligible",eligibleEmail,"seeker","Browser Eligible User"],
    ] as const){
      const created=await trusted.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name,role}})
      expect(created.error).toBeNull()
      users[key]=created.data.user!.id
    }
    expect((await trusted.from("profiles").update({is_admin:true}).eq("id",users.admin)).error).toBeNull()
    await rpc(trusted,"register_provider_profile",{
      p_actor_id:users.provider,p_name_ar:"مزود حذف",p_name_en:"Browser Deletion Provider",
      p_title_ar:"مصمم",p_title_en:"Designer",p_bio_ar:"",p_bio_en:"",p_starting_price:100,
      p_skills:["Figma"],p_categories:["design"],p_avatar_url:"/placeholder.svg",
    })
    const serviceId=await rpc(trusted,"create_service_draft",{
      p_actor_id:users.provider,p_name_ar:"خدمة حذف",p_name_en:"Deletion Blocking Service",
      p_description_ar:"وصف",p_description_en:"Keeps one order active",p_category:"design",p_price:100,
      p_price_type:"fixed",p_delivery_time:"3 days",p_features:[],
    })
    await rpc(trusted,"update_service_draft",{
      p_actor_id:users.provider,p_service_id:serviceId,p_name_ar:"خدمة حذف",p_name_en:"Deletion Blocking Service",
      p_description_ar:"وصف",p_description_en:"Keeps one order active",p_category:"design",p_price:100,
      p_price_type:"fixed",p_delivery_time:"3 days",p_features:[],p_image_urls:["https://images.local.test/deletion.png"],
    })
    await rpc(trusted,"submit_service_for_review",{p_actor_id:users.provider,p_service_id:serviceId})
    await rpc(trusted,"review_service",{p_actor_id:users.admin,p_service_id:serviceId,p_decision:"approved",p_note:"Deletion test"})
    await rpc(trusted,"create_direct_order",{p_service_id:serviceId,p_actor_id:users.blocked})

    for(let index=0;index<3;index+=1)contexts.push(await browser.newContext())
    const [blockedPage,eligiblePage,adminPage]=await Promise.all(contexts.map(async(context)=>{
      const page=await context.newPage()
      await page.addInitScript(()=>window.localStorage.setItem("language","en"))
      return page
    }))
    await Promise.all([
      login(blockedPage,blockedEmail,password),
      login(eligiblePage,eligibleEmail,password),
      login(adminPage,adminEmail,password),
    ])

    await blockedPage.goto("/profile")
    await requestDeletion(blockedPage)
    await expect(blockedPage.getByText("Account deletion failed",{exact:true})).toBeVisible()
    await expect(blockedPage.getByText("Active orders, withdrawals, or unsettled balance prevent account deletion",{exact:true})).toBeVisible()
    expect((await trusted.from("account_deletion_requests").select("id").eq("user_id",users.blocked)).data).toHaveLength(0)

    await eligiblePage.goto("/profile")
    await requestDeletion(eligiblePage)
    await expect(eligiblePage.getByText("Deletion requested",{exact:true})).toBeVisible()
    await expect(eligiblePage.getByText("Your account deletion request is pending and can be cancelled before processing begins.",{exact:true})).toBeVisible()
    await expect(eligiblePage.getByRole("button",{name:"Cancel Deletion Request",exact:true})).toBeVisible()

    await adminPage.goto("/admin/deletions")
    await expect(adminPage.getByText("Browser Eligible User",{exact:true})).toBeVisible()
    await expect(adminPage.getByText("requested",{exact:true})).toBeVisible()
    await expect(adminPage.getByText(/Execution remains disabled until retention rules and recovery steps are approved/)).toBeVisible()

    await eligiblePage.getByRole("button",{name:"Cancel Deletion Request",exact:true}).click()
    await expect(eligiblePage.getByText("Deletion request cancelled",{exact:true})).toBeVisible()
    await expect(eligiblePage.getByRole("button",{name:"Request Account Deletion",exact:true})).toBeVisible()
    await adminPage.getByRole("button",{name:"Refresh",exact:true}).click()
    await expect(adminPage.getByText("No open deletion requests",{exact:true})).toBeVisible()
    const deletion=await trusted.from("account_deletion_requests").select("status,cancelled_at").eq("user_id",users.eligible).single()
    expect(deletion.error).toBeNull()
    expect(deletion.data?.status).toBe("cancelled")
    expect(deletion.data?.cancelled_at).toBeTruthy()
  }finally{
    await Promise.allSettled(contexts.map((context)=>context.close()))
    trusted.realtime.disconnect()
  }
})
