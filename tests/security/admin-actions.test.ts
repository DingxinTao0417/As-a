import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  paymentQueryResult: { data: [] as unknown[], error: null as unknown },
  retrieveCharge:vi.fn(),
  recordAndProcessTapPayment:vi.fn(),
}))

function paymentQuery() {
  const query: Record<string, unknown> = {
    data: mocks.paymentQueryResult.data,
    error: mocks.paymentQueryResult.error,
  }
  for (const method of ["select", "in", "order", "limit"]) query[method] = vi.fn(() => query)
  return query
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAdmin: mocks.requireAdmin }
})
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: vi.fn(() => paymentQuery()) }),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/tap",()=>({retrieveCharge:mocks.retrieveCharge}))
vi.mock("@/lib/payment-events",()=>({
  recordAndProcessTapPayment:mocks.recordAndProcessTapPayment,
  tapPaymentEventKey:()=>"reconciliation-key",
}))

import {
  getPaymentExceptions,
  getPaymentReconciliationPage,
  getAdminWithdrawalPage,
  getAdminAuditPage,
  getAccountDeletionRequests,
  beginPayoutTracking,
  recordPayoutTrackingResult,
  recoverPaymentAttemptCharge,
  reconcilePaymentAttempt,
  relinkPaymentEvent,
  retryPaymentEvent,
  reviewService,
  reviewWithdrawal,
  setServiceActive,
  setUserAdmin,
  setUserSuspended,
} from "@/app/actions/admin"

const actorId = "10000000-0000-4000-8000-000000000001"
const targetId = "20000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAdmin.mockResolvedValue({ user: { id: actorId }, supabase: {} })
  mocks.rpc.mockResolvedValue({ error: null })
  mocks.paymentQueryResult = { data: [], error: null }
  mocks.recordAndProcessTapPayment.mockResolvedValue({success:true,data:{processing_status:"processed",result:"charge settled",order_status:"paid"}})
})
afterEach(() => vi.unstubAllEnvs())

