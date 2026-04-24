"use server"

import { requireProvider, AuthError } from "@/lib/auth"
import { fail, ok } from "@/lib/action-result"
import { createTransfer } from "@/lib/tap"

export async function createConnectAccount() {
  try {
    const { supabase, provider } = await requireProvider()
    const destinationId = provider.tap_destination_id || `tap_placeholder_${provider.id}`

    const { error } = await supabase
      .from("providers")
      .update({
        tap_destination_id: destinationId,
        tap_account_status: "placeholder",
        tap_onboarding_completed: false,
      })
      .eq("id", provider.id)

    if (error) return fail("Failed to initialize payment account")
    return ok({ accountId: destinationId, destinationId })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to initialize payment account")
  }
}

export async function createAccountLink() {
  try {
    const { provider } = await requireProvider()
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!baseUrl?.startsWith("http")) return fail("Site URL is not configured")

    return ok({
      url: `${baseUrl}/dashboard?tap_onboarding=placeholder&provider=${provider.id}`,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to create payment setup link")
  }
}

export async function checkAccountStatus() {
  try {
    const { provider } = await requireProvider()
    const isComplete = Boolean(provider.tap_destination_id && provider.tap_onboarding_completed)
    return ok({ isComplete, chargesEnabled: isComplete, payoutsEnabled: isComplete })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to check payment account status")
  }
}

export async function createPayout(amount: number) {
  try {
    const { supabase, provider } = await requireProvider()

    if (!provider.tap_destination_id) return fail("Please complete payment setup first")
    if (amount <= 0) return fail("Invalid amount")

    const { data: completedOrders } = await supabase
      .from("orders")
      .select("provider_amount")
      .eq("provider_id", provider.id)
      .eq("status", "completed")

    const totalEarned = (completedOrders || []).reduce((sum, order) => sum + Number(order.provider_amount || 0), 0)

    const { data: completedWithdrawals } = await supabase
      .from("withdrawal_requests")
      .select("amount")
      .eq("provider_id", provider.id)
      .in("status", ["approved", "completed"])

    const totalWithdrawn =
      (completedWithdrawals || []).reduce((sum, withdrawal) => sum + Number(withdrawal.amount || 0), 0)
    const availableBalance = totalEarned - totalWithdrawn

    if (amount > availableBalance) return fail(`Insufficient balance. Available: ${availableBalance.toFixed(2)} SAR`)

    const transfer = await createTransfer({ amount, destinationId: provider.tap_destination_id })

    await supabase.from("withdrawal_requests").insert({
      provider_id: provider.id,
      amount: Math.round(amount * 100) / 100,
      status: "completed",
      tap_transfer_id: transfer.id,
      processed_at: new Date().toISOString(),
    })

    return ok({ transferId: transfer.id })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to create payout")
  }
}
