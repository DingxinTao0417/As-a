/** Verifies the fresh contract through local Supabase Auth, PostgREST, Storage and Realtime. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

function localEnvironment(){
  let output
  try{
    output=execFileSync("supabase",["status","--output","env"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]})
  }catch{
    throw new Error("Supabase Local is not running. Run `supabase start` and `supabase db reset` first.")
  }
  const values={}
  for(const line of output.split("\n")){
    const match=line.match(/^([A-Z0-9_]+)=(.*)$/)
    if(!match)continue
    const raw=match[2].trim()
    values[match[1]]=raw.startsWith('"')?JSON.parse(raw):raw
  }
  if(!values.API_URL||!values.ANON_KEY||!values.SERVICE_ROLE_KEY){
    throw new Error("Supabase Local status did not provide the required API credentials")
  }
  return values
}

function client(url,key,auth={}){
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,...auth}})
}

async function clearMailpit(mailpitUrl){
  const response=await fetch(`${mailpitUrl}/api/v1/messages`,{method:"DELETE"})
  assert.ok(response.ok,`Mailpit cleanup failed with ${response.status}`)
}

async function waitForAuthLink(mailpitUrl,email,type){
  for(let attempt=0;attempt<30;attempt+=1){
    const listResponse=await fetch(`${mailpitUrl}/api/v1/messages`)
    assert.ok(listResponse.ok,`Mailpit list failed with ${listResponse.status}`)
    const list=await listResponse.json()
    const messages=(list.messages||[]).filter(item=>(item.To||[]).some(recipient=>recipient.Address===email))
    for(const message of messages){
      const messageResponse=await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(message.ID)}`)
      assert.ok(messageResponse.ok,`Mailpit message failed with ${messageResponse.status}`)
      const detail=await messageResponse.json()
      const matches=[...(detail.HTML||"").matchAll(/https?:\/\/[^\s"<>]+/g),
        ...(detail.Text||"").matchAll(/https?:\/\/[^\s"<>]+/g)]
      const link=matches.map(match=>match[0].replaceAll("&amp;","&"))
        .find(value=>{const parsed=new URL(value);return parsed.pathname==="/auth/v1/verify"&&parsed.searchParams.get("type")===type})
      if(link)return link
    }
    await new Promise(resolve=>setTimeout(resolve,200))
  }
  throw new Error(`Mailpit did not receive a ${type} link`)
}

async function rpc(supabase,name,params){
  const result=await supabase.rpc(name,params)
  assert.equal(result.error,null,`${name}: ${result.error?.message||"request failed"}`)
  return result.data
}

async function signIn(url,anonKey,email,password){
  const supabase=client(url,anonKey)
  const {data,error}=await supabase.auth.signInWithPassword({email,password})
  assert.equal(error,null,`sign in failed: ${error?.message||email}`)
  assert.ok(data.user&&data.session)
  return {supabase,user:data.user}
}

let env
try{
  env=localEnvironment()
}catch(error){
  console.error(error instanceof Error?error.message:"Supabase Local is unavailable")
  process.exit(1)
}
const service=client(env.API_URL,env.SERVICE_ROLE_KEY)
const anonymous=client(env.API_URL,env.ANON_KEY)
const password="LocalIntegration!2026"
assert.ok(env.MAILPIT_URL,"Supabase Local status did not provide MAILPIT_URL")
await clearMailpit(env.MAILPIT_URL)

const {count:profileCount,error:profileCountError}=await service.from("profiles").select("id",{count:"exact",head:true})
assert.equal(profileCountError,null)
assert.equal(profileCount,0,"Local integration database is not clean. Run `supabase db reset` before this test.")

const lifecycleEmail="auth-lifecycle@as-a.local"
const lifecycleClient=client(env.API_URL,env.ANON_KEY,{flowType:"pkce"})
const lifecycleSignup=await lifecycleClient.auth.signUp({
  email:lifecycleEmail,password,options:{
    emailRedirectTo:"http://127.0.0.1:3000/auth/callback?next=%2F",
    data:{full_name:"Auth Lifecycle",role:"seeker"},
  },
})
assert.equal(lifecycleSignup.error,null,`auth lifecycle signup: ${lifecycleSignup.error?.message||"failed"}`)
assert.ok(lifecycleSignup.data.user)
assert.equal(lifecycleSignup.data.session,null,"email-confirmation signup unexpectedly created a session")
const lifecycleId=lifecycleSignup.data.user.id
const lifecycleProfile=await service.from("profiles").select("role,is_admin").eq("id",lifecycleId).single()
assert.equal(lifecycleProfile.error,null)
assert.deepEqual(lifecycleProfile.data,{role:"seeker",is_admin:false})
const unconfirmedLogin=await client(env.API_URL,env.ANON_KEY).auth.signInWithPassword({email:lifecycleEmail,password})
assert.ok(unconfirmedLogin.error,"unconfirmed email unexpectedly signed in")
const confirmationLink=await waitForAuthLink(env.MAILPIT_URL,lifecycleEmail,"signup")
const confirmationResponse=await fetch(confirmationLink,{redirect:"manual"})
assert.ok([302,303].includes(confirmationResponse.status),`confirmation returned ${confirmationResponse.status}`)
const confirmationLocation=confirmationResponse.headers.get("location")
assert.ok(confirmationLocation,"confirmation did not return a redirect")
const confirmationRedirect=new URL(confirmationLocation)
assert.equal(confirmationRedirect.origin,"http://127.0.0.1:3000")
assert.equal(confirmationRedirect.pathname,"/auth/callback")
assert.equal(confirmationRedirect.searchParams.get("next"),"/")
const confirmationCode=confirmationRedirect.searchParams.get("code")
assert.ok(confirmationCode,"PKCE confirmation did not return an authorization code")
const exchanged=await lifecycleClient.auth.exchangeCodeForSession(confirmationCode)
assert.equal(exchanged.error,null,`confirmation code exchange: ${exchanged.error?.message||"failed"}`)
assert.equal(exchanged.data.user?.id,lifecycleId)
const reusedConfirmation=await fetch(confirmationLink,{redirect:"manual"})
assert.ok(reusedConfirmation.status>=300,"confirmation link unexpectedly remained reusable")
if([302,303].includes(reusedConfirmation.status)){
  const reusedLocation=reusedConfirmation.headers.get("location")||""
  assert.match(reusedLocation,/(?:error|error_code)=/,"reused confirmation link did not report an error")
}
const lifecycleSession={supabase:lifecycleClient,user:exchanged.data.user}
const newPassword="LocalIntegration!2026-Updated"
const changedPassword=await lifecycleSession.supabase.auth.updateUser({password:newPassword})
assert.equal(changedPassword.error,null,`password update: ${changedPassword.error?.message||"failed"}`)
const oldPasswordLogin=await client(env.API_URL,env.ANON_KEY).auth.signInWithPassword({email:lifecycleEmail,password})
assert.ok(oldPasswordLogin.error,"old password unexpectedly remained valid")
const newPasswordLogin=await client(env.API_URL,env.ANON_KEY).auth.signInWithPassword({email:lifecycleEmail,password:newPassword})
assert.equal(newPasswordLogin.error,null,`new password sign in: ${newPasswordLogin.error?.message||"failed"}`)
const recoveryClient=client(env.API_URL,env.ANON_KEY,{flowType:"pkce"})
const resetRequest=await recoveryClient.auth.resetPasswordForEmail(lifecycleEmail,{
  redirectTo:"http://127.0.0.1:3000/auth/callback?next=%2Fauth%2Freset-password",
})
assert.equal(resetRequest.error,null,`password recovery request: ${resetRequest.error?.message||"failed"}`)
const recoveryLink=await waitForAuthLink(env.MAILPIT_URL,lifecycleEmail,"recovery")
const recoveryResponse=await fetch(recoveryLink,{redirect:"manual"})
assert.ok([302,303].includes(recoveryResponse.status),`password recovery returned ${recoveryResponse.status}`)
const recoveryLocation=recoveryResponse.headers.get("location")
assert.ok(recoveryLocation,"password recovery did not return a redirect")
const recoveryRedirect=new URL(recoveryLocation)
assert.equal(recoveryRedirect.origin,"http://127.0.0.1:3000")
assert.equal(recoveryRedirect.pathname,"/auth/callback")
assert.equal(recoveryRedirect.searchParams.get("next"),"/auth/reset-password")
const recoveryCode=recoveryRedirect.searchParams.get("code")
assert.ok(recoveryCode,"PKCE recovery did not return an authorization code")
const recoveryExchange=await recoveryClient.auth.exchangeCodeForSession(recoveryCode)
assert.equal(recoveryExchange.error,null,`recovery code exchange: ${recoveryExchange.error?.message||"failed"}`)
assert.equal(recoveryExchange.data.user?.id,lifecycleId)
const finalPassword="LocalIntegration!2026-Recovered"
const recoveredPassword=await recoveryClient.auth.updateUser({password:finalPassword})
assert.equal(recoveredPassword.error,null,`recovered password update: ${recoveredPassword.error?.message||"failed"}`)
const reusedRecovery=await fetch(recoveryLink,{redirect:"manual"})
assert.ok(reusedRecovery.status>=300,"password recovery link unexpectedly remained reusable")
if([302,303].includes(reusedRecovery.status)){
  const reusedLocation=reusedRecovery.headers.get("location")||""
  assert.match(reusedLocation,/(?:error|error_code)=/,"reused recovery link did not report an error")
}
const supersededPasswordLogin=await client(env.API_URL,env.ANON_KEY).auth.signInWithPassword({email:lifecycleEmail,password:newPassword})
assert.ok(supersededPasswordLogin.error,"superseded password unexpectedly remained valid")
const recoveredPasswordLogin=await client(env.API_URL,env.ANON_KEY).auth.signInWithPassword({email:lifecycleEmail,password:finalPassword})
assert.equal(recoveredPasswordLogin.error,null,`recovered password sign in: ${recoveredPasswordLogin.error?.message||"failed"}`)

const accounts=[
  {key:"buyerA",email:"buyer-a@as-a.local",role:"seeker"},
  {key:"buyerB",email:"buyer-b@as-a.local",role:"seeker"},
  {key:"provider",email:"provider@as-a.local",role:"provider"},
  {key:"admin",email:"admin@as-a.local",role:"seeker"},
]
const ids={}
for(const account of accounts){
  const {data,error}=await service.auth.admin.createUser({
    email:account.email,password,email_confirm:true,user_metadata:{full_name:account.key,role:account.role},
  })
  assert.equal(error,null,`create ${account.key}: ${error?.message||"failed"}`)
  assert.ok(data.user)
  ids[account.key]=data.user.id
}
const {error:adminRoleError}=await service.from("profiles").update({is_admin:true}).eq("id",ids.admin)
assert.equal(adminRoleError,null)

const buyerA=await signIn(env.API_URL,env.ANON_KEY,accounts[0].email,password)
const buyerB=await signIn(env.API_URL,env.ANON_KEY,accounts[1].email,password)
const provider=await signIn(env.API_URL,env.ANON_KEY,accounts[2].email,password)
const admin=await signIn(env.API_URL,env.ANON_KEY,accounts[3].email,password)

const ownProfile=await buyerA.supabase.from("profiles").select("id,role").eq("id",ids.buyerA).single()
assert.equal(ownProfile.error,null)
assert.equal(ownProfile.data.role,"seeker")
const otherProfile=await buyerA.supabase.from("profiles").select("id").eq("id",ids.buyerB)
assert.equal(otherProfile.error,null)
assert.equal(otherProfile.data.length,0)

const providerId=await rpc(service,"register_provider_profile",{
  p_actor_id:ids.provider,p_name_ar:"مزود محلي",p_name_en:"Local Provider",
  p_title_ar:"مصمم",p_title_en:"Designer",p_bio_ar:"",p_bio_en:"",
  p_starting_price:100,p_skills:["Figma"],p_categories:["design"],p_avatar_url:"/placeholder.svg",
})
assert.ok(providerId)

const providerTableRead=await provider.supabase.from("providers").select("tap_destination_id").eq("id",providerId)
assert.ok(providerTableRead.error,"authenticated browser role unexpectedly read providers")
const trustedRpcFromBrowser=await provider.supabase.rpc("create_service_draft",{
  p_actor_id:ids.provider,p_name_ar:"خدمة",p_name_en:"Service",p_description_ar:"",p_description_en:"",
  p_category:"design",p_price:100,p_price_type:"fixed",p_delivery_time:"3 days",p_features:["Source file"],
})
assert.ok(trustedRpcFromBrowser.error,"authenticated browser role unexpectedly called a trusted RPC")

const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")
const avatarPath=`${ids.buyerA}/${randomUUID()}.png`
const avatarUpload=await buyerA.supabase.storage.from("avatars").upload(avatarPath,png,{contentType:"image/png"})
assert.equal(avatarUpload.error,null,`avatar upload: ${avatarUpload.error?.message||"failed"}`)
const crossAvatar=await buyerB.supabase.storage.from("avatars").upload(`${ids.buyerA}/${randomUUID()}.png`,png,{contentType:"image/png"})
assert.ok(crossAvatar.error,"cross-user avatar upload unexpectedly succeeded")

const serviceImagePath=`${providerId}/${randomUUID()}.png`
const serviceImageUpload=await provider.supabase.storage.from("service-images").upload(serviceImagePath,png,{contentType:"image/png"})
assert.equal(serviceImageUpload.error,null,`service image upload: ${serviceImageUpload.error?.message||"failed"}`)
const crossServiceImage=await buyerA.supabase.storage.from("service-images").upload(`${providerId}/${randomUUID()}.png`,png,{contentType:"image/png"})
assert.ok(crossServiceImage.error,"non-provider service image upload unexpectedly succeeded")
const imageUrl=provider.supabase.storage.from("service-images").getPublicUrl(serviceImagePath).data.publicUrl

const serviceId=await rpc(service,"create_service_draft",{
  p_actor_id:ids.provider,p_name_ar:"خدمة محلية",p_name_en:"Local Service",p_description_ar:"وصف",p_description_en:"Description",
  p_category:"design",p_price:100,p_price_type:"fixed",p_delivery_time:"3 days",p_features:["Source file"],
})
await rpc(service,"update_service_draft",{
  p_actor_id:ids.provider,p_service_id:serviceId,p_name_ar:"خدمة محلية",p_name_en:"Local Service",
  p_description_ar:"وصف",p_description_en:"Description",p_category:"design",p_price:100,
  p_price_type:"fixed",p_delivery_time:"3 days",p_features:["Source file"],p_image_urls:[imageUrl],
})
await rpc(service,"submit_service_for_review",{p_actor_id:ids.provider,p_service_id:serviceId})
await rpc(service,"review_service",{p_actor_id:ids.admin,p_service_id:serviceId,p_decision:"approved",p_note:"Local integration"})
const browserServiceRead=await anonymous.from("services").select("moderation_note").eq("id",serviceId)
assert.ok(browserServiceRead.error,"anonymous browser role unexpectedly read services")
const catalog=await rpc(service,"search_service_catalog",{
  p_query:null,p_category:"design",p_sort:"newest",p_offset:0,p_limit:12,
})
assert.ok(catalog.some((row)=>row.id===serviceId))

const conversationId=await rpc(service,"open_provider_conversation",{p_actor_id:ids.buyerA,p_provider_id:providerId})
await rpc(service,"send_conversation_message",{
  p_actor_id:ids.buyerA,p_conversation_id:conversationId,p_client_request_id:randomUUID(),p_content:"Initial message",
})
const buyerConversation=await buyerA.supabase.from("conversations").select("id").eq("id",conversationId)
assert.equal(buyerConversation.error,null)
assert.equal(buyerConversation.data.length,1)
const outsiderConversation=await buyerB.supabase.from("conversations").select("id").eq("id",conversationId)
assert.equal(outsiderConversation.error,null)
assert.equal(outsiderConversation.data.length,0)
const providerMessages=await provider.supabase.from("messages").select("id").eq("conversation_id",conversationId)
assert.equal(providerMessages.error,null)
assert.equal(providerMessages.data.length,1)

let realtimeChannel
try{
  await new Promise((resolve,reject)=>{
    let finished=false
    let pumpStarted=false
    const realtimeContent=`Realtime message ${randomUUID()}`
    const timer=setTimeout(()=>{finished=true;reject(new Error("Realtime insert was not delivered within 30 seconds"))},30_000)
    realtimeChannel=buyerA.supabase.channel(`integration-${randomUUID()}`)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`conversation_id=eq.${conversationId}`},payload=>{
        if(payload.new?.content!==realtimeContent||finished)return
        finished=true;clearTimeout(timer);resolve()
      })
      .subscribe(async status=>{
        if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(status)&&!finished){
          finished=true;clearTimeout(timer);reject(new Error(`Realtime subscription failed: ${status}`));return
        }
        if(status!=="SUBSCRIBED"||pumpStarted)return
        pumpStarted=true
        for(let attempt=0;attempt<20&&!finished;attempt+=1){
          await new Promise(resolveDelay=>setTimeout(resolveDelay,attempt===0?2_500:1_000))
          if(finished)return
          try{
            await rpc(service,"send_conversation_message",{
              p_actor_id:ids.provider,p_conversation_id:conversationId,p_client_request_id:randomUUID(),p_content:realtimeContent,
            })
          }catch(error){finished=true;clearTimeout(timer);reject(error);return}
        }
      })
  })
}finally{
  if(realtimeChannel)await realtimeChannel.unsubscribe()
}

const orderId=await rpc(service,"create_direct_order",{p_service_id:serviceId,p_actor_id:ids.buyerA})
const orderForBuyer=await buyerA.supabase.from("orders").select("id,status").eq("id",orderId).single()
assert.equal(orderForBuyer.error,null)
assert.equal(orderForBuyer.data.status,"pending")
const orderForOutsider=await buyerB.supabase.from("orders").select("id").eq("id",orderId)
assert.equal(orderForOutsider.error,null)
assert.equal(orderForOutsider.data.length,0)
const paymentAttempt=await rpc(service,"begin_payment_attempt",{p_order_id:orderId,p_actor_id:ids.buyerA})
const chargeId=`chg_local_${randomUUID().replaceAll("-","")}`
await rpc(service,"record_tap_charge_attempt",{
  p_attempt_id:paymentAttempt.id,p_actor_id:ids.buyerA,p_charge_id:chargeId,p_external_status:"CAPTURED",
  p_transaction_id:"txn_local",p_checkout_url:"https://checkout.local.test",p_amount:100,p_currency:"SAR",
})
const paymentEventId=await rpc(service,"record_payment_event",{
  p_source:"reconciliation",p_event_key:`integration:${chargeId}:CAPTURED`,p_charge_id:chargeId,
  p_external_status:"CAPTURED",p_claimed_order_id:orderId,p_claimed_attempt_id:paymentAttempt.id,
  p_amount:100,p_currency:"SAR",p_signature_valid:true,p_reference_data:{transaction:"txn_local"},
})
const paymentResult=await rpc(service,"process_payment_event",{p_event_id:paymentEventId})
assert.equal(paymentResult.processing_status,"processed")
assert.equal(paymentResult.order_status,"paid")

const pdf=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n")
const deliveryRequestId=randomUUID()
const deliveryPath=`${orderId}/${ids.provider}/${deliveryRequestId}-0.pdf`
const deliveryUpload=await provider.supabase.storage.from("order-deliveries").upload(deliveryPath,pdf,{contentType:"application/pdf"})
assert.equal(deliveryUpload.error,null,`delivery upload: ${deliveryUpload.error?.message||"failed"}`)
const crossDelivery=await buyerA.supabase.storage.from("order-deliveries")
  .upload(`${orderId}/${ids.buyerA}/${randomUUID()}-0.pdf`,pdf,{contentType:"application/pdf"})
assert.ok(crossDelivery.error,"non-provider delivery upload unexpectedly succeeded")
const buyerDeliveryLink=await buyerA.supabase.storage.from("order-deliveries").createSignedUrl(deliveryPath,60)
assert.equal(buyerDeliveryLink.error,null,`buyer delivery read: ${buyerDeliveryLink.error?.message||"failed"}`)
const outsiderDeliveryLink=await buyerB.supabase.storage.from("order-deliveries").createSignedUrl(deliveryPath,60)
assert.ok(outsiderDeliveryLink.error,"outsider delivery read unexpectedly succeeded")
const firstDelivery=await rpc(service,"submit_order_delivery",{
  p_order_id:orderId,p_actor_id:ids.provider,p_client_request_id:deliveryRequestId,p_note:"Initial delivery",
  p_links:["https://files.local.test/source"],
  p_files:[{path:deliveryPath,name:"delivery.pdf",mime:"application/pdf",size:pdf.length}],
})
assert.equal(firstDelivery.version,1)
await rpc(service,"request_order_revision",{
  p_order_id:orderId,p_actor_id:ids.buyerA,p_reason:"Please include the editable source",
})
const secondDelivery=await rpc(service,"submit_order_delivery",{
  p_order_id:orderId,p_actor_id:ids.provider,p_client_request_id:randomUUID(),p_note:"Revised delivery",
  p_links:["https://files.local.test/revised"],p_files:[],
})
assert.equal(secondDelivery.version,2)
await rpc(service,"confirm_order",{p_order_id:orderId,p_actor_id:ids.buyerA})
const completedOrder=await buyerA.supabase.from("orders").select("status,delivery_version").eq("id",orderId).single()
assert.equal(completedOrder.error,null)
assert.deepEqual(completedOrder.data,{status:"completed",delivery_version:2})
await rpc(service,"save_order_review",{p_actor_id:ids.buyerA,p_order_id:orderId,p_rating:5,p_comment:"Gateway verified"})
const reviewPage=await rpc(service,"get_service_review_page",{
  p_service_id:serviceId,p_before_created_at:null,p_before_id:null,p_limit:10,
})
assert.equal(reviewPage.length,1)
assert.equal(reviewPage[0].rating,5)
await provider.supabase.storage.from("order-deliveries").remove([deliveryPath])
const referencedDeliveryLink=await buyerA.supabase.storage.from("order-deliveries").createSignedUrl(deliveryPath,60)
assert.equal(referencedDeliveryLink.error,null,"referenced delivery file was deleted")

const verificationClientId=randomUUID()
const verificationPath=`${providerId}/${ids.provider}/${verificationClientId}-0.pdf`
const verificationUpload=await provider.supabase.storage.from("provider-verification").upload(verificationPath,pdf,{contentType:"application/pdf"})
assert.equal(verificationUpload.error,null,`verification upload: ${verificationUpload.error?.message||"failed"}`)
const verificationRequest=await rpc(service,"request_provider_verification",{
  p_actor_id:ids.provider,p_provider_id:providerId,p_client_request_id:verificationClientId,
  p_note:"Local integration credentials",
  p_documents:[{path:verificationPath,name:"credential.pdf",mime:"application/pdf",size:pdf.length}],
})
const ownerVerificationLink=await provider.supabase.storage.from("provider-verification").createSignedUrl(verificationPath,60)
assert.equal(ownerVerificationLink.error,null)
const adminVerificationLink=await admin.supabase.storage.from("provider-verification").createSignedUrl(verificationPath,60)
assert.equal(adminVerificationLink.error,null)
const outsiderVerificationLink=await buyerA.supabase.storage.from("provider-verification").createSignedUrl(verificationPath,60)
assert.ok(outsiderVerificationLink.error,"verification document leaked to another user")
await rpc(service,"review_provider_verification",{
  p_actor_id:ids.admin,p_request_id:verificationRequest.id,p_decision:"approved",p_note:"Local document review",
})
await provider.supabase.storage.from("provider-verification").remove([verificationPath])
const referencedVerificationLink=await admin.supabase.storage.from("provider-verification").createSignedUrl(verificationPath,60)
assert.equal(referencedVerificationLink.error,null,"referenced verification document was deleted")

const dispute=await rpc(service,"create_order_dispute",{
  p_actor_id:ids.buyerA,p_order_id:orderId,p_client_request_id:randomUUID(),p_category:"quality",
  p_description:"The final delivery requires an administrator review.",p_requested_resolution:"Continue after review",
})
const evidencePath=`${dispute.id}/${ids.buyerA}/${randomUUID()}.pdf`
const evidenceUpload=await buyerA.supabase.storage.from("dispute-evidence").upload(evidencePath,pdf,{contentType:"application/pdf"})
assert.equal(evidenceUpload.error,null,`dispute evidence upload: ${evidenceUpload.error?.message||"failed"}`)
const providerEvidenceLink=await provider.supabase.storage.from("dispute-evidence").createSignedUrl(evidencePath,60)
assert.equal(providerEvidenceLink.error,null)
const outsiderEvidenceLink=await buyerB.supabase.storage.from("dispute-evidence").createSignedUrl(evidencePath,60)
assert.ok(outsiderEvidenceLink.error,"dispute evidence leaked to an outsider")
await rpc(service,"add_dispute_evidence",{
  p_actor_id:ids.buyerA,p_dispute_id:dispute.id,p_storage_path:evidencePath,p_description:"Local evidence",
})
await buyerA.supabase.storage.from("dispute-evidence").remove([evidencePath])
const referencedEvidenceLink=await provider.supabase.storage.from("dispute-evidence").createSignedUrl(evidencePath,60)
assert.equal(referencedEvidenceLink.error,null,"referenced dispute evidence was deleted")
await rpc(service,"review_order_dispute",{
  p_actor_id:ids.admin,p_dispute_id:dispute.id,p_action:"continue_order",p_note:"Local review complete",p_refund_amount:null,
})

const refund=await rpc(service,"request_order_refund",{
  p_actor_id:ids.buyerA,p_order_id:orderId,p_client_request_id:randomUUID(),p_amount:20,
  p_reason:"Partial refund verified through the local gateway",
})
const buyerRefund=await buyerA.supabase.from("refund_requests").select("id,status,amount").eq("id",refund.id).single()
assert.equal(buyerRefund.error,null)
assert.equal(Number(buyerRefund.data.amount),20)
const providerRefund=await provider.supabase.from("refund_requests").select("id").eq("id",refund.id)
assert.equal(providerRefund.error,null)
assert.equal(providerRefund.data.length,1)
const outsiderRefund=await buyerB.supabase.from("refund_requests").select("id").eq("id",refund.id)
assert.equal(outsiderRefund.error,null)
assert.equal(outsiderRefund.data.length,0)
await rpc(service,"review_order_refund",{
  p_actor_id:ids.admin,p_refund_id:refund.id,p_decision:"approved",p_note:"Local gateway approval",
})
const refundAttempt=await rpc(service,"begin_refund_attempt",{p_refund_id:refund.id})
const externalRefundId=`re_local_${randomUUID().replaceAll("-","")}`
const refundEventId=await rpc(service,"record_refund_event",{
  p_source:"reconciliation",p_event_key:`integration:${externalRefundId}:REFUNDED`,
  p_external_refund_id:externalRefundId,p_external_status:"REFUNDED",
  p_claimed_refund_request_id:refund.id,p_claimed_refund_attempt_id:refundAttempt.id,
  p_charge_id:chargeId,p_amount:20,p_currency:"SAR",p_signature_valid:true,p_reference_data:{},
})
const refundResult=await rpc(service,"process_refund_event",{p_event_id:refundEventId})
assert.deepEqual(refundResult,{processing_status:"processed",result:"succeeded"})
const refundedOrder=await buyerA.supabase.from("orders").select("refunded_amount,refund_status").eq("id",orderId).single()
assert.equal(refundedOrder.error,null)
assert.equal(Number(refundedOrder.data.refunded_amount),20)
assert.equal(refundedOrder.data.refund_status,"partial")
const providerBalance=await rpc(service,"get_provider_balance",{p_provider_id:providerId,p_actor_id:ids.provider})
assert.equal(Number(providerBalance.available),68)

const cancelledRefund=await rpc(service,"request_order_refund",{
  p_actor_id:ids.buyerA,p_order_id:orderId,p_client_request_id:randomUUID(),p_amount:10,
  p_reason:"Cancellation release verification",
})
assert.equal(await rpc(service,"cancel_order_refund",{p_actor_id:ids.buyerA,p_refund_id:cancelledRefund.id}),"cancelled")
const balanceAfterCancellation=await rpc(service,"get_provider_balance",{p_provider_id:providerId,p_actor_id:ids.provider})
assert.equal(Number(balanceAfterCancellation.available),68)
assert.equal(Number(balanceAfterCancellation.reserved),0)

const buyerNotifications=await rpc(service,"get_user_notification_page",{
  p_actor_id:ids.buyerA,p_before_created_at:null,p_before_id:null,p_limit:100,
})
assert.ok(buyerNotifications.some(item=>item.type==="refund"||item.type==="dispute"))
const providerNotifications=await rpc(service,"get_user_notification_page",{
  p_actor_id:ids.provider,p_before_created_at:null,p_before_id:null,p_limit:100,
})
assert.ok(providerNotifications.some(item=>item.type==="order"||item.type==="refund"||item.type==="dispute"))
const outsiderNotificationRead=await buyerB.supabase.from("notifications").select("id").eq("user_id",ids.buyerA)
assert.equal(outsiderNotificationRead.error,null)
assert.equal(outsiderNotificationRead.data.length,0)

const buyerExport=await rpc(service,"export_user_data_snapshot_v10",{p_actor_id:ids.buyerA})
assert.ok(buyerExport.orders_as_seeker.some(item=>item.id===orderId))
assert.ok(buyerExport.order_deliveries.some(item=>item.order_id===orderId))
assert.ok(buyerExport.reviews_authored.some(item=>item.order_id===orderId))
assert.ok(buyerExport.refund_requests.some(item=>item.id===refund.id))
assert.ok(buyerExport.refund_events.some(item=>item.external_refund_id===externalRefundId))
assert.ok(buyerExport.disputes.some(item=>item.id===dispute.id))
assert.ok(buyerExport.dispute_evidence.some(item=>item.storage_path===evidencePath))
const providerExport=await rpc(service,"export_user_data_snapshot_v10",{p_actor_id:ids.provider})
assert.ok(providerExport.orders_as_provider.some(item=>item.id===orderId))
assert.ok(providerExport.provider_verification_requests.some(item=>item.id===verificationRequest.id))
assert.ok(providerExport.provider_verification_documents.some(item=>item.storage_path===verificationPath))

const deletionRequest=await rpc(service,"request_account_deletion",{p_actor_id:ids.buyerB})
assert.equal(deletionRequest.status,"requested")
const ownDeletion=await buyerB.supabase.from("account_deletion_requests").select("id,status").eq("id",deletionRequest.id).single()
assert.equal(ownDeletion.error,null)
assert.equal(ownDeletion.data.status,"requested")
const otherDeletion=await buyerA.supabase.from("account_deletion_requests").select("id").eq("id",deletionRequest.id)
assert.equal(otherDeletion.error,null)
assert.equal(otherDeletion.data.length,0)
const cancelledDeletion=await rpc(service,"cancel_account_deletion",{p_actor_id:ids.buyerB})
assert.equal(cancelledDeletion.status,"cancelled")

for(const supabase of [service,anonymous,lifecycleClient,recoveryClient,lifecycleSession.supabase,buyerA.supabase,buyerB.supabase,provider.supabase,admin.supabase]){
  supabase.realtime.disconnect()
}
console.log("Supabase integration verification passed: Auth, RLS/Storage/Realtime, order delivery/review, verification, dispute/refund settlement, notifications, export and deletion request lifecycle.")
