"use server"

import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"

type ExportRow = Record<string, unknown>

export async function exportUserData() {
  try {
    const { user, supabase } = await requireAuth()
    // Supabase limits individual responses. Page explicitly so large accounts
    // cannot receive a silently truncated export labelled as complete.
    const readAll = async (table: string, column: string, value: string | string[]) => {
      const rows: ExportRow[] = []
      const pageSize = 500
      let lastId: string | undefined
      for (;;) {
        let query = supabase.from(table).select("*").order("id").limit(pageSize)
        if (lastId) query = query.gt("id", lastId)
        query = Array.isArray(value) ? query.in(column, value) : query.eq(column, value)
        const { data, error } = await query
        if (error || !data) throw new Error("Export query failed")
        rows.push(...data)
        if (data.length < pageSize) return rows
        lastId = String(data[data.length - 1].id)
      }
    }
    const [profileResult, seekerOrders, providerProfiles, sentMessages, reviews, favorites, history] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      readAll("orders", "seeker_id", user.id),
      readAll("providers", "user_id", user.id),
      readAll("messages", "sender_id", user.id),
      readAll("reviews", "reviewer_id", user.id),
      readAll("favorites", "user_id", user.id),
      readAll("service_history", "seeker_id", user.id),
    ])
    if (profileResult.error || !profileResult.data) throw new Error("Export profile failed")
    const providerIds = providerProfiles.map((provider) => String(provider.id))
    const providerOrders = providerIds.length ? await readAll("orders", "provider_id", providerIds) : []
    const withdrawals = providerIds.length ? await readAll("withdrawal_requests", "provider_id", providerIds) : []

    return ok({
      user: { id: user.id, email: user.email, created_at: user.created_at },
      profile: profileResult.data,
      provider_profiles: providerProfiles,
      orders_as_seeker: seekerOrders,
      orders_as_provider: providerOrders,
      withdrawals,
      messages_sent: sentMessages,
      reviews,
      favorites,
      history,
      exported_at: new Date().toISOString(),
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    console.error("Failed to export complete user data")
    return fail("Failed to export complete data. Please try again.")
  }
}