describe("administrator actions", () => {
  it("loads the withdrawal queue with a stable cursor and global pending count",async()=>{
    const row={
      id:targetId,amount:"50.00",status:"unknown",requested_at:"2026-09-09T00:00:00.000Z",
      processed_at:null,notes:null,payout_method:"tap_dashboard",external_reference:"payout_1",
      failure_reason:null,providers:{name_ar:"مزود",name_en:"Provider",avatar_url:null},
      payout_attempts:[],
    }
    mocks.rpc.mockResolvedValue({data:{withdrawals:[row],total:4,pending_count:2},error:null})
    await expect(getAdminWithdrawalPage("unknown",null,1)).resolves.toMatchObject({
      success:true,data:{withdrawals:[{id:targetId,amount:50}],total:4,pendingCount:2,
        nextCursor:{requestedAt:row.requested_at,id:targetId}},
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_withdrawal_page",{
      p_actor_id:actorId,p_status:"unknown",p_before_requested_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("loads open payment attempts through the trusted reconciliation queue",async()=>{
    const row={id:targetId,order_id:actorId,status:"pending",external_status:"AUTHORIZED",external_charge_id:"chg_1",amount:100,currency:"SAR",last_checked_at:null,created_at:"2026-09-08T00:00:00.000Z",updated_at:"2026-09-08T00:00:00.000Z",service_name_ar:"طلب",service_name_en:"Order",seeker_email:"buyer@example.test",last_event_at:null,last_event_status:null,last_event_result:null,total_count:"1"}
    mocks.rpc.mockResolvedValueOnce({data:[row],error:null})
    await expect(getPaymentReconciliationPage()).resolves.toEqual({success:true,data:{attempts:[expect.not.objectContaining({total_count:expect.anything()})],total:1,nextCursor:null}})
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_payment_reconciliation_page",{
      p_actor_id:actorId,p_after_updated_at:null,p_after_id:null,p_limit:50,
    })
  })

  it("keeps active payment reconciliation gated and persists a verified existing charge",async()=>{
    await expect(reconcilePaymentAttempt(targetId)).resolves.toEqual({success:false,error:"Payment reconciliation is currently unavailable"})
    expect(mocks.retrieveCharge).not.toHaveBeenCalled()
    vi.stubEnv("TAP_PAYMENT_RECONCILIATION_ENABLED","true")
    mocks.rpc.mockResolvedValueOnce({data:{id:targetId,order_id:actorId,status:"pending",external_charge_id:"chg_1",amount:100,currency:"SAR"},error:null})
    mocks.retrieveCharge.mockResolvedValue({id:"chg_1",status:"CAPTURED",amount:100,currency:"SAR",metadata:{order_id:actorId,payment_attempt_id:targetId},transaction:{url:"",created:"1"},redirect:{url:""}})
    await expect(reconcilePaymentAttempt(targetId)).resolves.toEqual({success:true,data:{externalStatus:"CAPTURED",orderStatus:"paid"}})
    expect(mocks.recordAndProcessTapPayment).toHaveBeenCalledWith(expect.objectContaining({source:"reconciliation",claimedOrderId:actorId,claimedAttemptId:targetId}))
  })

  it("recovers a missing Charge ID only after a live Tap match and audited database transaction",async()=>{
    await expect(recoverPaymentAttemptCharge(targetId,"chg_recovered","TapOS incident 42")).resolves.toEqual({
      success:false,error:"Payment reconciliation is currently unavailable",
    })
    vi.stubEnv("TAP_PAYMENT_RECONCILIATION_ENABLED","true")
    mocks.rpc
      .mockResolvedValueOnce({data:{id:targetId,order_id:actorId,status:"creating",external_charge_id:null,amount:100,currency:"SAR"},error:null})
      .mockResolvedValueOnce({data:{processing_status:"processed",external_status:"CAPTURED",order_status:"paid"},error:null})
    mocks.retrieveCharge.mockResolvedValue({
      id:"chg_recovered",status:"CAPTURED",amount:100,currency:"SAR",
      metadata:{order_id:actorId,payment_attempt_id:targetId},transaction:{url:"",created:"1"},redirect:{url:""},
    })
    await expect(recoverPaymentAttemptCharge(targetId,"chg_recovered","TapOS incident 42")).resolves.toEqual({
      success:true,data:{externalStatus:"CAPTURED",orderStatus:"paid"},
    })
    expect(mocks.retrieveCharge).toHaveBeenCalledWith("chg_recovered")
    expect(mocks.rpc).toHaveBeenLastCalledWith("recover_payment_attempt_charge",expect.objectContaining({
      p_actor_id:actorId,p_attempt_id:targetId,p_reason:"TapOS incident 42",
      p_charge:expect.objectContaining({id:"chg_recovered",metadata:{order_id:actorId,payment_attempt_id:targetId}}),
    }))
  })

  it("refuses recovery when Tap metadata or amount does not match the attempt",async()=>{
    vi.stubEnv("TAP_PAYMENT_RECONCILIATION_ENABLED","true")
    mocks.rpc.mockResolvedValueOnce({data:{
      id:targetId,order_id:actorId,status:"creating",external_charge_id:null,amount:100,currency:"SAR",
    },error:null})
    mocks.retrieveCharge.mockResolvedValue({
      id:"chg_wrong",status:"CAPTURED",amount:99,currency:"SAR",
      metadata:{order_id:actorId,payment_attempt_id:targetId},transaction:{url:"",created:"1"},redirect:{url:""},
    })
    await expect(recoverPaymentAttemptCharge(targetId,"chg_wrong","Reviewed in TapOS")).resolves.toEqual({
      success:false,error:"Tap Charge does not match this payment attempt",
    })
    expect(mocks.rpc).not.toHaveBeenCalledWith("recover_payment_attempt_charge",expect.anything())
  })

  it("relinks only a complete payment event target with an audited reason",async()=>{
    await expect(relinkPaymentEvent("bad",actorId,targetId,"Reviewed")).resolves.toMatchObject({success:false})
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValueOnce({data:{processing_status:"processed",order_status:"paid"},error:null})
    await expect(relinkPaymentEvent(targetId,actorId,targetId,"Verified against the Tap dashboard")).resolves.toEqual({success:true,data:undefined})
    expect(mocks.rpc).toHaveBeenCalledWith("relink_payment_event",{
      p_actor_id:actorId,p_event_id:targetId,p_order_id:actorId,p_attempt_id:targetId,p_reason:"Verified against the Tap dashboard",
    })
  })

  it("passes the authenticated actor to the trusted database action", async () => {
    await expect(setUserAdmin(targetId, true)).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("apply_admin_action", {
      p_actor_id: actorId,
      p_action: "set_admin",
      p_target_id: targetId,
      p_value: "true",
      p_note: null,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/orders")
  })

  it("does not allow administrators to remove their own access", async () => {
    await expect(setUserAdmin(actorId, false)).resolves.toEqual({
      success: false,
      error: "You cannot change your own administrator access",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("requires an audited reason for account suspension and restoration", async () => {
    await expect(setUserSuspended(targetId, true, " ")).resolves.toEqual({
      success: false,
      error: "Enter a reason between 3 and 1000 characters",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()

    await expect(setUserSuspended(targetId, true, "Repeated abuse reports")).resolves.toEqual({
      success: true,
      data: undefined,
    })
    expect(mocks.rpc).toHaveBeenCalledWith("set_account_suspension", {
      p_actor_id: actorId,
      p_target_id: targetId,
      p_suspended: true,
      p_reason: "Repeated abuse reports",
    })
    await expect(setUserSuspended(actorId, true, "Self suspension")).resolves.toEqual({
      success: false,
      error: "You cannot suspend your own account",
    })
  })

  it("does not report success when the database rejects a change", async () => {
    mocks.rpc.mockResolvedValue({ error: new Error("database rejected update") })
    await expect(setServiceActive(targetId, true)).resolves.toEqual({
      success: false,
      error: "The change could not be saved. Please try again.",
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("requires a reason for rejection and sends explicit moderation decisions", async () => {
    await expect(reviewService(targetId, "rejected", " ")).resolves.toEqual({
      success: false,
      error: "Enter a rejection reason of at least 3 characters",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()

    await expect(reviewService(targetId, "rejected", "Missing service details")).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("review_service", {
      p_actor_id: actorId,
      p_service_id: targetId,
      p_decision: "rejected",
      p_note: "Missing service details",
    })
  })

  it("requires a reason before rejecting a withdrawal", async () => {
    await expect(reviewWithdrawal(targetId, "rejected", " ")).resolves.toEqual({
      success: false,
      error: "Enter a rejection reason of at least 3 characters",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()

    await expect(reviewWithdrawal(targetId, "approved", "Reviewed")).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("review_withdrawal_request", {
      p_actor_id: actorId,
      p_request_id: targetId,
      p_decision: "approved",
      p_note: "Reviewed",
    })
  })

  it("lists open payment exceptions and retries pending processing", async () => {
    const paymentEvent = {
      id: targetId,
      source: "webhook",
      external_charge_id: "chg_test",
      external_status: "CAPTURED",
      claimed_order_id: actorId,
      linked_order_id: actorId,
      amount: 100,
      currency: "SAR",
      processing_status: "pending" as const,
      processing_result: null,
      received_at: "2026-09-08T00:00:00.000Z",
    }
    mocks.rpc.mockResolvedValue({
      data:{events:[paymentEvent],total:3,pending_count:2,quarantined_count:1},
      error:null,
    })
    await expect(getPaymentExceptions("all",null,1)).resolves.toMatchObject({success:true,data:{
      events:[paymentEvent],total:3,pendingCount:2,quarantinedCount:1,
      nextCursor:{receivedAt:paymentEvent.received_at,id:targetId},
    }})
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_payment_exception_page",{
      p_actor_id:actorId,p_status:"all",p_before_received_at:null,p_before_id:null,p_limit:1,
    })

    mocks.rpc.mockResolvedValue({
      data: { processing_status: "processed", result: "charge settled", order_status: "paid" },
      error: null,
    })
    await expect(retryPaymentEvent(targetId)).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("process_payment_event", { p_event_id: targetId })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/payments")
  })

  it("loads a paged and searchable audit history", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        id: targetId,
        actor_id: actorId,
        actor_email: "admin@example.test",
        action: "suspend_user",
        target_id: targetId,
        before_data: { suspended_at: null },
        after_data: { suspended_at: "2026-09-08T00:00:00.000Z" },
        created_at: "2026-09-08T00:00:00.000Z",
        total_count: 7,
      }],
      error: null,
    })
    const result = await getAdminAuditPage(2, "suspend", 50)
    expect(result).toMatchObject({ success: true, data: { total: 7, page: 2, pageSize: 50 } })
    if (result.success) expect(result.data.entries[0]).not.toHaveProperty("total_count")
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_audit_page", {
      p_actor_id: actorId,
      p_query: "suspend",
      p_offset: 50,
      p_limit: 50,
    })
  })

  it("lists open account deletion requests for administrators", async () => {
    const request = {
      id: targetId,
      user_id: actorId,
      status: "requested" as const,
      eligibility_snapshot: { active_orders: 0 },
      current_step: null,
      last_error: null,
      requested_at: "2026-09-08T00:00:00.000Z",
      updated_at: "2026-09-08T00:00:00.000Z",
      user: { email: "user@example.test", full_name: "User" },
    }
    mocks.rpc.mockResolvedValue({data:{
      requests:[request],total:3,requested_count:1,processing_count:1,failed_count:1,
    },error:null})
    await expect(getAccountDeletionRequests("open",null,1)).resolves.toMatchObject({
      success:true,data:{requests:[request],total:3,requestedCount:1,processingCount:1,failedCount:1,
        nextCursor:{requestedAt:request.requested_at,id:targetId}},
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_account_deletion_page",{
      p_actor_id:actorId,p_status:"open",p_after_requested_at:null,p_after_id:null,p_limit:1,
    })
  })

  it("tracks externally initiated payouts and gates terminal reconciliation", async () => {
    const attempt = { id: targetId, status: "awaiting_external", external_reference: "payout_external_1" }
    mocks.rpc.mockResolvedValue({ data: attempt, error: null })
    await expect(beginPayoutTracking(targetId, "tap_dashboard", "payout_external_1", "Initiated in Tap dashboard")).resolves.toEqual({ success: true, data: { attempt } })
    expect(mocks.rpc).toHaveBeenCalledWith("begin_payout_tracking", {
      p_actor_id: actorId,
      p_withdrawal_id: targetId,
      p_method: "tap_dashboard",
      p_external_reference: "payout_external_1",
      p_note: "Initiated in Tap dashboard",
    })

    await expect(recordPayoutTrackingResult(targetId, "paid", "report-row-1", "Verified PAID_OUT")).resolves.toEqual({
      success: false,
      error: "Payout reconciliation is currently unavailable",
    })
    vi.stubEnv("TAP_PAYOUT_RECONCILIATION_ENABLED", "true")
    mocks.rpc.mockResolvedValue({ data: "paid", error: null })
    await expect(recordPayoutTrackingResult(targetId, "paid", "report-row-1", "Verified PAID_OUT")).resolves.toEqual({ success: true, data: { status: "paid" } })
    expect(mocks.rpc).toHaveBeenLastCalledWith("record_payout_tracking_result", {
      p_actor_id: actorId,
      p_attempt_id: targetId,
      p_status: "paid",
      p_evidence_reference: "report-row-1",
      p_note: "Verified PAID_OUT",
    })
  })
})
