"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { fail, ok, type ActionResult } from "@/lib/action-result"
import { AuthError, requireAdmin } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { reconcileTapPaymentAttempt } from "@/lib/payment-reconciliation"
import { retrieveCharge } from "@/lib/tap"

const idSchema = z.string().uuid()
const adminWithdrawalCursor=z.object({requestedAt:z.string().datetime(),id:idSchema})
const adminWithdrawalFilter=z.enum(["all","pending","approved","processing","unknown","paid","failed","completed","rejected"])
const paymentExceptionCursor=z.object({receivedAt:z.string().datetime(),id:idSchema})
const paymentExceptionFilter=z.enum(["all","pending","quarantined"])
const accountDeletionCursor=z.object({requestedAt:z.string().datetime(),id:idSchema})
const accountDeletionFilter=z.enum(["all","open","requested","processing","failed","cancelled","completed"])
export type PaymentExceptionCursor=z.infer<typeof paymentExceptionCursor>
export type PaymentExceptionFilter=z.infer<typeof paymentExceptionFilter>
export type AccountDeletionCursor=z.infer<typeof accountDeletionCursor>
export type AccountDeletionFilter=z.infer<typeof accountDeletionFilter>

export type AdminWithdrawalFilter=z.infer<typeof adminWithdrawalFilter>
export type AdminWithdrawalCursor=z.infer<typeof adminWithdrawalCursor>
export type AdminWithdrawalRow={
  id:string;amount:number;status:Exclude<AdminWithdrawalFilter,"all">;requested_at:string
  processed_at:string|null;notes:string|null;payout_method:"tap_auto"|"tap_dashboard"|null
  external_reference:string|null;failure_reason:string|null
  providers:{name_ar:string;name_en:string;avatar_url:string|null}|null
  payout_attempts:Array<{
    id:string;method:"tap_auto"|"tap_dashboard";external_reference:string
    status:"awaiting_external"|"processing"|"unknown"|"paid"|"failed"
    evidence_reference:string|null;note:string|null;created_at:string;updated_at:string
  }>
}

export type PaymentException = {
  id: string
  source: string
  external_charge_id: string
  external_status: string
  claimed_order_id: string | null
  claimed_payment_attempt_id:string|null
  linked_order_id: string | null
  linked_payment_attempt_id:string|null
  amount: number | null
  currency: string | null
  processing_status: "pending" | "quarantined"
  processing_result: string | null
  received_at: string
}

export type PaymentReconciliationItem={
  id:string;order_id:string;status:"creating"|"pending"|"unknown";external_status:string|null
  external_charge_id:string|null;amount:number;currency:string;last_checked_at:string|null
  created_at:string;updated_at:string;service_name_ar:string;service_name_en:string
  seeker_email:string|null;last_event_at:string|null;last_event_status:string|null;last_event_result:string|null
}
const paymentReconciliationCursor=z.object({updatedAt:z.string().datetime(),id:idSchema})

export type AdminAuditEntry = {
  id: string
  actor_id: string
  actor_email: string | null
  action: string
  target_id: string
  before_data: Record<string, unknown>
  after_data: Record<string, unknown>
  created_at: string
}

export type AccountDeletionQueueItem = {
  id: string
  user_id: string
  status: "requested" | "cancelled" | "processing" | "completed" | "failed"
  eligibility_snapshot: Record<string, unknown>
  current_step: string | null
  last_error: string | null
  requested_at: string
  updated_at: string
  user: { email: string | null; full_name: string | null } | null
}

function adminFailure<T = void>(error: unknown): ActionResult<T> {
  if (error instanceof AuthError) return fail(error.message)
  console.error(JSON.stringify({
    event: "admin.action_failed",
    type: error instanceof Error ? error.name : "UnknownError",
  }))
  return fail("The change could not be saved. Please try again.")
}

