"use server"

import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"

export async function requestAccountDeletion() {
  try {
    const { supabase } = await requireAuth()
    // This transaction checks all active orders and pending withdrawals and
    // hides the provider's services before marking the account for deletion.
    const { error } = await supabase.rpc("request_account_deletion")
    if (error) {
      if (error.code === "P0001") {
        return fail("Please resolve active orders and withdrawals and settle your provider balance before deleting your account")
      }
      console.error("Account deletion transaction failed", { code: error.code })
      return fail("Failed to process deletion request")
    }
    await supabase.auth.signOut()
    return ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    console.error("Failed to process deletion request")
    return fail("Failed to process deletion request")
  }
}
