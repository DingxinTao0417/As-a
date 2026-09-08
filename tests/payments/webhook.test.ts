// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/webhooks/tap/route"
import { retrieveCharge } from "@/lib/tap"
import { createAdminClient } from "@/lib/supabase/admin"
import { capturedCharge, orderFixture, signCharge, TEST_KEY } from "./fixtures"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/tap", async (original) => ({ ...await original<typeof import("@/lib/tap")>(), retrieveCharge: vi.fn() }))

const query = { select: vi.fn(), eq: vi.fn(), single: vi.fn() }
const admin = { from: vi.fn(), rpc: vi.fn() }
function request(body = capturedCharge, signature = signCharge(body)) {
  return new NextRequest("https://market.example/api/webhooks/tap", {
    method: "POST", headers: { hashstring: signature, "content-type": "application/json" }, body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("TAP_SECRET_KEY", TEST_KEY)
  vi.mocked(retrieveCharge).mockResolvedValue(capturedCharge)
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)
  admin.from.mockReturnValue(query)
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.single.mockResolvedValue({ data: orderFixture, error: null })
  admin.rpc.mockResolvedValue({ data: "paid", error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe("Tap webhook", () => {
  it("records a verified capture using the trusted transaction", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith("settle_tap_charge", {
      p_order_id: orderFixture.id, p_charge_id: capturedCharge.id, p_transaction_id: "transaction_123", p_amount: 100, p_currency: "SAR",
    })
  })
  it("ignores unsigned metadata changes and resolves the real order through Tap", async () => {
    const tampered = { ...capturedCharge, metadata: { order_id: "99999999-9999-4999-8999-999999999999" } }
    const response = await POST(request(tampered, signCharge(capturedCharge)))
    expect(response.status).toBe(200)
    expect(retrieveCharge).toHaveBeenCalledWith(capturedCharge.id)
    expect(query.eq).toHaveBeenCalledWith("id", orderFixture.id)
    expect(query.eq).not.toHaveBeenCalledWith("id", tampered.metadata.order_id)
  })
  it("rejects forged signatures without database or payment API access", async () => {
    expect((await POST(request(capturedCharge, "00".repeat(32)))).status).toBe(400)
    expect(retrieveCharge).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })
  it("does not trust a signed CAPTURED event when the current charge is not captured", async () => {
    vi.mocked(retrieveCharge).mockResolvedValue({ ...capturedCharge, status: "FAILED" })
    expect((await POST(request())).status).toBe(409)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it.each([
    { amount: 99 }, { currency: "USD" }, { live_mode: true }, { id: "chg_other" },
  ])("rejects amount, currency, mode and charge mismatches %j", async (change) => {
    vi.mocked(retrieveCharge).mockResolvedValue({ ...capturedCharge, ...change })
    expect((await POST(request())).status).toBe(409)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it("returns a retryable response when the ledger transaction fails", async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } })
    expect((await POST(request())).status).toBe(500)
  })
  it("acknowledges non-captured events without mutating the ledger", async () => {
    expect((await POST(request({ ...capturedCharge, status: "FAILED" }))).status).toBe(200)
    expect(retrieveCharge).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it("continues to reconcile payments when new checkouts are disabled", async () => {
    vi.stubEnv("TAP_PAYMENTS_ENABLED", "false")
    expect((await POST(request())).status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledOnce()
  })
  it("bounds the body size even without a Content-Length header", async () => {
    const req = new NextRequest("https://market.example/api/webhooks/tap", { method: "POST", body: "x".repeat(65 * 1024) })
    expect((await POST(req)).status).toBe(413)
    expect(retrieveCharge).not.toHaveBeenCalled()
  })
})