async function applyAdminAction(params: {
  action: "set_admin"
  targetId: string
  value: string
  note?: string
}) {
  const { user } = await requireAdmin()
  if (!idSchema.safeParse(params.targetId).success) throw new Error("Invalid target")

  const { error } = await createAdminClient().rpc("apply_admin_action", {
    p_actor_id: user.id,
    p_action: params.action,
    p_target_id: params.targetId,
    p_value: params.value,
    p_note: params.note ?? null,
  })
  if (error) throw error
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<ActionResult<void>> {
  try {
    const { user } = await requireAdmin()
    if (user.id === userId) return fail("You cannot change your own administrator access")
    await applyAdminAction({ action: "set_admin", targetId: userId, value: String(isAdmin) })
    revalidatePath("/admin/orders")
    return ok(undefined)
  } catch (error) {
    return adminFailure(error)
  }
}

export async function setUserSuspended(
  userId: string,
  suspended: boolean,
  reason: string,
): Promise<ActionResult<void>> {
  try {
    const { user } = await requireAdmin()
    if (!idSchema.safeParse(userId).success) return fail("Invalid user")
    if (user.id === userId) return fail("You cannot suspend your own account")
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 3 || normalizedReason.length > 1000) {
      return fail("Enter a reason between 3 and 1000 characters")
    }
    const { error } = await createAdminClient().rpc("set_account_suspension", {
      p_actor_id: user.id,
      p_target_id: userId,
      p_suspended: suspended,
      p_reason: normalizedReason,
    })
    if (error) throw error
    revalidatePath("/admin/orders")
    revalidatePath("/admin/audit")
    return ok(undefined)
  } catch (error) {
    return adminFailure(error)
  }
}

export async function setServiceActive(serviceId: string, active: boolean): Promise<ActionResult<void>> {
  return reviewService(serviceId, active ? "approved" : "suspended")
}

export async function reviewService(
  serviceId: string,
  decision: "approved" | "rejected" | "suspended",
  note?: string,
): Promise<ActionResult<void>> {
  try {
    const { user } = await requireAdmin()
    if (!idSchema.safeParse(serviceId).success) return fail("Invalid service")
    if (decision === "rejected" && (!note || note.trim().length < 3)) {
      return fail("Enter a rejection reason of at least 3 characters")
    }
    const { error } = await createAdminClient().rpc("review_service", {
      p_actor_id: user.id,
      p_service_id: serviceId,
      p_decision: decision,
      p_note: note?.trim() || null,
    })
    if (error) throw error
    revalidatePath("/admin/services")
    revalidatePath(`/services/${serviceId}`)
    return ok(undefined)
  } catch (error) {
    return adminFailure(error)
  }
}

export async function reviewWithdrawal(
  withdrawalId: string,
  status: "approved" | "rejected",
  note?: string,
): Promise<ActionResult<void>> {
  try {
    if (status === "rejected" && (!note || note.trim().length < 3)) {
      return fail("Enter a rejection reason of at least 3 characters")
    }
    if (!idSchema.safeParse(withdrawalId).success) return fail("Invalid withdrawal request")
    const { user } = await requireAdmin()
    const { error } = await createAdminClient().rpc("review_withdrawal_request", {
      p_actor_id: user.id,
      p_request_id: withdrawalId,
      p_decision: status,
      p_note: note?.trim() || null,
    })
    if (error) throw error
    revalidatePath("/admin/withdrawals")
    revalidatePath("/dashboard")
    return ok(undefined)
  } catch (error) {
    return adminFailure(error)
  }
}

export async function getAdminWithdrawalPage(
  filter:AdminWithdrawalFilter="pending",cursor:AdminWithdrawalCursor|null=null,limit=50,
):Promise<ActionResult<{
  withdrawals:AdminWithdrawalRow[];total:number;pendingCount:number;nextCursor:AdminWithdrawalCursor|null
}>>{
  try{
    const {user}=await requireAdmin()
    const parsedCursor=cursor?adminWithdrawalCursor.safeParse(cursor):null
    if(!adminWithdrawalFilter.safeParse(filter).success||!Number.isInteger(limit)||limit<1||limit>100
      ||(parsedCursor&&!parsedCursor.success))return fail("Invalid withdrawal page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_admin_withdrawal_page",{
      p_actor_id:user.id,p_status:filter==="all"?null:filter,
      p_before_requested_at:value?.requestedAt||null,p_before_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Withdrawal requests could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.withdrawals))return fail("Withdrawal requests could not be loaded")
    const rows=snapshot.withdrawals as AdminWithdrawalRow[]
    const last=rows.at(-1)
    return ok({
      withdrawals:rows.map((row)=>({...row,amount:Number(row.amount),payout_attempts:Array.isArray(row.payout_attempts)?row.payout_attempts:[]})),
      total:Number(snapshot.total||0),pendingCount:Number(snapshot.pending_count||0),
      nextCursor:rows.length===limit&&last?{requestedAt:last.requested_at,id:last.id}:null,
    })
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Withdrawal requests could not be loaded")
  }
}

