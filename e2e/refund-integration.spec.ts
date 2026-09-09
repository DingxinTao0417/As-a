import { randomUUID } from "node:crypto"
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

test("submits, approves, and settles a partial refund through the user and administrator pages",async({browser})=>{
  test.setTimeout(90_000)
  const trusted=trustedClient()
  const password="BrowserRefund!2026"
  const adminEmail="refund-flow-admin@as-a.local"
  const providerEmail="refund-flow-provider@as-a.local"
  const buyerEmail="refund-flow-buyer@as-a.local"
  const serviceName="Browser Refund Service"
  const users:Record<string,string>={}
  let buyerContext:BrowserContext|undefined
  let adminContext:BrowserContext|undefined

  try{
    for(const [key,email,role,name] of [
      ["admin",adminEmail,"seeker","Browser Refund Admin"],
      ["provider",providerEmail,"provider","Browser Refund Provider"],
      ["buyer",buyerEmail,"seeker","Browser Refund Buyer"],
    ] as const){
      const created=await trusted.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name,role}})
      expect(created.error).toBeNull()
      users[key]=created.data.user!.id
    }
    expect((await trusted.from("profiles").update({is_admin:true}).eq("id",users.admin)).error).toBeNull()
    await rpc(trusted,"register_provider_profile",{
      p_actor_id:users.provider,p_name_ar:"مزود استرداد",p_name_en:"Browser Refund Provider",
      p_title_ar:"مصمم",p_title_en:"Designer",p_bio_ar:"",p_bio_en:"",p_starting_price:100,
      p_skills:["Figma"],p_categories:["design"],p_avatar_url:"/placeholder.svg",
    })
    const serviceId=await rpc(trusted,"create_service_draft",{
      p_actor_id:users.provider,p_name_ar:"خدمة استرداد",p_name_en:serviceName,
      p_description_ar:"وصف",p_description_en:"Refund browser workflow",p_category:"design",p_price:100,
      p_price_type:"fixed",p_delivery_time:"3 days",p_features:[],
    })
    await rpc(trusted,"update_service_draft",{
      p_actor_id:users.provider,p_service_id:serviceId,p_name_ar:"خدمة استرداد",p_name_en:serviceName,
      p_description_ar:"وصف",p_description_en:"Refund browser workflow",p_category:"design",p_price:100,
      p_price_type:"fixed",p_delivery_time:"3 days",p_features:[],p_image_urls:["https://images.local.test/refund.png"],
    })
    await rpc(trusted,"submit_service_for_review",{p_actor_id:users.provider,p_service_id:serviceId})
    await rpc(trusted,"review_service",{p_actor_id:users.admin,p_service_id:serviceId,p_decision:"approved",p_note:"Refund browser test"})
    const orderId=await rpc(trusted,"create_direct_order",{p_service_id:serviceId,p_actor_id:users.buyer})
    const paymentAttempt=await rpc(trusted,"begin_payment_attempt",{p_order_id:orderId,p_actor_id:users.buyer})
    const chargeId=`chg_refund_${randomUUID().replaceAll("-","")}`
    await rpc(trusted,"record_tap_charge_attempt",{
      p_attempt_id:paymentAttempt.id,p_actor_id:users.buyer,p_charge_id:chargeId,p_external_status:"CAPTURED",
      p_transaction_id:"txn_refund",p_checkout_url:"https://checkout.local.test",p_amount:100,p_currency:"SAR",
    })
    const paymentEventId=await rpc(trusted,"record_payment_event",{
      p_source:"reconciliation",p_event_key:`browser:${chargeId}:CAPTURED`,p_charge_id:chargeId,
      p_external_status:"CAPTURED",p_claimed_order_id:orderId,p_claimed_attempt_id:paymentAttempt.id,
      p_amount:100,p_currency:"SAR",p_signature_valid:true,p_reference_data:{transaction:"txn_refund"},
    })
    expect((await rpc(trusted,"process_payment_event",{p_event_id:paymentEventId})).order_status).toBe("paid")

    buyerContext=await browser.newContext()
    adminContext=await browser.newContext()
    const buyerPage=await buyerContext.newPage()
    const adminPage=await adminContext.newPage()
    await Promise.all([
      buyerPage.addInitScript(()=>window.localStorage.setItem("language","en")),
      adminPage.addInitScript(()=>window.localStorage.setItem("language","en")),
    ])
    await Promise.all([login(buyerPage,buyerEmail,password),login(adminPage,adminEmail,password)])

    await buyerPage.goto("/refunds")
    await buyerPage.getByRole("combobox").click()
    await buyerPage.getByRole("option").filter({hasText:serviceName}).click()
    await buyerPage.getByLabel("Amount").fill("20")
    await buyerPage.getByLabel("Reason").fill("Partial browser refund")
    await buyerPage.getByRole("button",{name:"Submit Refund Request",exact:true}).click()
    await expect(buyerPage.getByText("Refund request submitted",{exact:true})).toBeVisible()
    await expect(buyerPage.getByText("requested",{exact:true})).toBeVisible()

    await adminPage.goto("/admin/refunds")
    await expect(adminPage.getByRole("heading",{name:serviceName,exact:true})).toBeVisible()
    await adminPage.getByRole("button",{name:"Approve",exact:true}).click()
    const decisionDialog=adminPage.getByRole("dialog",{name:"Approve Refund"})
    await decisionDialog.getByLabel("Review Note").fill("Approved in browser workflow")
    await decisionDialog.getByRole("button",{name:"Save Decision",exact:true}).click()
    await expect(adminPage.getByText("Refund decision saved",{exact:true})).toBeVisible()

    const refund=await trusted.from("refund_requests").select("id,status,amount").eq("order_id",orderId).single()
    expect(refund.error).toBeNull()
    if(!refund.data)throw new Error("Refund request could not be read")
    expect(refund.data).toMatchObject({status:"approved",amount:20})
    await buyerPage.reload()
    await expect(buyerPage.getByText("approved",{exact:true})).toBeVisible()
    await expect(buyerPage.getByText(/Approved in browser workflow/)).toBeVisible()

    const attempt=await rpc(trusted,"begin_refund_attempt",{p_refund_id:refund.data.id})
    const externalRefundId=`re_browser_${randomUUID().replaceAll("-","")}`
    const refundEventId=await rpc(trusted,"record_refund_event",{
      p_source:"reconciliation",p_event_key:`browser:${externalRefundId}:REFUNDED`,
      p_external_refund_id:externalRefundId,p_external_status:"REFUNDED",
      p_claimed_refund_request_id:refund.data.id,p_claimed_refund_attempt_id:attempt.id,
      p_charge_id:chargeId,p_amount:20,p_currency:"SAR",p_signature_valid:true,p_reference_data:{},
    })
    expect(await rpc(trusted,"process_refund_event",{p_event_id:refundEventId})).toMatchObject({processing_status:"processed",result:"succeeded"})
    await buyerPage.reload()
    await expect(buyerPage.getByText("succeeded",{exact:true})).toBeVisible()
    const order=await trusted.from("orders").select("refunded_amount,refund_status").eq("id",orderId).single()
    expect(order.error).toBeNull()
    expect(order.data).toEqual({refunded_amount:20,refund_status:"partial"})
  }finally{
    await Promise.allSettled([buyerContext?.close(),adminContext?.close()])
    trusted.realtime.disconnect()
  }
})
