"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAdmin, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createRefund, retrieveRefund } from "@/lib/tap"
import { recordAndProcessTapRefund, tapRefundEventKey } from "@/lib/refund-events"

const uuid = z.string().uuid()
const refundInput = z.object({
  orderId: uuid,
  clientRequestId: uuid,
  amount: z.number().finite().min(1).max(1000000),
  reason: z.string().trim().min(3).max(2000),
})
const refundOrderCursor=z.object({createdAt:z.string().datetime(),id:uuid})
const refundRequestCursor=z.object({requestedAt:z.string().datetime(),id:uuid})
const adminRefundFilter=z.enum(["all","active","requested","approved","rejected","cancelled","processing","succeeded","failed","unknown"])
export type RefundOrderCursor=z.infer<typeof refundOrderCursor>
export type RefundRequestCursor=z.infer<typeof refundRequestCursor>
export type AdminRefundFilter=z.infer<typeof adminRefundFilter>

export type RefundRequest = {
  id: string
  order_id: string
  requester_id: string
  charge_id: string
  amount: number
  provider_amount: number
  platform_amount: number
  currency: string
  reason: string
  status: "requested" | "approved" | "rejected" | "cancelled" | "processing" | "succeeded" | "failed" | "unknown"
  review_note: string | null
  requested_at: string
  updated_at: string
  order?: { service_name_ar: string; service_name_en: string; amount: number; refunded_amount: number; status: string } | null
  requester?: { full_name: string | null; email: string | null } | null
}

export type RefundEligibleOrder = {
  id: string
  service_name_ar: string
  service_name_en: string
  amount: number
  refunded_amount: number
  refund_status: string
  status: string
  currency: string
  created_at:string
  active_refund_amount:number
  available_refund_amount:number
}

function refundFailure(error: unknown, message: string) {
  if (error instanceof AuthError) return fail(error.message)
  return fail(message)
}

export async function requestOrderRefund(input: z.infer<typeof refundInput>) {
  try {
    const { user } = await requireAuth()
    const parsed = refundInput.safeParse(input)
    if (!parsed.success || Math.round(parsed.data.amount * 100) / 100 !== parsed.data.amount) {
      return fail("Enter a valid refund amount and reason")
    }
    const { data, error } = await createAdminClient().rpc("request_order_refund", {
      p_actor_id: user.id,
      p_order_id: parsed.data.orderId,
      p_client_request_id: parsed.data.clientRequestId,
      p_amount: parsed.data.amount,
      p_reason: parsed.data.reason,
    })
    if (error || !data) return fail("Refund exceeds the eligible amount or this order cannot be refunded")
    revalidatePath("/refunds")
    revalidatePath("/history")
    revalidatePath("/admin/refunds")
    return ok({ refund: data as RefundRequest })
  } catch (error) {
    return refundFailure(error, "Refund request could not be created")
  }
}

export async function getRefundEligibleOrders(cursor:RefundOrderCursor|null=null,limit=50) {
  try {
    const { user } = await requireAuth()
    const parsedCursor=cursor?refundOrderCursor.safeParse(cursor):null
    if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid refund-eligible order page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_refund_eligible_order_page",{
      p_actor_id:user.id,p_before_created_at:value?.createdAt||null,p_before_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Refund-eligible orders could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.orders))return fail("Refund-eligible orders could not be loaded")
    const rows=snapshot.orders as RefundEligibleOrder[]
    const last=rows.at(-1)
    return ok({
      orders:rows.map((row)=>({...row,amount:Number(row.amount),refunded_amount:Number(row.refunded_amount),
        active_refund_amount:Number(row.active_refund_amount),available_refund_amount:Number(row.available_refund_amount)})),
      total:Number(snapshot.total||0),
      nextCursor:rows.length===limit&&last?{createdAt:last.created_at,id:last.id}:null,
    })
  } catch (error) {
    return refundFailure(error, "Refund-eligible orders could not be loaded")
  }
}

export async function getMyRefundRequests(cursor:RefundRequestCursor|null=null,limit=50) {
  try {
    const { user } = await requireAuth()
    return getRefundRequestPage(user.id,false,"all",cursor,limit)
  } catch (error) {
    return refundFailure(error, "Refund requests could not be loaded")
  }
}

export async function getAdminRefundRequests(
  filter:AdminRefundFilter="active",cursor:RefundRequestCursor|null=null,limit=50,
) {
  try {
    const {user}=await requireAdmin()
    if(!adminRefundFilter.safeParse(filter).success)return fail("Invalid refund queue filter")
    return getRefundRequestPage(user.id,true,filter,cursor,limit)
  } catch (error) {
    return refundFailure(error, "Refund queue could not be loaded")
  }
}

