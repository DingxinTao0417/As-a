"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { fail,ok } from "@/lib/action-result"
import { AuthError,requireAdmin,requireProvider } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const uuid=z.string().uuid()
const documentSchema=z.object({
  path:z.string().min(1).max(500),name:z.string().trim().min(1).max(255).refine((value)=>!/[\\/]/.test(value)),
  mime:z.enum(["application/pdf","image/jpeg","image/png","image/webp"]),size:z.number().int().min(1).max(10*1024*1024),
})
const requestSchema=z.object({clientRequestId:uuid,note:z.string().trim().max(2000),documents:z.array(documentSchema).min(1).max(5)})
const cursorSchema=z.object({updatedAt:z.string().datetime(),id:uuid})

export type VerificationDocument=z.infer<typeof documentSchema>
export type VerificationCursor=z.infer<typeof cursorSchema>
export type VerificationRequest={
  id:string;provider_id:string;requested_by:string;note:string|null;status:"pending"|"approved"|"rejected"|"cancelled"
  review_note:string|null;reviewed_at:string|null;created_at:string;updated_at:string
  provider_name_ar:string;provider_name_en:string;provider_is_verified:boolean;documents:VerificationDocument[]
}

export async function submitProviderVerification(input:z.infer<typeof requestSchema>){
  try{
    const {user,provider}=await requireProvider()
    const parsed=requestSchema.safeParse(input)
    if(!parsed.success)return fail("Provide valid verification documents and note")
    const {data,error}=await createAdminClient().rpc("request_provider_verification",{
      p_actor_id:user.id,p_provider_id:provider.id,p_client_request_id:parsed.data.clientRequestId,
      p_note:parsed.data.note,p_documents:parsed.data.documents,
    })
    if(error||!data||typeof data!=="object")return fail("Verification request could not be submitted")
    revalidatePath("/verification");revalidatePath("/admin/providers")
    return ok({request:data as Record<string,unknown>})
  }catch(error){if(error instanceof AuthError)return fail(error.message);return fail("Verification request could not be submitted")}
}

async function getVerificationPage(adminView:boolean,cursor:VerificationCursor|null,limit:number){
  try{
    const auth=adminView?await requireAdmin():await requireProvider()
    const parsedCursor=cursor?cursorSchema.safeParse(cursor):null
    if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid verification page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_provider_verification_page",{
      p_actor_id:auth.user.id,p_admin_view:adminView,p_before_updated_at:value?.updatedAt||null,p_before_id:value?.id||null,p_limit:limit,
    })
    if(error)return fail("Verification requests could not be loaded")
    const rows=(data||[]) as Array<VerificationRequest&{total_count:number|string}>
    const last=rows.at(-1)
    return ok({
      requests:rows.map((row)=>{const request={...row};delete (request as Partial<typeof row>).total_count;return request}),
      providerId:adminView?null:(auth as Awaited<ReturnType<typeof requireProvider>>).provider.id,
      total:rows.length?Number(rows[0].total_count):0,
      nextCursor:rows.length===limit&&last?{updatedAt:last.updated_at,id:last.id}:null,
    })
  }catch(error){if(error instanceof AuthError)return fail(error.message);return fail("Verification requests could not be loaded")}
}

export async function getMyProviderVerificationRequests(cursor:VerificationCursor|null=null,limit=20){return getVerificationPage(false,cursor,limit)}
export async function getAdminProviderVerificationRequests(cursor:VerificationCursor|null=null,limit=50){return getVerificationPage(true,cursor,limit)}

export async function cancelProviderVerification(requestId:string){
  try{
    const {user}=await requireProvider()
    if(!uuid.safeParse(requestId).success)return fail("Invalid verification request")
    const {data,error}=await createAdminClient().rpc("cancel_provider_verification",{p_actor_id:user.id,p_request_id:requestId})
    if(error||!data)return fail("Verification request could not be cancelled")
    revalidatePath("/verification");revalidatePath("/admin/providers")
    return ok(undefined)
  }catch(error){if(error instanceof AuthError)return fail(error.message);return fail("Verification request could not be cancelled")}
}

export async function reviewProviderVerification(requestId:string,decision:"approved"|"rejected",note:string){
  try{
    const {user}=await requireAdmin()
    if(!uuid.safeParse(requestId).success||!["approved","rejected"].includes(decision)||note.trim().length<3||note.trim().length>2000)return fail("Enter a valid decision and review note")
    const {data,error}=await createAdminClient().rpc("review_provider_verification",{p_actor_id:user.id,p_request_id:requestId,p_decision:decision,p_note:note.trim()})
    if(error||!data)return fail("Verification decision could not be saved")
    revalidatePath("/verification");revalidatePath("/admin/providers");revalidatePath("/admin/audit")
    return ok({result:data as Record<string,unknown>})
  }catch(error){if(error instanceof AuthError)return fail(error.message);return fail("Verification decision could not be saved")}
}

export async function revokeProviderVerification(providerId:string,reason:string){
  try{
    const {user}=await requireAdmin()
    if(!uuid.safeParse(providerId).success||reason.trim().length<3||reason.trim().length>2000)return fail("Enter a valid provider and revocation reason")
    const {data,error}=await createAdminClient().rpc("revoke_provider_verification",{p_actor_id:user.id,p_provider_id:providerId,p_reason:reason.trim()})
    if(error||!data)return fail("Verification could not be revoked")
    revalidatePath("/verification");revalidatePath("/admin/providers");revalidatePath("/admin/audit")
    return ok(undefined)
  }catch(error){if(error instanceof AuthError)return fail(error.message);return fail("Verification could not be revoked")}
}
