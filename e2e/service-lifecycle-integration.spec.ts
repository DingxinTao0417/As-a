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

const png=Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZCbkAAAAASUVORK5CYII=",
  "base64",
)

function storagePath(publicUrl:string){
  const marker="/storage/v1/object/public/service-images/"
  const pathname=new URL(publicUrl).pathname
  const index=pathname.indexOf(marker)
  expect(index).toBeGreaterThanOrEqual(0)
  return decodeURIComponent(pathname.slice(index+marker.length))
}

async function approve(adminPage:Page,serviceName:string){
  await adminPage.goto("/admin/services")
  const row=adminPage.getByRole("row").filter({hasText:serviceName})
  await expect(row).toBeVisible()
  await row.getByRole("button",{name:"Approve",exact:true}).click()
  await expect(adminPage.getByText("Review decision saved",{exact:true})).toBeVisible()
}

test("creates, moderates, edits, and republishes a service with real image storage",async({browser})=>{
  test.setTimeout(120_000)
  const trusted=trustedClient()
  const password="BrowserService!2026"
  const adminEmail="service-flow-admin@as-a.local"
  const providerEmail="service-flow-provider@as-a.local"
  const originalName="Browser Storage Service"
  const updatedName="Browser Storage Service Updated"
  let providerContext:BrowserContext|undefined
  let adminContext:BrowserContext|undefined
  let publicContext:BrowserContext|undefined

  try{
    const admin=await trusted.auth.admin.createUser({
      email:adminEmail,password,email_confirm:true,
      user_metadata:{full_name:"Browser Service Admin",role:"seeker"},
    })
    const provider=await trusted.auth.admin.createUser({
      email:providerEmail,password,email_confirm:true,
      user_metadata:{full_name:"Browser Service Provider",role:"provider"},
    })
    expect(admin.error).toBeNull()
    expect(provider.error).toBeNull()
    expect((await trusted.from("profiles").update({is_admin:true}).eq("id",admin.data.user!.id)).error).toBeNull()
    const providerId=await rpc(trusted,"register_provider_profile",{
      p_actor_id:provider.data.user!.id,p_name_ar:"مزود تخزين",p_name_en:"Browser Service Provider",
      p_title_ar:"مصمم",p_title_en:"Designer",p_bio_ar:"",p_bio_en:"",p_starting_price:100,
      p_skills:["Figma"],p_categories:["design"],p_avatar_url:"/placeholder.svg",
    })

    providerContext=await browser.newContext()
    adminContext=await browser.newContext()
    publicContext=await browser.newContext()
    const providerPage=await providerContext.newPage()
    const adminPage=await adminContext.newPage()
    const publicPage=await publicContext.newPage()
    await Promise.all([
      providerPage.addInitScript(()=>window.localStorage.setItem("language","en")),
      adminPage.addInitScript(()=>window.localStorage.setItem("language","en")),
      publicPage.addInitScript(()=>window.localStorage.setItem("language","en")),
    ])
    await Promise.all([
      login(providerPage,providerEmail,password),
      login(adminPage,adminEmail,password),
    ])

    await providerPage.goto("/my-services")
    await providerPage.getByRole("button",{name:"Add Service",exact:true}).click()
    const createDialog=providerPage.getByRole("dialog",{name:"Add New Service"})
    await createDialog.getByLabel("Service Name (Arabic)").fill("خدمة تخزين المتصفح")
    await createDialog.getByLabel("Service Name (English)").fill(originalName)
    await createDialog.getByLabel("Description (Arabic)").fill("وصف الخدمة")
    await createDialog.getByLabel("Description (English)").fill("Created through the browser")
    await createDialog.getByLabel("Category").click()
    await providerPage.getByRole("option",{name:"Design",exact:true}).click()
    await createDialog.getByLabel("Price (SAR)").fill("175.50")
    await createDialog.getByLabel("Delivery Time").fill("4 days")
    await createDialog.getByLabel("Included Features").fill("Editable source")
    await createDialog.getByRole("button",{name:"Add feature"}).click()
    await createDialog.locator("#service-images").setInputFiles({name:"service-v1.png",mimeType:"image/png",buffer:png})
    await createDialog.getByRole("button",{name:"Save",exact:true}).click()
    await expect(providerPage.getByText("Service submitted for review",{exact:true})).toBeVisible({timeout:30_000})
    await expect(providerPage.getByRole("heading",{name:originalName,exact:true})).toBeVisible()
    await expect(providerPage.getByText("Pending Review",{exact:true})).toBeVisible()

    const created=await trusted.from("services").select("id,moderation_status,image_urls").eq("provider_id",providerId).single()
    expect(created.error).toBeNull()
    if(!created.data)throw new Error("Created service could not be read")
    const createdService=created.data
    expect(createdService.moderation_status).toBe("pending_review")
    expect(createdService.image_urls).toHaveLength(1)
    const oldImagePath=storagePath(createdService.image_urls[0])
    const oldImage=await trusted.storage.from("service-images").download(oldImagePath)
    expect(oldImage.error).toBeNull()

    await approve(adminPage,originalName)
    await providerPage.reload()
    await expect(providerPage.getByText("Published",{exact:true})).toBeVisible()
    await publicPage.goto(`/services/seeker?q=${encodeURIComponent(originalName)}`)
    await expect(publicPage.getByText(originalName,{exact:true})).toBeVisible()

    await providerPage.goto("/my-services")
    await providerPage.getByRole("button",{name:"Edit",exact:true}).click()
    const editDialog=providerPage.getByRole("dialog",{name:"Edit Service"})
    await editDialog.getByLabel("Service Name (English)").fill(updatedName)
    await editDialog.getByRole("button",{name:"Remove image",exact:true}).click()
    await editDialog.locator("#service-images").setInputFiles({name:"service-v2.png",mimeType:"image/png",buffer:png})
    await editDialog.getByRole("button",{name:"Save Changes",exact:true}).click()
    await expect(providerPage.getByText("Changes submitted for review",{exact:true})).toBeVisible({timeout:30_000})
    await expect(providerPage.getByRole("heading",{name:updatedName,exact:true})).toBeVisible()
    await expect(providerPage.getByText("Pending Review",{exact:true})).toBeVisible()

    const edited=await trusted.from("services").select("moderation_status,image_urls").eq("id",createdService.id).single()
    expect(edited.error).toBeNull()
    if(!edited.data)throw new Error("Edited service could not be read")
    const editedService=edited.data
    expect(editedService.moderation_status).toBe("pending_review")
    expect(editedService.image_urls).toHaveLength(1)
    expect(editedService.image_urls[0]).not.toBe(createdService.image_urls[0])
    expect((await trusted.storage.from("service-images").download(oldImagePath)).error).not.toBeNull()
    expect((await trusted.storage.from("service-images").download(storagePath(editedService.image_urls[0]))).error).toBeNull()
    await publicPage.goto(`/services/seeker?q=${encodeURIComponent(updatedName)}`)
    await expect(publicPage.getByText(updatedName,{exact:true})).not.toBeVisible()

    await approve(adminPage,updatedName)
    await providerPage.reload()
    await expect(providerPage.getByText("Published",{exact:true})).toBeVisible()
    await publicPage.goto(`/services/seeker?q=${encodeURIComponent(updatedName)}`)
    await expect(publicPage.getByText(updatedName,{exact:true})).toBeVisible()

    await providerPage.getByRole("button",{name:"Pause",exact:true}).click()
    await expect(providerPage.getByText("Paused",{exact:true})).toBeVisible()
    await publicPage.reload()
    await expect(publicPage.getByText(updatedName,{exact:true})).not.toBeVisible()
    await providerPage.getByRole("button",{name:"Publish",exact:true}).click()
    await expect(providerPage.getByText("Published",{exact:true})).toBeVisible()
    await publicPage.reload()
    await expect(publicPage.getByText(updatedName,{exact:true})).toBeVisible()
  }finally{
    await Promise.allSettled([providerContext?.close(),adminContext?.close(),publicContext?.close()])
    trusted.realtime.disconnect()
  }
})
