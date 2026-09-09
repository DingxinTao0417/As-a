"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAdmin, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const uuid = z.string().uuid()
const disputeInput = z.object({
  orderId: uuid,
  clientRequestId: uuid,
  category: z.enum(["delivery", "quality", "payment", "conduct", "other"]),
  description: z.string().trim().min(10).max(5000),
  requestedResolution: z.string().trim().min(3).max(1000),
})
const disputeOrderCursor=z.object({createdAt:z.string().datetime(),id:uuid})
const disputeCursor=z.object({updatedAt:z.string().datetime(),id:uuid})
const evidenceCursor=z.object({createdAt:z.string().datetime(),id:uuid})
const adminDisputeFilter=z.enum(["all","active","open","under_review","resolved","closed"])
export type DisputeOrderCursor=z.infer<typeof disputeOrderCursor>
export type DisputeCursor=z.infer<typeof disputeCursor>
export type DisputeEvidenceCursor=z.infer<typeof evidenceCursor>
export type AdminDisputeFilter=z.infer<typeof adminDisputeFilter>
export type DisputeEligibleOrder={
  id:string;service_name_ar:string;service_name_en:string;status:string;amount:number
  currency:string;dispute_status:string;created_at:string
}

export type Dispute = {
  id: string
  order_id: string
  opened_by: string
  category: string
  description: string
  requested_resolution: string
  status: "open" | "under_review" | "resolved" | "closed"
  ledger_hold_amount: number
  assigned_to: string | null
  resolution: "continue_order" | "refund" | "closed_no_action" | null
  resolution_note: string | null
  resolution_refund_id: string | null
  created_at: string
  updated_at: string
  order?: { service_name_ar: string; service_name_en: string; amount: number; currency: string; status: string } | null
  opener?: { full_name: string | null; email: string | null } | null
}

export type DisputeEvidence = {
  id: string
  dispute_id: string
  uploaded_by: string
  storage_path: string
  description: string | null
  created_at: string
}

function disputeFailure(error: unknown, fallback: string) {
  if (error instanceof AuthError) return fail(error.message)
  return fail(fallback)
}

export async function createOrderDispute(input: z.infer<typeof disputeInput>) {
  try {
    const { user } = await requireAuth()
    const parsed = disputeInput.safeParse(input)
    if (!parsed.success) return fail("Provide valid dispute details and requested resolution")
    const { data, error } = await createAdminClient().rpc("create_order_dispute", {
      p_actor_id: user.id,
      p_order_id: parsed.data.orderId,
      p_client_request_id: parsed.data.clientRequestId,
      p_category: parsed.data.category,
      p_description: parsed.data.description,
      p_requested_resolution: parsed.data.requestedResolution,
    })
    if (error || !data) return fail("This order cannot open another dispute")
    revalidatePath("/disputes")
    revalidatePath("/admin/disputes")
    revalidatePath("/dashboard")
    return ok({ dispute: data as Dispute })
  } catch (error) {
    return disputeFailure(error, "Dispute could not be created")
  }
}

export async function getDisputeEligibleOrders(cursor:DisputeOrderCursor|null=null,limit=50) {
  try {
    const { user } = await requireAuth()
    const parsedCursor=cursor?disputeOrderCursor.safeParse(cursor):null
    if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid eligible order page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const { data, error } = await createAdminClient().rpc("get_dispute_eligible_order_page", {
      p_actor_id:user.id,p_before_created_at:value?.createdAt||null,p_before_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Eligible orders could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.orders))return fail("Eligible orders could not be loaded")
    const rows=snapshot.orders as DisputeEligibleOrder[];const last=rows.at(-1)
    return ok({
      orders:rows.map((row)=>({...row,amount:Number(row.amount)})),total:Number(snapshot.total||0),
      nextCursor:rows.length===limit&&last?{createdAt:last.created_at,id:last.id}:null,
    })
  } catch (error) {
    return disputeFailure(error, "Eligible orders could not be loaded")
  }
}

export async function getMyDisputes(cursor:DisputeCursor|null=null,limit=50) {
  try {
    const {user}=await requireAuth()
    return getDisputePage(user.id,false,"all",cursor,limit)
  } catch (error) {
    return disputeFailure(error, "Disputes could not be loaded")
  }
}

export async function getAdminDisputes(
  filter:AdminDisputeFilter="active",cursor:DisputeCursor|null=null,limit=50,
) {
  try {
    const {user}=await requireAdmin()
    if(!adminDisputeFilter.safeParse(filter).success)return fail("Invalid dispute filter")
    return getDisputePage(user.id,true,filter,cursor,limit)
  } catch (error) {
    return disputeFailure(error, "Dispute queue could not be loaded")
  }
}

