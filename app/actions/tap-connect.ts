"use server"

import { requireProvider, AuthError } from "@/lib/auth"
import { fail, ok, type ActionResult } from "@/lib/action-result"
import { toSARMinorUnits } from "@/lib/money"
import { createAdminClient } from "@/lib/supabase/admin"

function hasVerifiedAccount(provider: { tap_destination_id?: string | null; tap_onboarding_completed?: boolean; tap_account_status?: string | null }) {
  return Boolean(provider.tap_destination_id && !provider.tap_destination_id.startsWith("tap_placeholder_") &&
    provider.tap_onboarding_completed && provider.tap_account_status === "active")
}

export async function createConnectAccount(): Promise<ActionResult<{ accountId: string; destinationId: string }>> {
  try {
    const { provider } = await requireProvider()
    if (hasVerifiedAccount(provider)) {
      return ok({ accountId: provider.tap_destination_id, destinationId: provider.tap_destination_id })
    }
    // Tap marketplace onboarding requires merchant approval/KYC. Never fabricate an account.
    return fail("Payment account setup requires support verification. Please contact support to complete onboarding.")
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to initialize payment account")
  }
}

export async function createAccountLink(): Promise<ActionResult<{ url: string }>> {
  try {
    await requireProvider()
    return fail("Online payment account setup is not available. Please contact support to complete onboarding.")
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to create payment setup link")
  }
}

export async function checkAccountStatus() {
  try {
    const { provider } = await requireProvider()
    const isComplete = hasVerifiedAccount(provider)
    return ok({ isComplete, chargesEnabled: isComplete, payoutsEnabled: isComplete })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to check payment account status")
  }
}

export async function createPayout(amount: number) {
  try {
    const { user, provider } = await requireProvider()
    if (!hasVerifiedAccount(provider)) return fail("Please complete payment account verification with support first")
    const minor = toSARMinorUnits(amount)
    if (minor === null || minor < 100) return fail("Enter at least 1.00 SAR with at most two decimal places")
    // Reserve funds atomically. Actual settlement is an audited manual operation until
    // Tap marketplace transfers, asynchronous statuses and reconciliation are integrated.
    const { data: requestId, error } = await createAdminClient().rpc("request_provider_withdrawal", {
      p_provider_id: provider.id, p_actor_id: user.id, p_amount: minor / 100,
    })
    if (error || !requestId) return fail("Unable to request withdrawal. Check your available balance and pending requests.")
    return ok({ requestId: requestId as string, status: "pending" as const })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to request payout")
  }
}
