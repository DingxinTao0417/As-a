"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const uuid = z.string().uuid()
const reviewCursor = z.object({ createdAt: z.string().datetime(), id: uuid })

export async function saveOrderReview(orderId: string,rating: number,comment: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(orderId).success || !Number.isInteger(rating)
        || rating < 1 || rating > 5 || typeof comment !== "string" || comment.length > 5000) {
      return fail("Invalid review")
    }
    const { data: reviewId, error } = await createAdminClient().rpc("save_order_review", {
      p_actor_id: user.id,
      p_order_id: orderId,
      p_rating: rating,
      p_comment: comment,
    })
    return error || !reviewId ? fail("Review could not be saved") : ok({ reviewId: reviewId as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Review could not be saved")
  }
}

export async function deleteOrderReview(reviewId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(reviewId).success) return fail("Invalid review")
    const { error } = await createAdminClient().rpc("delete_order_review", {
      p_actor_id: user.id,
      p_review_id: reviewId,
    })
    return error ? fail("Review could not be deleted") : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Review could not be deleted")
  }
}

type ReviewRow = {
  id: string
  rating: number
  comment: string | null
  created_at: string
  service_name: string | null
  reviewer_id: string
  reviewer_name: string | null
  reviewer_avatar: string | null
  total_count: number
  average_rating: number
  five_count: number
  four_count: number
  three_count: number
  two_count: number
  one_count: number
}

export async function getServiceReviews(
  serviceId: string,
  cursor?: z.infer<typeof reviewCursor>,
  pageSize = 10,
) {
  const parsedCursor = cursor ? reviewCursor.safeParse(cursor) : null
  if (!uuid.safeParse(serviceId).success || !Number.isInteger(pageSize)
      || pageSize < 1 || pageSize > 50 || (parsedCursor && !parsedCursor.success)) {
    return fail("Invalid review page")
  }
  try {
    const value = parsedCursor?.success ? parsedCursor.data : null
    const { data, error } = await createAdminClient().rpc("get_service_review_page", {
      p_service_id: serviceId,
      p_before_created_at: value?.createdAt || null,
      p_before_id: value?.id || null,
      p_limit: pageSize,
    })
    if (error) return fail("Reviews could not be loaded")
    const rows = (data || []) as ReviewRow[]
    const oldest = rows.at(-1)
    const first = rows[0]
    return ok({
      reviews: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        comment: row.comment,
        created_at: row.created_at,
        service_name: row.service_name,
        reviewer_id: row.reviewer_id,
        profiles: { full_name: row.reviewer_name, avatar_url: row.reviewer_avatar },
      })),
      summary: {
        total: Number(first?.total_count || 0),
        average: Number(first?.average_rating || 0),
        counts: [
          Number(first?.five_count || 0),Number(first?.four_count || 0),Number(first?.three_count || 0),
          Number(first?.two_count || 0),Number(first?.one_count || 0),
        ],
      },
      nextCursor: rows.length === pageSize && oldest
        ? { createdAt: oldest.created_at, id: oldest.id }
        : null,
    })
  } catch {
    return fail("Reviews could not be loaded")
  }
}