async function getDisputePage(
  actorId:string,adminView:boolean,filter:AdminDisputeFilter,cursor:DisputeCursor|null,limit:number,
){
  const parsedCursor=cursor?disputeCursor.safeParse(cursor):null
  if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid dispute page")
  const value=parsedCursor?.success?parsedCursor.data:null
  const {data,error}=await createAdminClient().rpc("get_dispute_page",{
    p_actor_id:actorId,p_admin_view:adminView,p_status:filter==="all"?null:filter,
    p_before_updated_at:value?.updatedAt||null,p_before_id:value?.id||null,p_limit:limit,
  })
  if(error||!data||typeof data!=="object"||Array.isArray(data))return fail(adminView?"Dispute queue could not be loaded":"Disputes could not be loaded")
  const snapshot=data as Record<string,unknown>
  if(!Array.isArray(snapshot.disputes))return fail(adminView?"Dispute queue could not be loaded":"Disputes could not be loaded")
  const rows=snapshot.disputes as Dispute[];const last=rows.at(-1)
  return ok({
    disputes:rows.map((row)=>({...row,ledger_hold_amount:Number(row.ledger_hold_amount)})),
    total:Number(snapshot.total||0),openCount:Number(snapshot.open_count||0),
    nextCursor:rows.length===limit&&last?{updatedAt:last.updated_at,id:last.id}:null,
  })
}

export async function getDisputeEvidence(disputeId: string,cursor:DisputeEvidenceCursor|null=null,limit=50) {
  try {
    const {user}=await requireAuth()
    const parsedCursor=cursor?evidenceCursor.safeParse(cursor):null
    if (!uuid.safeParse(disputeId).success||!Number.isInteger(limit)||limit<1||limit>100
      ||(parsedCursor&&!parsedCursor.success)) return fail("Invalid dispute evidence page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_dispute_evidence_page",{
      p_actor_id:user.id,p_dispute_id:disputeId,p_after_created_at:value?.createdAt||null,
      p_after_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Evidence could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.evidence))return fail("Evidence could not be loaded")
    const rows=snapshot.evidence as DisputeEvidence[];const last=rows.at(-1)
    return ok({
      evidence:rows,total:Number(snapshot.total||0),
      nextCursor:rows.length===limit&&last?{createdAt:last.created_at,id:last.id}:null,
    })
  } catch (error) {
    return disputeFailure(error, "Evidence could not be loaded")
  }
}

export async function addDisputeEvidence(disputeId: string, storagePath: string, description?: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(disputeId).success || storagePath.length < 10 || storagePath.length > 1000
        || description && description.length > 1000) return fail("Invalid dispute evidence")
    const { data, error } = await createAdminClient().rpc("add_dispute_evidence", {
      p_actor_id: user.id,
      p_dispute_id: disputeId,
      p_storage_path: storagePath,
      p_description: description?.trim() || null,
    })
    if (error || !data) return fail("Evidence could not be recorded")
    revalidatePath("/disputes")
    revalidatePath("/admin/disputes")
    return ok({ evidence: data as DisputeEvidence })
  } catch (error) {
    return disputeFailure(error, "Evidence could not be recorded")
  }
}

export async function reviewDispute(
  disputeId: string,
  action: "under_review" | "continue_order" | "refund" | "closed_no_action",
  note: string,
  refundAmount?: number,
) {
  try {
    const { user } = await requireAdmin()
    if (!uuid.safeParse(disputeId).success || !["under_review", "continue_order", "refund", "closed_no_action"].includes(action)
        || note.trim().length < 3 || note.trim().length > 2000
        || (action === "refund" && (!Number.isFinite(refundAmount) || !refundAmount || refundAmount < 1 || Math.round(refundAmount * 100) / 100 !== refundAmount))) {
      return fail("Enter a valid dispute action, note, and refund amount")
    }
    const { data, error } = await createAdminClient().rpc("review_order_dispute", {
      p_actor_id: user.id,
      p_dispute_id: disputeId,
      p_action: action,
      p_note: note.trim(),
      p_refund_amount: action === "refund" ? refundAmount : null,
    })
    if (error || !data) return fail("Dispute decision could not be saved")
    revalidatePath("/disputes")
    revalidatePath("/admin/disputes")
    revalidatePath("/admin/refunds")
    revalidatePath("/dashboard")
    revalidatePath("/admin/audit")
    return ok({ dispute: data as Dispute })
  } catch (error) {
    return disputeFailure(error, "Dispute decision could not be saved")
  }
}