export async function getPaymentExceptions(
  filter:PaymentExceptionFilter="all",cursor:PaymentExceptionCursor|null=null,limit=50,
):Promise<ActionResult<{
  events:PaymentException[];total:number;pendingCount:number;quarantinedCount:number
  nextCursor:PaymentExceptionCursor|null
}>> {
  try {
    const {user}=await requireAdmin()
    const parsedCursor=cursor?paymentExceptionCursor.safeParse(cursor):null
    if(!paymentExceptionFilter.safeParse(filter).success||!Number.isInteger(limit)||limit<1||limit>100
      ||(parsedCursor&&!parsedCursor.success))return fail("Invalid payment exception page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_admin_payment_exception_page",{
      p_actor_id:user.id,p_status:filter,p_before_received_at:value?.receivedAt||null,
      p_before_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Payment exceptions could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.events))return fail("Payment exceptions could not be loaded")
    const rows=snapshot.events as PaymentException[];const last=rows.at(-1)
    return ok({
      events:rows.map((event)=>({...event,amount:event.amount==null?null:Number(event.amount)})),
      total:Number(snapshot.total||0),pendingCount:Number(snapshot.pending_count||0),
      quarantinedCount:Number(snapshot.quarantined_count||0),
      nextCursor:rows.length===limit&&last?{receivedAt:last.received_at,id:last.id}:null,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Payment exceptions could not be loaded")
  }
}

export async function retryPaymentEvent(eventId: string): Promise<ActionResult<void>> {
  try {
    await requireAdmin()
    if (!idSchema.safeParse(eventId).success) return fail("Invalid payment event")
    const { data, error } = await createAdminClient().rpc("process_payment_event", {
      p_event_id: eventId,
    })
    if (error || !data || typeof data !== "object") throw error || new Error("Missing processing result")
    const result = data as Record<string, unknown>
    if (result.processing_status !== "processed") {
      return fail("This event still requires manual reconciliation")
    }
    revalidatePath("/admin/payments")
    return ok(undefined)
  } catch (error) {
    return adminFailure(error)
  }
}

export async function relinkPaymentEvent(
  eventId:string,orderId:string,attemptId:string,reason:string,
):Promise<ActionResult<void>>{
  try{
    const {user}=await requireAdmin()
    if(!idSchema.safeParse(eventId).success||!idSchema.safeParse(orderId).success||!idSchema.safeParse(attemptId).success
      ||reason.trim().length<3||reason.trim().length>1000)return fail("Enter valid event, order, attempt, and reason values")
    const {data,error}=await createAdminClient().rpc("relink_payment_event",{
      p_actor_id:user.id,p_event_id:eventId,p_order_id:orderId,p_attempt_id:attemptId,p_reason:reason.trim(),
    })
    if(error||!data||typeof data!=="object")return fail("Payment event could not be safely relinked")
    const result=data as Record<string,unknown>
    if(result.processing_status!=="processed")return fail("Payment event still requires manual reconciliation")
    revalidatePath("/admin/payments");revalidatePath("/admin/orders");revalidatePath("/messages");revalidatePath("/admin/audit")
    return ok(undefined)
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Payment event could not be safely relinked")
  }
}

export async function getPaymentReconciliationPage(
  cursor:z.infer<typeof paymentReconciliationCursor>|null=null,
  limit=50,
):Promise<ActionResult<{attempts:PaymentReconciliationItem[];total:number;nextCursor:{updatedAt:string;id:string}|null}>>{
  try{
    const {user}=await requireAdmin()
    const parsedCursor=cursor?paymentReconciliationCursor.safeParse(cursor):null
    if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid reconciliation page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_admin_payment_reconciliation_page",{
      p_actor_id:user.id,p_after_updated_at:value?.updatedAt||null,p_after_id:value?.id||null,p_limit:limit,
    })
    if(error)return fail("Payment reconciliation queue could not be loaded")
    const rows=(data||[]) as Array<PaymentReconciliationItem&{total_count:number|string}>
    const last=rows.at(-1)
    return ok({
      attempts:rows.map((row)=>{const attempt={...row};delete (attempt as Partial<typeof row>).total_count;return attempt}),
      total:rows.length?Number(rows[0].total_count):0,
      nextCursor:rows.length===limit&&last?{updatedAt:last.updated_at,id:last.id}:null,
    })
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Payment reconciliation queue could not be loaded")
  }
}

