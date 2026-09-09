import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  queryResult: { data: undefined as unknown, error: null as unknown },
  revalidatePath: vi.fn(),
  createRefund: vi.fn(),
  retrieveRefund: vi.fn(),
  processRefund: vi.fn(),
}))
function query() {
  const value: Record<string, unknown> = { data: mocks.queryResult.data, error: mocks.queryResult.error }
  for (const method of ["select", "eq", "in", "not", "order", "limit"]) value[method] = vi.fn(() => value)
  value.single = vi.fn(async () => mocks.queryResult)
  return value
}
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth, requireAdmin: mocks.requireAdmin }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: vi.fn(() => query()) }) }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/tap", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tap")>("@/lib/tap")
  return { ...actual, createRefund: mocks.createRefund, retrieveRefund: mocks.retrieveRefund }
})
vi.mock("@/lib/refund-events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/refund-events")>("@/lib/refund-events")
  return { ...actual, recordAndProcessTapRefund: mocks.processRefund }
})

import {
  cancelRefundRequest,
  executeRefundRequest,
  getAdminRefundRequests,
  getMyRefundRequests,
  getRefundEligibleOrders,
  requestOrderRefund,
  reviewRefundRequest,
} from "@/app/actions/refunds"

const userId = "10000000-0000-4000-8000-000000000001"
const orderId = "20000000-0000-4000-8000-000000000001"
const requestId = "30000000-0000-4000-8000-000000000001"
const refundId = "40000000-0000-4000-8000-000000000001"
const refund = { id: refundId, order_id: orderId, requester_id: userId, amount: 20, status: "requested" }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.requireAdmin.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockResolvedValue({ data: refund, error: null })
  mocks.queryResult = { data: [], error: null }
})
afterEach(() => vi.unstubAllEnvs())

describe("refund actions", () => {
  it("creates a trusted idempotent partial refund request", async () => {
    await expect(requestOrderRefund({ orderId, clientRequestId: requestId, amount: 20, reason: "Partial refund requested" })).resolves.toEqual({ success: true, data: { refund } })
    expect(mocks.rpc).toHaveBeenCalledWith("request_order_refund", {
      p_actor_id: userId,
      p_order_id: orderId,
      p_client_request_id: requestId,
      p_amount: 20,
      p_reason: "Partial refund requested",
    })
  })

  it("rejects sub-cent amounts before touching the database", async () => {
    const result = await requestOrderRefund({ orderId, clientRequestId: requestId, amount: 20.001, reason: "Partial refund requested" })
    expect(result.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("loads eligible orders and user/admin refund queues with explicit errors", async () => {
    const requestedAt="2026-09-09T00:00:00.000Z"
    const refundRow={...refund,charge_id:"chg_1",provider_amount:"17",platform_amount:"3",currency:"SAR",reason:"Partial",review_note:null,requested_at:requestedAt,updated_at:requestedAt}
    const eligibleOrder={id:orderId,service_name_ar:"طلب",service_name_en:"Order",amount:"100",refunded_amount:"20",refund_status:"partial",status:"completed",currency:"SAR",created_at:requestedAt,active_refund_amount:"20",available_refund_amount:"60"}
    mocks.rpc.mockImplementation(async(name:string)=>name==="get_refund_eligible_order_page"
      ?{data:{orders:[eligibleOrder],total:2},error:null}
      :{data:{refunds:[refundRow],total:3,open_count:1},error:null})
    await expect(getRefundEligibleOrders(null,1)).resolves.toMatchObject({success:true,data:{
      orders:[{id:orderId,available_refund_amount:60}],total:2,nextCursor:{createdAt:requestedAt,id:orderId},
    }})
    await expect(getMyRefundRequests(null,1)).resolves.toMatchObject({success:true,data:{
      refunds:[{id:refundId,amount:20}],total:3,openCount:1,nextCursor:{requestedAt,id:refundId},
    }})
    await expect(getAdminRefundRequests("active",null,1)).resolves.toMatchObject({success:true,data:{refunds:[{id:refundId}],total:3,openCount:1}})
    expect(mocks.rpc).toHaveBeenNthCalledWith(3,"get_refund_request_page",{
      p_actor_id:userId,p_admin_view:true,p_status:"active",p_before_requested_at:null,p_before_id:null,p_limit:1,
    })
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") })
    await expect(getMyRefundRequests()).resolves.toEqual({ success: false, error: "Refund requests could not be loaded" })
  })

  it("allows cancellation only through the ownership-checked transaction", async () => {
    mocks.rpc.mockResolvedValue({ data: "cancelled", error: null })
    await expect(cancelRefundRequest(refundId)).resolves.toEqual({ success: true, data: { status: "cancelled" } })
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_order_refund", { p_actor_id: userId, p_refund_id: refundId })
  })

  it("requires an administrator review note and does not mark approval as completion", async () => {
    await expect(reviewRefundRequest(refundId, "approved", " ")).resolves.toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: "approved", error: null })
    await expect(reviewRefundRequest(refundId, "approved", "Approved for execution")).resolves.toEqual({ success: true, data: { status: "approved" } })
    expect(mocks.rpc).toHaveBeenCalledWith("review_order_refund", {
      p_actor_id: userId,
      p_refund_id: refundId,
      p_decision: "approved",
      p_note: "Approved for execution",
    })
  })

  it("keeps external Tap execution closed until the refund gate is enabled", async () => {
    await expect(executeRefundRequest(refundId)).resolves.toEqual({
      success: false,
      error: "Tap refund execution is currently unavailable",
    })
  })

  it("records an enabled Tap response through the persisted refund-event processor", async () => {
    vi.stubEnv("TAP_REFUNDS_ENABLED", "true")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test")
    mocks.rpc.mockImplementation(async (name: string) => name === "begin_refund_attempt"
      ? { data: { id: requestId, is_new: true, external_refund_id: null }, error: null }
      : { data: null, error: null })
    mocks.queryResult = {
      data: { id: refundId, charge_id: "chg_test", amount: 20, currency: "SAR", reason: "Partial refund" },
      error: null,
    }
    const tapRefund = {
      id: "re_test",
      status: "ACCEPTED",
      amount: 20,
      currency: "SAR",
      charge_id: "chg_test",
      created: "1788890500000",
      metadata: { refund_request_id: refundId, refund_attempt_id: requestId },
    }
    mocks.createRefund.mockResolvedValue(tapRefund)
    mocks.processRefund.mockResolvedValue({ success: true, data: { processing_status: "processed", result: "unknown" } })

    await expect(executeRefundRequest(refundId)).resolves.toEqual({ success: true, data: { status: "unknown" } })
    expect(mocks.createRefund).toHaveBeenCalledWith(expect.objectContaining({
      chargeId: "chg_test",
      amount: 20,
      reason: "requested_by_customer",
      metadata: { refund_request_id: refundId, refund_attempt_id: requestId },
      postUrl: "https://app.example.test/api/webhooks/tap",
    }))
    expect(mocks.processRefund).toHaveBeenCalledWith(expect.objectContaining({
      source: "checkout",
      claimedRefundRequestId: refundId,
      claimedRefundAttemptId: requestId,
    }))
  })
})
