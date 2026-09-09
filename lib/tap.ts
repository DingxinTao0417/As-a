import * as crypto from "crypto"

const TAP_BASE_URL = "https://api.tap.company/v2"
export const PLATFORM_FEE_PERCENTAGE = 0.15
export const VAT_RATE = 0.15

function getTapSecretKey(): string {
  const key = process.env.TAP_SECRET_KEY
  if (!key) {
    throw new Error("Missing TAP_SECRET_KEY environment variable")
  }
  return key
}

function getTapMarketplaceSecretKey(): string {
  const key = process.env.TAP_MARKETPLACE_SECRET_KEY
  if (!key) throw new Error("Missing TAP_MARKETPLACE_SECRET_KEY environment variable")
  return key
}

function roundSAR(amount: number): number {
  return Math.round(amount * 100) / 100
}

async function tapRequest<T>(endpoint: string, options: {
  method?: string
  body?: Record<string, unknown>
  authorization?: string
} = {}): Promise<T> {
  const { method = "GET", body,authorization=getTapSecretKey() } = options
  const response = await fetch(`${TAP_BASE_URL}${endpoint}`, {
    method,
    signal:AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${authorization}`,
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

export async function createRefund(params: {
  chargeId: string
  amount: number
  currency?: string
  reason?: "duplicate" | "fraudulent" | "requested_by_customer"
  description?: string
  metadata?: Record<string, string>
  postUrl?: string
}) {
  return tapRequest<TapRefund>("/refunds", {
    method: "POST",
    body: {
      charge_id: params.chargeId,
      amount: roundSAR(params.amount),
      currency: params.currency || "SAR",
      reason: params.reason || "requested_by_customer",
      description: params.description || "Customer refund request",
      metadata: params.metadata,
      post: params.postUrl ? { url: params.postUrl } : undefined,
    },
  })
}

export async function retrieveRefund(refundId: string) {
  return tapRequest<TapRefund>(`/refunds/${refundId}`)
}

export async function retrieveTapDestination(destinationId:string){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(destinationId))throw new Error("Invalid Tap destination ID")
  return tapRequest<TapDestination>(`/destination/${encodeURIComponent(destinationId)}`,{
    authorization:getTapMarketplaceSecretKey(),
  })
}

export function tapDestinationCapabilities(destination:TapDestination){
  const statusValue=typeof destination.status==="string"
    ?destination.status
    :typeof destination.status?.value==="string"
      ?destination.status.value
      :"unknown"
  const status=statusValue.trim().toLowerCase()||"unknown"
  const explicitPayout=destination.payout_enabled===true
    || typeof destination.status==="object"&&destination.status!==null&&destination.status.payout===true
  const chargesEnabled=status==="active"
  return {status,chargesEnabled,payoutsEnabled:chargesEnabled&&explicitPayout}
}

type TapWebhookPayload = {
  id?: string
  amount?: number
  currency?: string
  status?: string
  created?: string | number
  reference?: {
    gateway?: string
    payment?: string
  }
  transaction?: {
    created?: string | number
  }
}

function formatTapWebhookAmount(amount: number, currency: string) {
  const decimals = ["BHD", "JOD", "KWD", "OMR"].includes(currency) ? 3 : 2
  return amount.toFixed(decimals)
}

export function verifyWebhookSignature(payload: TapWebhookPayload, signature: string, secret: string): boolean {
  const created = payload.transaction?.created ?? payload.created
  if (!signature || !secret || !payload.id || !payload.currency || !payload.status
      || payload.amount === undefined || !Number.isFinite(Number(payload.amount))
      || created === undefined) return false

  const currency = payload.currency.toUpperCase()
  const hashInput = [
    "x_id", payload.id,
    "x_amount", formatTapWebhookAmount(Number(payload.amount), currency),
    "x_currency", currency,
    "x_gateway_reference", payload.reference?.gateway || "",
    "x_payment_reference", payload.reference?.payment || "",
    "x_status", payload.status,
    "x_created", String(created),
  ].join("")
  const expectedSignature = crypto.createHmac("sha256", secret).update(hashInput).digest("hex")
  const normalizedSignature = signature.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalizedSignature)) return false

  try {
    return crypto.timingSafeEqual(
      Buffer.from(normalizedSignature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    )
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

export function formatSAR(amount: number,language:"ar"|"en"="ar"): string {
  return new Intl.NumberFormat(language==="ar"?"ar-SA":"en-SA", { style: "currency", currency: "SAR" }).format(amount)
}

export function formatCurrency(amount: number,language:"ar"|"en"="ar"): string {
  return formatSAR(amount,language)
}

export interface TapCharge {
  id: string
  status: "INITIATED" | "AUTHORIZED" | "IN_PROGRESS" | "CAPTURED" | "VOID" | "CANCELLED"
    | "ABANDONED" | "TIMEDOUT" | "TIMED_OUT" | "UNKNOWN" | "FAILED" | "DECLINED" | "RESTRICTED"
  amount: number
  currency: string
  transaction: { url: string; created?: string | number }
  redirect: { url: string }
  metadata: Record<string, string>
  reference?: { transaction?: string; gateway?: string; payment?: string }
}

export interface TapRefund {
  id: string
  status: string
  amount: number
  currency: string
  charge_id: string
  created?: string | number
  metadata?: Record<string, string>
  reference?: { gateway?: string; payment?: string; transaction?: string }
}

export interface TapDestination {
  id:string|number
  status:string|{value?:string;payout?:boolean}
  payout_enabled?:boolean
  display_name?:string
  business_id?:string
  business_entity_id?:string
  wallet_id?:string
}
