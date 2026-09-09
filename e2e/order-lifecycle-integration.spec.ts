import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { expect,test,type APIRequestContext,type Page } from "@playwright/test"

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

async function openConversation(page:Page,otherParty:string,serviceName:string){
  await page.goto("/messages")
  await page.getByText(otherParty,{exact:true}).first().click()
  await expect(page.getByRole("heading",{name:serviceName,exact:true})).toBeVisible()
  await expect(page.getByText("Connected",{exact:true})).toBeVisible({timeout:30_000})
}

async function assertSignedFile(request:APIRequestContext,page:Page,name:string,contents:string){
  const link=page.getByRole("link",{name})
  await expect(link).toBeVisible()
  const href=await link.getAttribute("href")
  expect(href).toBeTruthy()
  const response=await request.get(href!)
  expect(response.ok()).toBeTruthy()
  expect(await response.text()).toContain(contents)
}

test("completes a two-party delivery, revision, acceptance, and review flow",async({browser,request})=>{
  test.setTimeout(120_000)
  const trusted=trustedClient()
  const password="BrowserOrder!2026"
  const adminEmail="order-flow-admin@as-a.local"
  const providerEmail="order-flow-provider@as-a.local"
  const buyerEmail="order-flow-buyer@as-a.local"
  const serviceName="Browser Lifecycle Service"
  const users:Record<string,string>={}
  let providerContext:Awaited<ReturnType<typeof browser.newContext>>|undefined
  let buyerContext:Awaited<ReturnType<typeof browser.newContext>>|undefined

  try{
    for(const [key,email,role,name] of [
      ["admin",adminEmail,"seeker","Browser Order Admin"],
      ["provider",providerEmail,"provider","Browser Order Provider"],
      ["buyer",buyerEmail,"seeker","Browser Order Buyer"],
    ] as const){
      const created=await trusted.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name,role}})
      expect(created.error).toBeNull()
      users[key]=created.data.user!.id
    }
    expect((await trusted.from("profiles").update({is_admin:true}).eq("id",users.admin)).error).toBeNull()
    await rpc(trusted,"register_provider_profile",{
      p_actor_id:users.provider,p_name_ar:"مزود دورة الطلب",p_name_en:"Browser Order Provider",
      p_title_ar:"مصمم",p_title_en:"Designer",p_bio_ar:"",p_bio_en:"",p_starting_price:100,
      p_skills:["Figma"],p_categories:["design"],p_avatar_url:"/placeholder.svg",
    })
    const serviceId=await rpc(trusted,"create_service_draft",{
      p_actor_id:users.provider,p_name_ar:"خدمة دورة الطلب",p_name_en:serviceName,
      p_description_ar:"وصف",p_description_en:"Browser delivery lifecycle",p_category:"design",p_price:100,
      p_price_type:"fixed",p_delivery_time:"3 days",p_features:["Source file"],
    })
    await rpc(trusted,"update_service_draft",{
      p_actor_id:users.provider,p_service_id:serviceId,p_name_ar:"خدمة دورة الطلب",p_name_en:serviceName,
      p_description_ar:"وصف",p_description_en:"Browser delivery lifecycle",p_category:"design",p_price:100,
      p_price_type:"fixed",p_delivery_time:"3 days",p_features:["Source file"],
      p_image_urls:["https://images.local.test/order-service.png"],
    })
    await rpc(trusted,"submit_service_for_review",{p_actor_id:users.provider,p_service_id:serviceId})
    await rpc(trusted,"review_service",{p_actor_id:users.admin,p_service_id:serviceId,p_decision:"approved",p_note:"Browser lifecycle"})
    const orderId=await rpc(trusted,"create_direct_order",{p_service_id:serviceId,p_actor_id:users.buyer})
    const attempt=await rpc(trusted,"begin_payment_attempt",{p_order_id:orderId,p_actor_id:users.buyer})
    const chargeId=`chg_browser_${randomUUID().replaceAll("-","")}`
    await rpc(trusted,"record_tap_charge_attempt",{
      p_attempt_id:attempt.id,p_actor_id:users.buyer,p_charge_id:chargeId,p_external_status:"CAPTURED",
      p_transaction_id:"txn_browser",p_checkout_url:"https://checkout.local.test",p_amount:100,p_currency:"SAR",
    })
    const eventId=await rpc(trusted,"record_payment_event",{
      p_source:"reconciliation",p_event_key:`browser:${chargeId}:CAPTURED`,p_charge_id:chargeId,
      p_external_status:"CAPTURED",p_claimed_order_id:orderId,p_claimed_attempt_id:attempt.id,
      p_amount:100,p_currency:"SAR",p_signature_valid:true,p_reference_data:{transaction:"txn_browser"},
    })
    const payment=await rpc(trusted,"process_payment_event",{p_event_id:eventId})
    expect(payment.order_status).toBe("paid")

    providerContext=await browser.newContext()
    buyerContext=await browser.newContext()
    const providerPage=await providerContext.newPage()
    const buyerPage=await buyerContext.newPage()
    await Promise.all([
      providerPage.addInitScript(()=>window.localStorage.setItem("language","en")),
      buyerPage.addInitScript(()=>window.localStorage.setItem("language","en")),
    ])
    await Promise.all([
      login(providerPage,providerEmail,password),
      login(buyerPage,buyerEmail,password),
    ])
    await Promise.all([
      openConversation(providerPage,"Browser Order Buyer",serviceName),
      openConversation(buyerPage,"Browser Order Provider",serviceName),
    ])

    await providerPage.getByRole("button",{name:"Deliver Order",exact:true}).click()
    await providerPage.getByLabel("Delivery summary").fill("Initial browser delivery")
    await providerPage.locator("#delivery-files").setInputFiles({
      name:"browser-delivery.txt",mimeType:"text/plain",buffer:Buffer.from("first browser delivery"),
    })
    await providerPage.getByLabel("HTTPS links, one per line (optional)").fill("https://files.local.test/initial")
    await providerPage.getByRole("button",{name:"Submit Delivery",exact:true}).click()
    await expect(providerPage.getByText("Delivery submitted",{exact:true})).toBeVisible()

    await expect(buyerPage.getByRole("button",{name:"Review Delivery",exact:true})).toBeVisible({timeout:30_000})
    await buyerPage.getByRole("button",{name:"Review Delivery",exact:true}).click()
    await expect(buyerPage.getByText("Initial browser delivery",{exact:true})).toBeVisible()
    await assertSignedFile(request,buyerPage,"browser-delivery.txt","first browser delivery")
    await buyerPage.getByRole("button",{name:"Request Revision",exact:true}).click()
    await buyerPage.getByLabel("Requested revision").fill("Please provide the corrected source file")
    await buyerPage.getByRole("button",{name:"Send Revision Request",exact:true}).click()
    await expect(buyerPage.getByText("Revision request sent",{exact:true})).toBeVisible()

    await expect(providerPage.getByRole("button",{name:"Resubmit",exact:true})).toBeVisible({timeout:30_000})
    await providerPage.getByRole("button",{name:"Resubmit",exact:true}).click()
    await expect(providerPage.getByRole("dialog",{name:"Order Delivery"}))
      .toContainText("Please provide the corrected source file")
    await providerPage.getByLabel("Delivery summary").fill("Revised browser delivery")
    await providerPage.locator("#delivery-files").setInputFiles({
      name:"browser-delivery-v2.txt",mimeType:"text/plain",buffer:Buffer.from("revised browser delivery"),
    })
    await providerPage.getByRole("button",{name:"Submit Delivery",exact:true}).click()
    await expect(providerPage.getByText("Delivery submitted",{exact:true})).toBeVisible()

    await expect(buyerPage.getByRole("button",{name:"Review Delivery",exact:true})).toBeVisible({timeout:30_000})
    await buyerPage.getByRole("button",{name:"Review Delivery",exact:true}).click()
    await expect(buyerPage.getByText("Version 2",{exact:true})).toBeVisible()
    await expect(buyerPage.getByText("Revised browser delivery",{exact:true})).toBeVisible()
    await assertSignedFile(request,buyerPage,"browser-delivery-v2.txt","revised browser delivery")
    await buyerPage.getByRole("button",{name:"Accept Delivery",exact:true}).click()
    await expect(buyerPage.getByText("Delivery accepted",{exact:true})).toBeVisible()
    await expect(providerPage.getByText("Completed",{exact:true})).toBeVisible({timeout:30_000})

    await buyerPage.goto("/history")
    await expect(buyerPage.getByRole("heading",{name:serviceName,exact:true})).toBeVisible()
    await buyerPage.getByRole("button",{name:"Write Review",exact:true}).click()
    const reviewDialog=buyerPage.getByRole("dialog",{name:"Write Review"})
    await reviewDialog.getByRole("button",{name:"Rate 4 stars"}).click()
    await reviewDialog.locator("textarea").fill("Browser lifecycle verified")
    await reviewDialog.getByRole("button",{name:"Save",exact:true}).click()
    await expect(reviewDialog).not.toBeVisible()
    await expect(buyerPage.getByText("4/5",{exact:true})).toBeVisible()

    const order=await trusted.from("orders").select("status,delivery_version").eq("id",orderId).single()
    expect(order.error).toBeNull()
    expect(order.data).toEqual({status:"completed",delivery_version:2})
    const review=await trusted.from("reviews").select("rating,comment").eq("order_id",orderId).single()
    expect(review.error).toBeNull()
    expect(review.data).toEqual({rating:4,comment:"Browser lifecycle verified"})
  }finally{
    await Promise.allSettled([providerContext?.close(),buyerContext?.close()])
    trusted.realtime.disconnect()
  }
})
