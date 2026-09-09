import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), rpc: vi.fn() }))
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))

import { getMyOrders } from "@/app/actions/history"

const userId = "10000000-0000-4000-8000-000000000001"
const orderId = "20000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockResolvedValue({ data: [{
    id: orderId,
    service_id: null,
    provider_name_ar: "مزود",
    provider_name_en: "Provider",
    provider_avatar: null,
    service_name_ar: "طلب",
    service_name_en: "Order",
    service_description_ar: null,
    service_description_en: null,
    amount: 100,
    status: "awaiting_confirmation",
    display_at: "2026-09-08T00:00:00.000Z",
    review_id: null,
    review_rating: null,
    review_comment: null,
    total_count: 25,
  }], error: null })
})

describe("customer order history", () => {
  it("loads every order status through a paged ownership-checked query", async () => {
    const result = await getMyOrders(2, 20)
    expect(result).toMatchObject({
      success: true,
      data: { total: 25, orders: [{ id: orderId, status: "awaiting_confirmation", provider_name_en: "Provider" }] },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_customer_order_page", {
      p_actor_id: userId,
      p_offset: 20,
      p_limit: 20,
    })
  })

  it("rejects invalid pages and reports query errors", async () => {
    await expect(getMyOrders(0, 20)).resolves.toEqual({ success: false, error: "Invalid order page" })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") })
    await expect(getMyOrders()).resolves.toEqual({ success: false, error: "Orders could not be loaded" })
  })
})
