import Stripe from "stripe"

let stripeInstance: Stripe | null = null

// Lazy initialization of Stripe - only creates instance when needed
export function getStripe(): Stripe {
  if (!stripeInstance) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY

    if (!stripeSecretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY environment variable")
    }

    stripeInstance = new Stripe(stripeSecretKey, {
      apiVersion: "2024-12-18.acacia",
      typescript: true,
    })
  }

  return stripeInstance
}

// Platform fee percentage (15%)
export const PLATFORM_FEE_PERCENTAGE = 0.15

// Calculate platform fee and provider amount
export function calculateFees(amountCents: number) {
  const platformFeeCents = Math.round(amountCents * PLATFORM_FEE_PERCENTAGE)
  const providerAmountCents = amountCents - platformFeeCents

  return {
    amountCents,
    platformFeeCents,
    providerAmountCents,
  }
}

// Format cents to currency string
export function formatCurrency(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}
