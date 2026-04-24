"use server"

import { fail, ok } from "@/lib/action-result"
import { requireAuth } from "@/lib/auth"

export async function exportUserData() {
  try {
    const { user, supabase } = await requireAuth()

    const [
      { data: profile },
      { data: seekerOrders },
      { data: providerProfiles },
      { data: sentMessages },
      { data: reviews },
      { data: favorites },
      { data: history },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("orders").select("*").eq("seeker_id", user.id),
      supabase.from("providers").select("*").eq("user_id", user.id),
      supabase.from("messages").select("*").eq("sender_id", user.id),
      supabase.from("reviews").select("*").eq("reviewer_id", user.id),
      supabase.from("favorites").select("*").eq("user_id", user.id),
      supabase.from("service_history").select("*").eq("seeker_id", user.id),
    ])

    const providerIds = (providerProfiles || []).map((provider: { id: string }) => provider.id)
    const { data: providerOrders } = providerIds.length > 0
      ? await supabase.from("orders").select("*").in("provider_id", providerIds)
      : { data: [] }

    return ok({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
      profile,
      provider_profiles: providerProfiles || [],
      orders_as_seeker: seekerOrders || [],
      orders_as_provider: providerOrders || [],
      messages_sent: sentMessages || [],
      reviews: reviews || [],
      favorites: favorites || [],
      history: history || [],
      exported_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Failed to export user data", error)
    return fail("Failed to export data")
  }
}
