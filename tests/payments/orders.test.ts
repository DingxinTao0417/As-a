import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  adminRpc: vi.fn(),
  adminOrderSingle: vi.fn(),
  browserServiceSingle: vi.fn(),
  createCharge: vi.fn(),
  retrieveCharge: vi.fn(),
}))

function queryEndingWith(single: () => unknown) {
  const query: Record<string, unknown> = {}
  for (const method of ["select", "eq", "is", "in", "update", "insert"]) {
    query[method] = vi.fn(() => query)
  }
  query.single = single
  query.maybeSingle = single
  return query
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: (table:string) => queryEndingWith(table==="services"?mocks.browserServiceSingle:mocks.adminOrderSingle),
  }),
}))
vi.mock("@/lib/tap", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tap")>("@/lib/tap")
  return { ...actual, createCharge: mocks.createCharge, retrieveCharge: mocks.retrieveCharge }
})

import {
  confirmOrder,
  createDirectOrder,
  createOrder,
  createPaymentCharge,
  getConversationOrders,
  getOrderDeliveryRequest,
  requestOrderRevision,
  submitOrderDelivery,
  verifyPayment,
} from "@/app/actions/orders"

const userId = "10000000-0000-4000-8000-000000000001"
const serviceId = "20000000-0000-4000-8000-000000000001"
const conversationId = "30000000-0000-4000-8000-000000000001"
const orderId = "40000000-0000-4000-8000-000000000001"
const attemptId = "50000000-0000-4000-8000-000000000001"
const eventId = "60000000-0000-4000-8000-000000000001"

const paymentOrder = {
  id: orderId,
  amount: 100,
  currency: "SAR",
  service_name_en: "Service",
  service_description_en: "Description",
  provider_id: "20000000-0000-4000-8000-000000000002",
  seeker_id: userId,
  status: "pending",
}

const pendingCharge = {
  id: "chg_test_payment",
  status: "INITIATED" as const,
  amount: 100,
  currency: "SAR",
  transaction: { url: "https://checkout.test/pay", created: "1788890400000" },
  redirect: { url: "https://checkout.test/pay" },
  metadata: { order_id: orderId, payment_attempt_id: attemptId },
  reference: { transaction: "txn_test_payment" },
}

beforeEach(() => {
  vi.resetAllMocks()
  const browserQuery = queryEndingWith(mocks.browserServiceSingle)
  mocks.requireAuth.mockResolvedValue({
    user: { id: userId, email: "buyer@example.test" },
    supabase: { from: vi.fn(() => browserQuery) },
  })
  mocks.browserServiceSingle.mockResolvedValue({ data: { id: serviceId, price_type: "fixed" }, error: null })
  mocks.adminOrderSingle.mockResolvedValue({ data: { id: orderId, amount: 100 }, error: null })
  mocks.adminRpc.mockImplementation(async (name: string) => ({
    data: name === "create_quoted_order" || name === "create_direct_order" ? orderId
      : name === "get_order_delivery_request" ? { id:attemptId,order_id:orderId }
      : "ok",
    error: null,
  }))
  vi.stubEnv("TAP_PAYMENTS_ENABLED", "false")
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test")
})

afterEach(() => vi.unstubAllEnvs())

