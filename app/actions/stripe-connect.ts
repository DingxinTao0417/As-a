"use server"

import { createServerClient } from "@/lib/supabase/server"
import { getStripe } from "@/lib/stripe"

export async function createConnectAccount() {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return { success: false, error: "You must be logged in" }
    }

    // Get provider record
    const { data: providers, error: providerError } = await supabase
      .from("providers")
      .select("*")
      .eq("user_id", user.id)
      .limit(1)

    if (providerError || !providers || providers.length === 0) {
      return { success: false, error: "Provider not found" }
    }

    const provider = providers[0]

    // Check if already has Stripe account
    if (provider.stripe_account_id) {
      return { success: false, error: "Stripe account already exists" }
    }

    // Create Stripe Connect account
    const stripe = getStripe()
    const account = await stripe.accounts.create({
      type: "express",
      country: "US", // You may want to make this configurable
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    })

    // Save Stripe account ID
    const { error: updateError } = await supabase
      .from("providers")
      .update({
        stripe_account_id: account.id,
        stripe_account_status: "created",
      })
      .eq("id", provider.id)

    if (updateError) {
      console.error("[v0] Error updating provider:", updateError)
      return { success: false, error: "Failed to save Stripe account" }
    }

    return { success: true, accountId: account.id }
  } catch (error) {
    console.error("[v0] Error creating Stripe Connect account:", error)
    return { success: false, error: "Failed to create Stripe account" }
  }
}

export async function createAccountLink(accountId: string) {
  try {
    const stripe = getStripe()

    // Get the base URL
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.startsWith("http")
      ? process.env.NEXT_PUBLIC_SITE_URL
      : "https://v0-professional-services-platform-ruby.vercel.app"

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/dashboard?refresh=true`,
      return_url: `${baseUrl}/dashboard?success=true`,
      type: "account_onboarding",
    })

    return { success: true, url: accountLink.url }
  } catch (error) {
    console.error("[v0] Error creating account link:", error)
    return { success: false, error: "Failed to create onboarding link" }
  }
}

export async function checkAccountStatus(accountId: string) {
  try {
    const stripe = getStripe()
    const account = await stripe.accounts.retrieve(accountId)

    const isComplete = account.charges_enabled && account.payouts_enabled

    // Update database
    const supabase = await createServerClient()
    await supabase
      .from("providers")
      .update({
        stripe_account_status: isComplete ? "complete" : "incomplete",
        stripe_onboarding_completed: isComplete,
      })
      .eq("stripe_account_id", accountId)

    return {
      success: true,
      isComplete,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    }
  } catch (error) {
    console.error("[v0] Error checking account status:", error)
    return { success: false, error: "Failed to check account status" }
  }
}

export async function createPayout(amount: number) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return { success: false, error: "You must be logged in" }
    }

    // Get provider record
    const { data: providers, error: providerError } = await supabase
      .from("providers")
      .select("*")
      .eq("user_id", user.id)
      .limit(1)

    if (providerError || !providers || providers.length === 0) {
      return { success: false, error: "Provider not found" }
    }

    const provider = providers[0]

    if (!provider.stripe_account_id) {
      return { success: false, error: "Please connect your Stripe account first" }
    }

    if (!provider.stripe_onboarding_completed) {
      return { success: false, error: "Please complete Stripe onboarding first" }
    }

    // Check if provider has enough balance
    if (amount <= 0) {
      return { success: false, error: "Invalid amount" }
    }

    const stripe = getStripe()

    // Create a transfer to the connected account
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: "usd",
      destination: provider.stripe_account_id,
      description: "Platform earnings payout",
    })

    console.log("[v0] Transfer created:", transfer.id)

    return { success: true, transferId: transfer.id }
  } catch (error: any) {
    console.error("[v0] Error creating payout:", error)
    return { success: false, error: error.message || "Failed to create payout" }
  }
}
