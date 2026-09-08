import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { toSARMinorUnits } from "@/lib/money"

export { calculateFees, calculateFeesWithVAT, formatSAR, formatCurrency, PLATFORM_FEE_PERCENTAGE, VAT_RATE } from "@/lib/money"

const TAP_BASE_URL = "https://api.tap.company/v2"
const CURRENCY_DECIMALS: Record<string, number> = {
  AED: 2, BHD: 3, KWD: 3, OMR: 3, QAR: 2, SAR: 2, USD: 2, EUR: 2, GBP: 2, EGP: 2, JOD: 3,
}

export function getTapSecretKey(): string {
  const key = process.env.TAP_SECRET_KEY
  if (!key || !/^sk_(test|live)_[A-Za-z0-9]+$/.test(key)) {
    throw new Error("A valid TAP_SECRET_KEY is required")
  }
  return key
}

export function getPaymentSiteUrl(): URL {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || "")
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local && process.env.NODE_ENV !== "production"))) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a secure site origin")
  }
  return url
}

function validateAmount(amount: number, currency = "SAR") {
  const minor = toSARMinorUnits(amount)
  if (currency !== "SAR" || minor === null || minor < 100) throw new Error("Invalid SAR payment amount")
  return minor / 100
}

async function tapRequest<T>(endpoint: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const { method = "GET", body } = options
  const response = await fetch(`${TAP_BASE_URL}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${getTapSecretKey()}`, "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    // Payment API error bodies can contain customer/payment information.
    throw new Error(`Tap API request failed (${response.status})`)
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
  idempotencyKey: string
}) {
  if (process.env.TAP_PAYMENTS_ENABLED !== "true") throw new Error("Payments are unavailable")
  const siteUrl = getPaymentSiteUrl()
  const redirect = new URL(params.redirectUrl)
  if (redirect.origin !== siteUrl.origin) throw new Error("Invalid payment redirect origin")
  if (!params.idempotencyKey || !params.metadata.order_id) throw new Error("Payment reference is required")
  return tapRequest<TapCharge>("/charges", {
    method: "POST",
    body: {
      amount: validateAmount(params.amount, params.currency),
      currency: "SAR",
      description: params.description.slice(0, 500),
      customer_initiated: true,
      threeDSecure: true,
      save_card: false,
      source: { id: "src_all" },
      customer: { first_name: "Customer", ...(params.customerEmail ? { email: params.customerEmail } : {}) },
      redirect: { url: redirect.toString() },
      metadata: params.metadata,
      // Tap documents reference.idempotent as its duplicate-charge prevention mechanism.
      reference: { order: params.metadata.order_id, transaction: params.idempotencyKey, idempotent: params.idempotencyKey },
      post: { url: new URL("/api/webhooks/tap", siteUrl).toString() },
    },
  })
}

export async function retrieveCharge(chargeId: string) {
  if (!/^chg_[A-Za-z0-9_-]+$/.test(chargeId)) throw new Error("Invalid Tap charge ID")
  return tapRequest<TapCharge>(`/charges/${encodeURIComponent(chargeId)}`)
}

export async function createRefund(params: { chargeId: string; amount: number; currency?: string; reason?: string }) {
  return tapRequest<TapRefund>("/refunds", {
    method: "POST",
    body: {
      charge_id: params.chargeId,
      amount: validateAmount(params.amount, params.currency),
      currency: "SAR",
      reason: params.reason || "requested_by_customer",
    },
  })
}

// Tap signs a canonical set of fields, not the raw JSON body. Metadata is NOT signed.
// https://developers.tap.company/docs/webhook
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(signature) || !secret) return false
  try {
    const event = JSON.parse(payload)
    if (!event || typeof event !== "object" || event.object !== "charge" ||
        typeof event.id !== "string" || !/^chg_[A-Za-z0-9_-]+$/.test(event.id) ||
        typeof event.amount !== "number" || !Number.isFinite(event.amount) || event.amount <= 0 ||
        typeof event.currency !== "string" || !Object.hasOwn(CURRENCY_DECIMALS, event.currency) ||
        typeof event.status !== "string" || !event.status ||
        typeof event.reference?.payment !== "string" || !event.reference.payment ||
        (event.reference.gateway != null && typeof event.reference.gateway !== "string") ||
        !["string", "number"].includes(typeof event.transaction?.created) ||
        !/^\d+$/.test(String(event.transaction.created))) return false

    const canonical = `x_id${event.id}x_amount${event.amount.toFixed(CURRENCY_DECIMALS[event.currency])}` +
      `x_currency${event.currency}x_gateway_reference${event.reference.gateway || ""}` +
      `x_payment_reference${event.reference.payment}x_status${event.status}x_created${event.transaction.created}`
    const expected = createHmac("sha256", secret).update(canonical).digest()
    return timingSafeEqual(Buffer.from(signature, "hex"), expected)
  } catch {
    return false
  }
}

export function chargeMatchesOrder(charge: TapCharge, order: { id: string; amount: number | string; currency: string; tap_charge_id?: string | null }): boolean {
  const expectedAmount = toSARMinorUnits(Number(order.amount))
  const actualAmount = toSARMinorUnits(charge.amount)
  return /^chg_[A-Za-z0-9_-]+$/.test(charge.id) && charge.object === "charge" &&
    charge.metadata?.order_id === order.id && (!order.tap_charge_id || charge.id === order.tap_charge_id) &&
    order.currency === "SAR" && charge.currency === order.currency && expectedAmount !== null && expectedAmount >= 100 &&
    actualAmount === expectedAmount && charge.live_mode === getTapSecretKey().startsWith("sk_live_")
}

export function getCheckoutUrl(charge: TapCharge): string | null {
  try {
    // redirect.url points back to us, and must never be mistaken for the payment page.
    const url = new URL(charge.transaction?.url || "")
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

export interface TapCharge {
  id: string
  object: "charge"
  live_mode: boolean
  status: "INITIATED" | "IN_PROGRESS" | "AUTHORIZED" | "CAPTURED" | "VOID" | "CANCELLED" | "FAILED" | "DECLINED" | "RESTRICTED" | "ABANDONED" | "TIMEDOUT" | "UNKNOWN"
  amount: number
  currency: string
  transaction?: { url?: string; created?: string | number }
  redirect?: { url?: string }
  metadata?: Record<string, string>
  reference?: { transaction?: string; order?: string; gateway?: string; payment?: string }
}

export interface TapRefund {
  id: string
  status: string
  amount: number
  charge_id: string
}