describe("trusted order actions", () => {
  it("loads conversation orders through a participant-scoped cursor",async()=>{
    const createdAt="2026-09-09T00:00:00.000Z"
    mocks.adminRpc.mockResolvedValue({data:{orders:[{
      id:orderId,conversation_id:conversationId,amount:"100",platform_fee:"15",provider_amount:"85",created_at:createdAt,
    }],total:3},error:null})
    await expect(getConversationOrders(conversationId,null,1)).resolves.toMatchObject({success:true,data:{
      orders:[{id:orderId,amount:100,platform_fee:15,provider_amount:85}],total:3,
      nextCursor:{createdAt,id:orderId},
    }})
    expect(mocks.adminRpc).toHaveBeenCalledWith("get_conversation_order_page",{
      p_actor_id:userId,p_conversation_id:conversationId,p_before_created_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("creates a provider quote through the database transaction", async () => {
    const result = await createOrder({
      conversationId,
      clientRequestId:attemptId,
      serviceNameAr: "خدمة",
      serviceNameEn: "Service",
      amount: 100,
    })
    expect(result).toEqual({ success: true, data: { order: { id: orderId, amount: 100 } } })
    expect(mocks.adminRpc).toHaveBeenCalledWith("create_quoted_order", expect.objectContaining({
      p_actor_id: userId,
      p_conversation_id: conversationId,
      p_client_request_id:attemptId,
      p_amount: 100,
    }))
  })

  it("rejects sub-cent quote amounts before touching the database", async () => {
    const result = await createOrder({
      conversationId,
      clientRequestId:attemptId,
      serviceNameAr: "خدمة",
      serviceNameEn: "Service",
      amount: 100.001,
    })
    expect(result.success).toBe(false)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it("routes fixed-price direct orders through the idempotent transaction", async () => {
    await expect(createDirectOrder(serviceId)).resolves.toEqual({ success: true, data: { orderId } })
    expect(mocks.adminRpc).toHaveBeenCalledWith("create_direct_order", {
      p_service_id: serviceId,
      p_actor_id: userId,
    })
  })

  it("requires a quote for non-fixed pricing", async () => {
    mocks.browserServiceSingle.mockResolvedValue({ data: { id: serviceId, price_type: "hourly" }, error: null })
    await expect(createDirectOrder(serviceId)).resolves.toEqual({
      success: false,
      error: "This service requires a confirmed quote before payment",
    })
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it("uses trusted transitions for versioned delivery, revision and confirmation", async () => {
    await expect(submitOrderDelivery({
      orderId,
      clientRequestId: attemptId,
      note: "Final files and usage instructions",
      links: ["https://files.example.test/final"],
      files:[{path:`${orderId}/${userId}/${attemptId}-0.pdf`,name:"final.pdf",mime:"application/pdf",size:1024}],
    })).resolves.toEqual({ success: true, data: { delivery: "ok" } })
    expect(mocks.adminRpc).toHaveBeenCalledWith("submit_order_delivery", {
      p_order_id: orderId,
      p_actor_id: userId,
      p_client_request_id: attemptId,
      p_note: "Final files and usage instructions",
      p_links: ["https://files.example.test/final"],
      p_files:[{path:`${orderId}/${userId}/${attemptId}-0.pdf`,name:"final.pdf",mime:"application/pdf",size:1024}],
    })
    mocks.adminRpc.mockClear()
    await expect(getOrderDeliveryRequest(orderId,attemptId)).resolves.toEqual({success:true,data:{delivery:{id:attemptId,order_id:orderId}}})
    expect(mocks.adminRpc).toHaveBeenCalledWith("get_order_delivery_request",{
      p_actor_id:userId,p_order_id:orderId,p_client_request_id:attemptId,
    })
    mocks.adminRpc.mockClear()
    await expect(requestOrderRevision(orderId, "Please update the source file")).resolves.toEqual({
      success: true,
      data: { status: "ok" },
    })
    expect(mocks.adminRpc).toHaveBeenCalledWith("request_order_revision", {
      p_order_id: orderId,
      p_actor_id: userId,
      p_reason: "Please update the source file",
    })
    mocks.adminRpc.mockClear()
    await expect(confirmOrder(orderId)).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.adminRpc).toHaveBeenCalledWith("confirm_order", { p_order_id: orderId, p_actor_id: userId })
  })

  it("rejects unsafe delivery links before the database call", async () => {
    const result = await submitOrderDelivery({
      orderId,
      clientRequestId: attemptId,
      note: "Final delivery",
      links: ["http://files.example.test/final"],
    })
    expect(result.success).toBe(false)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
    const unsafeFile=await submitOrderDelivery({
      orderId,
      clientRequestId:attemptId,
      note:"Final delivery",
      links:[],
      files:[{path:"unsafe",name:"payload.exe",mime:"application/octet-stream",size:100}],
    })
    expect(unsafeFile.success).toBe(false)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it("keeps payment calls closed until the payment gate is enabled", async () => {
    await expect(createPaymentCharge(orderId)).resolves.toEqual({
      success: false,
      error: "Payments are currently unavailable",
    })
  })

  it("creates one tracked payment attempt and records the Tap observation", async () => {
    vi.stubEnv("TAP_PAYMENTS_ENABLED", "true")
    mocks.browserServiceSingle.mockResolvedValue({ data: paymentOrder, error: null })
    mocks.createCharge.mockResolvedValue(pendingCharge)
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === "begin_payment_attempt") {
        return { data: { id: attemptId, status: "creating", external_charge_id: null, checkout_url: null, is_new: true }, error: null }
      }
      if (name === "record_payment_event") return { data: eventId, error: null }
      if (name === "process_payment_event") {
        return { data: { processing_status: "processed", result: "charge status recorded", order_status: "pending" }, error: null }
      }
      return { data: null, error: null }
    })

    await expect(createPaymentCharge(orderId)).resolves.toEqual({
      success: true,
      data: { url: "https://checkout.test/pay" },
    })
    expect(mocks.createCharge).toHaveBeenCalledWith(expect.objectContaining({
      amount: 100,
      metadata: { order_id: orderId, payment_attempt_id: attemptId },
    }))
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_tap_charge_attempt", expect.objectContaining({
      p_attempt_id: attemptId,
      p_charge_id: pendingCharge.id,
    }))
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_payment_event", expect.objectContaining({
      p_source: "checkout",
      p_claimed_attempt_id: attemptId,
    }))
  })

  it.each([
    ["TIMEDOUT","Payment was not completed. You can try again."],
    ["UNKNOWN","Payment status is unknown and requires reconciliation"],
  ])("does not return a checkout success for Tap status %s",async(status,error)=>{
    vi.stubEnv("TAP_PAYMENTS_ENABLED","true")
    mocks.browserServiceSingle.mockResolvedValue({data:paymentOrder,error:null})
    mocks.createCharge.mockResolvedValue({...pendingCharge,status})
    mocks.adminRpc.mockImplementation(async(name:string)=>{
      if(name==="begin_payment_attempt")return {data:{
        id:attemptId,status:"creating",external_charge_id:null,checkout_url:null,is_new:true,
      },error:null}
      if(name==="record_payment_event")return {data:eventId,error:null}
      if(name==="process_payment_event")return {data:{
        processing_status:"processed",result:"charge status recorded",order_status:"pending",
      },error:null}
      return {data:null,error:null}
    })
    await expect(createPaymentCharge(orderId)).resolves.toEqual({success:false,error})
  })

  it("reconciles an existing charge without creating another one", async () => {
    vi.stubEnv("TAP_PAYMENTS_ENABLED", "true")
    mocks.browserServiceSingle.mockResolvedValue({ data: paymentOrder, error: null })
    mocks.retrieveCharge.mockResolvedValue({ ...pendingCharge, status: "CAPTURED" })
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === "begin_payment_attempt") {
        return {
          data: {
            id: attemptId,
            status: "pending",
            external_charge_id: pendingCharge.id,
            checkout_url: pendingCharge.transaction.url,
            is_new: false,
          },
          error: null,
        }
      }
      if (name === "record_payment_event") return { data: eventId, error: null }
      if (name === "process_payment_event") {
        return { data: { processing_status: "processed", result: "charge settled", order_status: "paid" }, error: null }
      }
      return { data: null, error: null }
    })

    const result = await createPaymentCharge(orderId)
    expect(result).toEqual({
      success: true,
      data: { url: `https://app.example.test/messages?provider=${paymentOrder.provider_id}&payment=callback&order_id=${orderId}` },
    })
    expect(mocks.retrieveCharge).toHaveBeenCalledWith(pendingCharge.id)
    expect(mocks.createCharge).not.toHaveBeenCalled()
  })

  it("verifies pending payments through the same persisted event processor", async () => {
    mocks.browserServiceSingle.mockResolvedValue({ data: paymentOrder, error: null })
    mocks.retrieveCharge.mockResolvedValue({ ...pendingCharge, status: "CAPTURED" })
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === "get_order_payment_attempt") {
        return {
          data: { id: attemptId, status: "pending", external_charge_id: pendingCharge.id, checkout_url: null },
          error: null,
        }
      }
      if (name === "record_payment_event") return { data: eventId, error: null }
      if (name === "process_payment_event") {
        return { data: { processing_status: "processed", result: "charge settled", order_status: "paid" }, error: null }
      }
      return { data: null, error: null }
    })

    await expect(verifyPayment(orderId)).resolves.toEqual({ success: true, data: { status: "paid" } })
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_payment_event", expect.objectContaining({
      p_source: "reconciliation",
    }))
  })
})
