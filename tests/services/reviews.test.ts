import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), rpc: vi.fn() }))
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))

import { deleteOrderReview, getServiceReviews, saveOrderReview } from "@/app/actions/reviews"

const userId = "10000000-0000-4000-8000-000000000001"
const orderId = "20000000-0000-4000-8000-000000000001"
const serviceId = "30000000-0000-4000-8000-000000000001"
const reviewId = "40000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "save_order_review" ? reviewId
      : name === "get_service_review_page" ? [{
          id: reviewId,
          rating: 5,
          comment: "Great",
          created_at: "2026-09-08T00:00:00.000Z",
          service_name: "Service",
          reviewer_id: userId,
          reviewer_name: "Customer",
          reviewer_avatar: null,
          total_count: 11,
          average_rating: 4.25,
          five_count: 6,
          four_count: 3,
          three_count: 1,
          two_count: 1,
          one_count: 0,
        }]
      : null,
    error: null,
  }))
})

describe("reviews", () => {
  it("creates or updates the review for an authenticated completed order", async () => {
    await expect(saveOrderReview(orderId, 5, "Great")).resolves.toEqual({ success: true, data: { reviewId } })
    expect(mocks.rpc).toHaveBeenCalledWith("save_order_review", {
      p_actor_id: userId,
      p_order_id: orderId,
      p_rating: 5,
      p_comment: "Great",
    })
  })

  it("validates rating and comment before writing", async () => {
    await expect(saveOrderReview(orderId, 6, "bad")).resolves.toEqual({ success: false, error: "Invalid review" })
    await expect(saveOrderReview(orderId, 5, "x".repeat(5001))).resolves.toEqual({ success: false, error: "Invalid review" })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("deletes only through the ownership-checked transaction", async () => {
    await expect(deleteOrderReview(reviewId)).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("delete_order_review", {
      p_actor_id: userId,
      p_review_id: reviewId,
    })
  })

  it("returns a full summary independently of the current review page", async () => {
    const result = await getServiceReviews(serviceId, undefined, 10)
    expect(result).toMatchObject({
      success: true,
      data: {
        summary: { total: 11, average: 4.25, counts: [6, 3, 1, 1, 0] },
        reviews: [{ id: reviewId, profiles: { full_name: "Customer" } }],
      },
    })
  })
})