export async function reconcilePaymentAttempt(attemptId:string):Promise<ActionResult<{externalStatus:string;orderStatus:string|null}>>{
  try{
    const {user}=await requireAdmin()
    if(process.env.TAP_PAYMENT_RECONCILIATION_ENABLED!=="true")return fail("Payment reconciliation is currently unavailable")
    if(!idSchema.safeParse(attemptId).success)return fail("Invalid payment attempt")
    const {data,error}=await createAdminClient().rpc("get_payment_attempt_for_reconciliation",{
      p_actor_id:user.id,p_attempt_id:attemptId,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Payment attempt could not be loaded")
    const attempt=data as Record<string,unknown>
    if(typeof attempt.external_charge_id!=="string"||!attempt.external_charge_id)return fail("This attempt has no recorded Charge ID and requires manual recovery")
    const processed=await reconcileTapPaymentAttempt({
      id:String(attempt.id),order_id:String(attempt.order_id),external_charge_id:attempt.external_charge_id,
      amount:Number(attempt.amount),currency:String(attempt.currency),
    })
    if(!processed.success)return fail(processed.error)
    revalidatePath("/admin/payments");revalidatePath("/admin/orders");revalidatePath("/messages")
    return ok(processed.data)
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Payment reconciliation could not be completed")
  }
}

export async function recoverPaymentAttemptCharge(
  attemptId:string,chargeId:string,reason:string,
):Promise<ActionResult<{externalStatus:string;orderStatus:string|null}>>{
  try{
    const {user}=await requireAdmin()
    if(process.env.TAP_PAYMENT_RECONCILIATION_ENABLED!=="true")return fail("Payment reconciliation is currently unavailable")
    if(!idSchema.safeParse(attemptId).success||!/^chg_[A-Za-z0-9_-]{1,196}$/.test(chargeId)
      ||reason.trim().length<3||reason.trim().length>1000)return fail("Enter a valid attempt, Charge ID, and recovery reason")
    const admin=createAdminClient()
    const {data,error}=await admin.rpc("get_payment_attempt_for_reconciliation",{
      p_actor_id:user.id,p_attempt_id:attemptId,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Payment attempt could not be loaded")
    const attempt=data as Record<string,unknown>
    if(attempt.external_charge_id)return fail("This attempt already has a Charge ID; use reconciliation")
    const charge=await retrieveCharge(chargeId)
    if(charge.id!==chargeId||Number(charge.amount)!==Number(attempt.amount)
      ||charge.currency!==attempt.currency||charge.metadata?.order_id!==attempt.order_id
      ||charge.metadata?.payment_attempt_id!==attempt.id){
      return fail("Tap Charge does not match this payment attempt")
    }
    const {data:result,error:recoveryError}=await admin.rpc("recover_payment_attempt_charge",{
      p_actor_id:user.id,p_attempt_id:attemptId,p_reason:reason.trim(),p_charge:{
        id:charge.id,status:charge.status,amount:charge.amount,currency:charge.currency,
        metadata:charge.metadata,transaction:{created:charge.transaction?.created||null},
        reference:charge.reference||{},
      },
    })
    if(recoveryError||!result||typeof result!=="object"||Array.isArray(result))return fail("Payment attempt could not be recovered")
    const processed=result as Record<string,unknown>
    if(processed.processing_status!=="processed")return fail("Recovered Charge requires manual reconciliation")
    revalidatePath("/admin/payments");revalidatePath("/admin/orders");revalidatePath("/messages");revalidatePath("/admin/audit")
    return ok({externalStatus:String(processed.external_status),orderStatus:processed.order_status?String(processed.order_status):null})
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Payment attempt could not be recovered")
  }
}

export async function getAdminAuditPage(
  page = 1,
  query = "",
  pageSize = 50,
): Promise<ActionResult<{ entries: AdminAuditEntry[]; total: number; page: number; pageSize: number }>> {
  try {
    const { user } = await requireAdmin()
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
        || query.length > 100) {
      return fail("Invalid audit query")
    }
    const { data, error } = await createAdminClient().rpc("get_admin_audit_page", {
      p_actor_id: user.id,
      p_query: query.trim() || null,
      p_offset: (page - 1) * pageSize,
      p_limit: pageSize,
    })
    if (error) throw error
    const rows = (data || []) as Array<AdminAuditEntry & { total_count: number | string }>
    return ok({
      entries: rows.map((row) => ({
        id: row.id,
        actor_id: row.actor_id,
        actor_email: row.actor_email,
        action: row.action,
        target_id: row.target_id,
        before_data: row.before_data,
        after_data: row.after_data,
        created_at: row.created_at,
      })),
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Audit history could not be loaded")
  }
}

export async function getAccountDeletionRequests(
  filter:AccountDeletionFilter="open",cursor:AccountDeletionCursor|null=null,limit=50,
):Promise<ActionResult<{
  requests:AccountDeletionQueueItem[];total:number;requestedCount:number
  processingCount:number;failedCount:number;nextCursor:AccountDeletionCursor|null
}>> {
  try {
    const {user}=await requireAdmin()
    const parsedCursor=cursor?accountDeletionCursor.safeParse(cursor):null
    if(!accountDeletionFilter.safeParse(filter).success||!Number.isInteger(limit)||limit<1||limit>100
      ||(parsedCursor&&!parsedCursor.success))return fail("Invalid deletion request page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_admin_account_deletion_page",{
      p_actor_id:user.id,p_status:filter,p_after_requested_at:value?.requestedAt||null,
      p_after_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Account deletion requests could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.requests))return fail("Account deletion requests could not be loaded")
    const rows=snapshot.requests as AccountDeletionQueueItem[];const last=rows.at(-1)
    return ok({
      requests:rows,total:Number(snapshot.total||0),requestedCount:Number(snapshot.requested_count||0),
      processingCount:Number(snapshot.processing_count||0),failedCount:Number(snapshot.failed_count||0),
      nextCursor:rows.length===limit&&last?{requestedAt:last.requested_at,id:last.id}:null,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Account deletion requests could not be loaded")
  }
}

export async function beginPayoutTracking(
  withdrawalId: string,
  method: "tap_auto" | "tap_dashboard",
  externalReference: string,
  note: string,
): Promise<ActionResult<{ attempt: Record<string, unknown> }>> {
  try {
    const { user } = await requireAdmin()
    if (!idSchema.safeParse(withdrawalId).success || !["tap_auto", "tap_dashboard"].includes(method)
        || externalReference.trim().length < 3 || externalReference.trim().length > 200
        || note.trim().length < 3 || note.trim().length > 1000) {
      return fail("Enter a valid payout method, external reference, and note")
    }
    const { data, error } = await createAdminClient().rpc("begin_payout_tracking", {
      p_actor_id: user.id,
      p_withdrawal_id: withdrawalId,
      p_method: method,
      p_external_reference: externalReference.trim(),
      p_note: note.trim(),
    })
    if (error || !data || typeof data !== "object") return fail("Payout tracking could not be started")
    revalidatePath("/admin/withdrawals")
    revalidatePath("/dashboard")
    return ok({ attempt: data as Record<string, unknown> })
  } catch (error) {
    return adminFailure<{ attempt: Record<string, unknown> }>(error)
  }
}

export async function recordPayoutTrackingResult(
  attemptId: string,
  status: "paid" | "failed" | "unknown",
  evidenceReference: string,
  note: string,
): Promise<ActionResult<{ status: string }>> {
  try {
    const { user } = await requireAdmin()
    if (process.env.TAP_PAYOUT_RECONCILIATION_ENABLED !== "true") {
      return fail("Payout reconciliation is currently unavailable")
    }
    if (!idSchema.safeParse(attemptId).success || !["paid", "failed", "unknown"].includes(status)
        || evidenceReference.trim().length < 3 || evidenceReference.trim().length > 500
        || note.trim().length < 3 || note.trim().length > 1000) {
      return fail("Enter a valid payout result, evidence reference, and note")
    }
    const { data, error } = await createAdminClient().rpc("record_payout_tracking_result", {
      p_actor_id: user.id,
      p_attempt_id: attemptId,
      p_status: status,
      p_evidence_reference: evidenceReference.trim(),
      p_note: note.trim(),
    })
    if (error || !data) return fail("Payout result could not be recorded")
    revalidatePath("/admin/withdrawals")
    revalidatePath("/dashboard")
    revalidatePath("/admin/audit")
    return ok({ status: data as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Payout result could not be recorded")
  }
}
