"use server"

import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

type CustomerOrderRow = {
  id: string
  service_id: string | null
  provider_name_ar: string
  provider_name_en: string
  provider_avatar: string | null
  service_name_ar: string
  service_name_en: string
  service_description_ar: string | null
  service_description_en: string | null
  amount: number
  status: string
  display_at: string
  review_id: string | null
  review_rating: number | null
  review_comment: string | null
  total_count: number
}

export async function getMyOrders(page = 1,pageSize = 20) {
  try {
    const { user } = await requireAuth()
    if (!Number.isInteger(page) || page < 1 || page > 100000
        || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      return fail("Invalid order page")
    }
    const { data, error } = await createAdminClient().rpc("get_customer_order_page", {
      p_actor_id: user.id,
      p_offset: (page - 1) * pageSize,
      p_limit: pageSize,
    })
    if (error) return fail("Orders could not be loaded")
    const rows = (data || []) as CustomerOrderRow[]
    return ok({
      orders: rows.map((row) => ({
        id: row.id,
        service_id: row.service_id,
        provider_name_ar: row.provider_name_ar,
        provider_name_en: row.provider_name_en,
        provider_avatar: row.provider_avatar,
        service_name_ar: row.service_name_ar,
        service_name_en: row.service_name_en,
        service_description_ar: row.service_description_ar || "",
        service_description_en: row.service_description_en || "",
        amount: Number(row.amount),
        status: row.status,
        completed_at: row.display_at,
        review: row.review_id ? {
          id: row.review_id,
          order_id: row.id,
          rating: Number(row.review_rating),
          comment: row.review_comment,
        } : undefined,
      })),
      total: rows.length ? Number(rows[0].total_count) : 0,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Orders could not be loaded")
  }
}
