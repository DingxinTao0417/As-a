// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPaymentCharge, verifyPayment, confirmOrder, createDirectOrder, cancelPendingOrder } from "@/app/actions/orders"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createCharge, retrieveCharge } from "@/lib/tap"
import { capturedCharge, orderFixture, TEST_KEY } from "./fixtures"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(), AuthError: class extends Error {} }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/tap", async (original) => ({
  ...await original<typeof import("@/lib/tap")>(), retrieveCharge: vi.fn(), createCharge: vi.fn(),
}))

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, any> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) }
  for (const name of ["select", "eq", "is", "update", "insert", "single"]) chain[name] = vi.fn(() => chain)
  return chain
}
let orderQuery: ReturnType<typeof query>
let saveQuery: ReturnType<typeof query>
const supabase = { from: vi.fn() }
const admin = { from: vi.fn(), rpc: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("TAP_SECRET_KEY", TEST_KEY)
  vi.stubEnv("TAP_PAYMENTS_ENABLED", "true")
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://market.example")
  vi.mocked(requireAuth).mockResolvedValue({ user: { id: orderFixture.seeker_id, email: "seeker@example.test" }, supabase } as unknown as Awaited<ReturnType<typeof requireAuth>>)
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)
  orderQuery = query({ data: orderFixture, error: null })
  saveQuery = query({ data: [{ id: orderFixture.id }], error: null })
  supabase.from.mockReturnValue(orderQuery)
  admin.from.mockReturnValue(saveQuery)
  admin.rpc.mockResolvedValue({ data: "paid", error: null })
  vi.mocked(retrieveCharge).mockResolvedValue(capturedCharge)
  vi.mocked(createCharge).mockResolvedValue({ ...capturedCharge, status: "INITIATED" })
})
afterEach(() => vi.unstubAllEnvs())

describe("payment actions", () => {
  it("does not report paid when persistence fails", async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { message: "write failed" } })
    expect((await verifyPayment(orderFixture.id)).success).toBe(false)
  })
  it("only verifies the authenticated customer's order", async () => {
    supabase.from.mockReturnValue(query({ data: { ...orderFixture, seeker_id: "another-user" }, error: null }))
    expect((await verifyPayment(orderFixture.id)).success).toBe(false)
    expect(retrieveCharge).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it("requires amount and currency to match before recording payment", async () => {
    vi.mocked(retrieveCharge).mockResolvedValue({ ...capturedCharge, amount: 1 })
    expect((await verifyPayment(orderFixture.id)).success).toBe(false)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it("returns the actual transaction status if another request already advanced the order", async () => {
    admin.rpc.mockResolvedValue({ data: "completed", error: null })
    expect(await verifyPayment(orderFixture.id)).toEqual({ success: true, data: { status: "completed" } })
  })
  it("reuses an existing active checkout without creating a second charge", async () => {
    vi.mocked(retrieveCharge).mockResolvedValue({ ...capturedCharge, status: "INITIATED" })
    expect(await createPaymentCharge(orderFixture.id)).toEqual({ success: true, data: { url: capturedCharge.transaction?.url } })
    expect(createCharge).not.toHaveBeenCalled()
  })
  it("stops before contacting Tap when payments are disabled", async () => {
    vi.stubEnv("TAP_PAYMENTS_ENABLED", "false")
    expect((await createPaymentCharge(orderFixture.id)).success).toBe(false)
    expect(createCharge).not.toHaveBeenCalled()
    expect(retrieveCharge).not.toHaveBeenCalled()
  })
  it("uses a stable idempotency reference and refuses an unpersisted checkout", async () => {
    supabase.from.mockReturnValue(query({ data: { ...orderFixture, tap_charge_id: null }, error: null }))
    admin.from.mockReturnValue(query({ data: null, error: { message: "write failed" } }))
    expect((await createPaymentCharge(orderFixture.id)).success).toBe(false)
    expect((await createPaymentCharge(orderFixture.id)).success).toBe(false)
    const calls = vi.mocked(createCharge).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0].idempotencyKey).toEqual(calls[1][0].idempotencyKey)
  })
  it("binds a charge with compare-and-set before handing out the checkout URL", async () => {
    supabase.from.mockReturnValue(query({ data: { ...orderFixture, tap_charge_id: null }, error: null }))
    expect((await createPaymentCharge(orderFixture.id)).success).toBe(true)
    expect(saveQuery.update).toHaveBeenCalledWith({ tap_charge_id: capturedCharge.id })
    expect(saveQuery.eq).toHaveBeenCalledWith("status", "pending")
    expect(saveQuery.is).toHaveBeenCalledWith("tap_charge_id", null)
    expect(admin.rpc).toHaveBeenCalledWith("begin_order_checkout", { p_order_id: orderFixture.id, p_actor_id: orderFixture.seeker_id })
    expect(admin.rpc.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createCharge).mock.invocationCallOrder[0])
  })
  it("never contacts Tap if cancellation won the reservation race", async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { message: "Order cancelled" } })
    expect((await createPaymentCharge(orderFixture.id)).success).toBe(false)
    expect(createCharge).not.toHaveBeenCalled()
    expect(retrieveCharge).not.toHaveBeenCalled()
  })
  it("does not reserve a cancellable order when payment credentials are missing", async () => {
    vi.stubEnv("TAP_SECRET_KEY", "")
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    expect((await createPaymentCharge(orderFixture.id)).success).toBe(false)
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(createCharge).not.toHaveBeenCalled()
    errorLog.mockRestore()
  })
  it("cancels using the authenticated actor and surfaces a refused cancellation", async () => {
    admin.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: "Checkout started" } })
    expect((await cancelPendingOrder(orderFixture.id)).success).toBe(true)
    expect(admin.rpc).toHaveBeenCalledWith("cancel_pending_order", { p_order_id: orderFixture.id, p_actor_id: orderFixture.seeker_id })
    expect((await cancelPendingOrder(orderFixture.id)).success).toBe(false)
  })
  it("confirms through a single atomic transaction with a server-derived actor", async () => {
    admin.rpc.mockResolvedValue({ data: null, error: null })
    expect((await confirmOrder(orderFixture.id)).success).toBe(true)
    expect(admin.rpc).toHaveBeenCalledWith("confirm_order", { p_order_id: orderFixture.id, p_actor_id: orderFixture.seeker_id })
    expect(admin.from).not.toHaveBeenCalled()
  })
  it("rejects an inactive direct service before creating an order", async () => {
    supabase.from.mockReturnValue(query({ data: null, error: { message: "not found" } }))
    expect((await createDirectOrder(orderFixture.id)).success).toBe(false)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
})
