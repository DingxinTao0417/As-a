import { createHmac } from "node:crypto"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))

import { POST } from "@/app/api/webhooks/tap/route"

const secret = "sk_test_webhook"
const event = {
  id: "chg_webhook1",
  status: "CAPTURED",
  amount: 100,
  currency: "SAR",
  metadata: { order_id: "50000000-0000-4000-8000-000000000001" },
  reference: { gateway: "gateway-1", payment: "payment-1", transaction: "transaction-1" },
  transaction: { created: "1788890400000" },
}

function signatureFor(payload = event) {
  const hashInput = [
    "x_id", payload.id,
    "x_amount", Number(payload.amount).toFixed(2),
    "x_currency", payload.currency,
    "x_gateway_reference", payload.reference.gateway,
    "x_payment_reference", payload.reference.payment,
    "x_status", payload.status,
    "x_created", payload.transaction.created,
  ].join("")
  return createHmac("sha256", secret).update(hashInput).digest("hex")
}

function requestFor(payload: typeof event, signature: string) {
  return new NextRequest("http://localhost/api/webhooks/tap", {
    method: "POST",
    headers: { "content-type": "application/json", hashstring: signature },
    body: JSON.stringify(payload),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("TAP_WEBHOOK_SECRET", secret)
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "record_payment_event" || name === "record_refund_event") {
      return { data: "60000000-0000-4000-8000-000000000001", error: null }
    }
    return {
      data: { processing_status: "processed", result: "charge settled", order_status: "paid" },
      error: null,
    }
  })
})

afterEach(() => vi.unstubAllEnvs())

describe("Tap webhook", () => {
  it("persists an authenticated event before processing it", async () => {
    const response = await POST(requestFor(event, signatureFor()))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "record_payment_event", expect.objectContaining({
      p_source: "webhook",
      p_charge_id: event.id,
      p_claimed_order_id: event.metadata.order_id,
      p_amount: event.amount,
      p_currency: event.currency,
    }))
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "process_payment_event", {
      p_event_id: "60000000-0000-4000-8000-000000000001",
    })
  })

  it("rejects a tampered amount before touching the database", async () => {
    const response = await POST(requestFor({ ...event, amount: 99 }, signatureFor()))
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("returns a retryable server error when settlement cannot be persisted", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("database unavailable") })
    const response = await POST(requestFor(event, signatureFor()))
    expect(response.status).toBe(500)
  })

  it("persists non-captured status changes for reconciliation", async () => {
    const pending = { ...event, status: "AUTHORIZED" }
    const response = await POST(requestFor(pending, signatureFor(pending)))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith("record_payment_event", expect.objectContaining({
      p_external_status: "AUTHORIZED",
    }))
  })

  it("persists signed refund webhooks and routes them to the refund processor", async () => {
    const refund = {
      id: "re_refund1",
      object: "refund",
      status: "ACCEPTED",
      amount: 20,
      currency: "SAR",
      charge_id: event.id,
      metadata: {
        refund_request_id: "70000000-0000-4000-8000-000000000001",
        refund_attempt_id: "80000000-0000-4000-8000-000000000001",
      },
      reference: { gateway: "gateway-r", payment: "payment-r" },
      created: "1788890500000",
    }
    const hashInput = [
      "x_id", refund.id,
      "x_amount", refund.amount.toFixed(2),
      "x_currency", refund.currency,
      "x_gateway_reference", refund.reference.gateway,
      "x_payment_reference", refund.reference.payment,
      "x_status", refund.status,
      "x_created", refund.created,
    ].join("")
    const signature = createHmac("sha256", secret).update(hashInput).digest("hex")
    const response = await POST(new NextRequest("http://localhost/api/webhooks/tap", {
      method: "POST",
      headers: { "content-type": "application/json", hashstring: signature },
      body: JSON.stringify(refund),
    }))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith("record_refund_event", expect.objectContaining({
      p_external_refund_id: refund.id,
      p_external_status: "ACCEPTED",
      p_claimed_refund_request_id: refund.metadata.refund_request_id,
      p_claimed_refund_attempt_id: refund.metadata.refund_attempt_id,
    }))
    expect(mocks.rpc).toHaveBeenCalledWith("process_refund_event", {
      p_event_id: "60000000-0000-4000-8000-000000000001",
    })
  })
})