async function getRefundRequestPage(
  actorId:string,adminView:boolean,filter:AdminRefundFilter,cursor:RefundRequestCursor|null,limit:number,
){
  const parsedCursor=cursor?refundRequestCursor.safeParse(cursor):null
  if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid refund request page")
  const value=parsedCursor?.success?parsedCursor.data:null
  const {data,error}=await createAdminClient().rpc("get_refund_request_page",{
    p_actor_id:actorId,p_admin_view:adminView,p_status:filter==="all"?null:filter,
    p_before_requested_at:value?.requestedAt||null,p_before_id:value?.id||null,p_limit:limit,
  })
  if(error||!data||typeof data!=="object"||Array.isArray(data))return fail(adminView?"Refund queue could not be loaded":"Refund requests could not be loaded")
  const snapshot=data as Record<string,unknown>
  if(!Array.isArray(snapshot.refunds))return fail(adminView?"Refund queue could not be loaded":"Refund requests could not be loaded")
  const rows=snapshot.refunds as RefundRequest[]
  const last=rows.at(-1)
  return ok({
    refunds:rows.map((row)=>({...row,amount:Number(row.amount),provider_amount:Number(row.provider_amount),platform_amount:Number(row.platform_amount)})),
    total:Number(snapshot.total||0),openCount:Number(snapshot.open_count||0),
    nextCursor:rows.length===limit&&last?{requestedAt:last.requested_at,id:last.id}:null,
  })
}

export async function reviewRefundRequest(
  refundId: string,
  decision: "approved" | "rejected",
  note: string,
) {
  try {
    const { user } = await requireAdmin()
    if (!uuid.safeParse(refundId).success || !["approved", "rejected"].includes(decision)
        || note.trim().length < 3 || note.trim().length > 1000) {
      return fail("Enter a valid refund decision and review note")
    }
    const { data, error } = await createAdminClient().rpc("review_order_refund", {
      p_actor_id: user.id,
      p_refund_id: refundId,
      p_decision: decision,
      p_note: note.trim(),
    })
    if (error || !data) return fail("Refund review could not be saved")
    revalidatePath("/refunds")
    revalidatePath("/admin/refunds")
    revalidatePath("/admin/audit")
    return ok({ status: data as string })
  } catch (error) {
    return refundFailure(error, "Refund review could not be saved")
  }
}

export async function cancelRefundRequest(refundId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(refundId).success) return fail("Invalid refund request")
    const { data, error } = await createAdminClient().rpc("cancel_order_refund", {
      p_actor_id: user.id,
      p_refund_id: refundId,
    })
    if (error || !data) return fail("This refund request can no longer be cancelled")
    revalidatePath("/refunds")
    revalidatePath("/history")
    revalidatePath("/dashboard")
    return ok({ status: data as string })
  } catch (error) {
    return refundFailure(error, "Refund request could not be cancelled")
  }
}

export async function executeRefundRequest(refundId: string) {
  try {
    await requireAdmin()
    if (process.env.TAP_REFUNDS_ENABLED !== "true") return fail("Tap refund execution is currently unavailable")
    if (!uuid.safeParse(refundId).success) return fail("Invalid refund request")
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!siteUrl?.startsWith("http")) return fail("Refund callback URL is not configured")
    const admin = createAdminClient()
    const { data: attemptData, error: attemptError } = await admin.rpc("begin_refund_attempt", {
      p_refund_id: refundId,
    })
    if (attemptError || !attemptData || typeof attemptData !== "object") return fail("Refund execution could not be started")
    const attempt = attemptData as Record<string, unknown>
    if (typeof attempt.id !== "string") return fail("Refund execution could not be started")

    const { data: refundRequest, error: requestError } = await admin
      .from("refund_requests")
      .select("id, charge_id, amount, currency, reason")
      .eq("id", refundId)
      .single()
    if (requestError || !refundRequest) return fail("Refund request could not be loaded")

    let refund: Awaited<ReturnType<typeof createRefund>>
    let source: "checkout" | "reconciliation"
    if (typeof attempt.external_refund_id === "string") {
      refund = await retrieveRefund(attempt.external_refund_id)
      source = "reconciliation"
    } else if (attempt.is_new === true) {
      refund = await createRefund({
        chargeId: refundRequest.charge_id,
        amount: Number(refundRequest.amount),
        currency: refundRequest.currency,
        reason: "requested_by_customer",
        description: refundRequest.reason,
        metadata: { refund_request_id: refundId, refund_attempt_id: attempt.id },
        postUrl: `${siteUrl}/api/webhooks/tap`,
      })
      source = "checkout"
    } else {
      return fail("Refund result is awaiting reconciliation")
    }
    if (refund.charge_id !== refundRequest.charge_id
        || Number(refund.amount) !== Number(refundRequest.amount)
        || refund.currency !== refundRequest.currency) {
      return fail("Tap refund details do not match the approved request")
    }
    const processed = await recordAndProcessTapRefund({
      source,
      eventKey: tapRefundEventKey(source, refund),
      refund,
      claimedRefundRequestId: refundId,
      claimedRefundAttemptId: attempt.id,
    })
    if (!processed.success) return fail(processed.error)
    if (processed.data.processing_status === "quarantined") {
      return fail("Refund requires manual reconciliation")
    }
    revalidatePath("/refunds")
    revalidatePath("/admin/refunds")
    revalidatePath("/dashboard")
    return ok({ status: processed.data.result })
  } catch (error) {
    return refundFailure(error, "Refund execution failed or has an unknown result")
  }
}
