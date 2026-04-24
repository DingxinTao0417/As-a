"use server"

import { fail, ok } from "@/lib/action-result"
import { requireAuth } from "@/lib/auth"

export async function requestAccountDeletion() {
  try {
    const { user, supabase } = await requireAuth()

    const { data: providers } = await supabase
      .from("providers")
      .select("id")
      .eq("user_id", user.id)

    const providerIds = (providers || []).map((provider: { id: string }) => provider.id)

    const { data: seekerActiveOrders } = await supabase
      .from("orders")
      .select("id")
      .eq("seeker_id", user.id)
      .in("status", ["pending", "paid", "awaiting_confirmation"])

    const { data: providerActiveOrders } = providerIds.length > 0
      ? await supabase
          .from("orders")
          .select("id")
          .in("provider_id", providerIds)
          .in("status", ["pending", "paid", "awaiting_confirmation"])
      : { data: [] }

    if ((seekerActiveOrders?.length || 0) > 0 || (providerActiveOrders?.length || 0) > 0) {
      return fail("Please complete or cancel all active orders before deleting your account")
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        deletion_requested_at: new Date().toISOString(),
        full_name: "[Deleted User]",
        phone: null,
        avatar_url: null,
      })
      .eq("id", user.id)

    if (profileError) {
      return fail(`Failed to mark account for deletion: ${profileError.message}`)
    }

    await supabase.auth.signOut()
    return ok(undefined)
  } catch (error) {
    console.error("Failed to process deletion request", error)
    return fail("Failed to process deletion request")
  }
}
