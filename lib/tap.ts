import * as crypto from "crypto"

const TAP_BASE_URL = "https://api.tap.company/v2"
export const PLATFORM_FEE_PERCENTAGE = 0.15
export const VAT_RATE = 0.15

function getTapSecretKey(): string {
  const key = process.env.TAP_SECRET_KEY || process.env.TAP_PLACEHOLDER_SECRET_KEY
  if (!key) {
    throw new Error("Missing TAP_SECRET_KEY environment variable")
  }
  return key
}

function roundSAR(amount: number): number {
  return Math.round(amount * 100) / 100
}

async function tapRequest<T>(endpoint: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const { method = "GET", body } = options
  const response = await fetch(`${TAP_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${getTapSecretKey()}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(`Tap API error: ${error.message || response.statusText}`)
  }

  return response.json()
}

export async function createCharge(params: {
  amount: number
  currency?: string
  description: string
  customerEmail?: string | null
  metadata: Record<string, string>
  redirectUrl: string
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  return tapRequest<TapCharge>("/charges", {
    method: "POST",
    body: {
      amount: roundSAR(params.amount),
      currency: params.currency || "SAR",
      description: params.description,
      source: { id: "src_all" },
      customer: params.customerEmail ? { first_name: "Customer", last_name: "", email: params.customerEmail } : undefined,
      redirect: { url: params.redirectUrl },
      metadata: params.metadata,
      post: siteUrl ? { url: `${siteUrl}/api/webhooks/tap` } : undefined,
    },
  })
}

export async function retrieveCharge(chargeId: string) {
  return tapRequest<TapCharge>(`/charges/${chargeId}`)
}

export async function createRefund(params: { chargeId: string; amount: number; currency?: string; reason?: string }) {
  return tapRequest<TapRefund>("/refunds", {
    method: "POST",
    body: {
      charge_id: params.chargeId,
      amount: roundSAR(params.amount),
      currency: params.currency || "SAR",
      reason: params.reason || "requested_by_customer",
    },
  })
}

export async function createTransfer(params: { amount: number; currency?: string; destinationId: string; description?: string }) {
  return tapRequest<TapTransfer>("/transfers", {
    method: "POST",
    body: {
      amount: roundSAR(params.amount),
      currency: params.currency || "SAR",
      destination: { id: params.destinationId },
      description: params.description || "Platform earnings payout",
    },
  })
}

export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex")

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  } catch {
    return false
  }
}

export function calculateFees(amountInSAR: number) {
  const amount = roundSAR(amountInSAR)
  const platformFee = roundSAR(amount * PLATFORM_FEE_PERCENTAGE)
  const providerAmount = roundSAR(amount - platformFee)
  return { amount, platformFee, providerAmount }
}

export function calculateFeesWithVAT(baseAmount: number) {
  const normalizedBaseAmount = roundSAR(baseAmount)
  const vatAmount = roundSAR(normalizedBaseAmount * VAT_RATE)
  const totalAmount = roundSAR(normalizedBaseAmount + vatAmount)
  const platformFee = roundSAR(normalizedBaseAmount * PLATFORM_FEE_PERCENTAGE)
  return {
    baseAmount: normalizedBaseAmount,
    vatAmount,
    totalAmount,
    platformFee,
    providerAmount: roundSAR(normalizedBaseAmount - platformFee),
  }
}

export function formatSAR(amount: number): string {
  return new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR" }).format(amount)
}

export function formatCurrency(amount: number): string {
  return formatSAR(amount)
}

export interface TapCharge {
  id: string
  status: "INITIATED" | "AUTHORIZED" | "CAPTURED" | "VOID" | "CANCELLED" | "FAILED" | "DECLINED" | "RESTRICTED"
  amount: number
  currency: string
  transaction: { url: string }
  redirect: { url: string }
  metadata: Record<string, string>
  reference?: { transaction?: string }
}

export interface TapRefund {
  id: string
  status: string
  amount: number
  charge_id: string
}

export interface TapTransfer {
  id: string
  status: string
  amount: number
}
