import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { chargeMatchesOrder, getTapSecretKey, retrieveCharge, verifyWebhookSignature } from "@/lib/tap"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
const MAX_WEBHOOK_BYTES = 64 * 1024

async function readPayload(req: NextRequest): Promise<string | null> {
  if (Number(req.headers.get("content-length")) > MAX_WEBHOOK_BYTES) return null
  const reader = req.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_WEBHOOK_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  } finally {
    reader.releaseLock()
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readPayload(req)
    if (body === null) return NextResponse.json({ error: "Payload too large" }, { status: 413 })
    // Tap's webhook HMAC uses the same API secret key as the charge, not a separate secret.
    if (!verifyWebhookSignature(body, req.headers.get("hashstring") || "", getTapSecretKey())) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }
    const event = JSON.parse(body)
    if (event.status !== "CAPTURED") return NextResponse.json({ received: true })

    // Metadata is outside Tap's signed fields. Fetch the authoritative charge before using
    // order_id; a captured webhook replay with edited metadata must not credit another order.
    const charge = await retrieveCharge(event.id)
    if (charge.id !== event.id || charge.status !== "CAPTURED") {
      return NextResponse.json({ error: "Charge is not captured" }, { status: 409 })
    }
    const orderId = charge.metadata?.order_id
    if (!z.string().uuid().safeParse(orderId).success) {
      return NextResponse.json({ error: "Invalid order reference" }, { status: 400 })
    }
    const admin = createAdminClient()
    const { data: order, error } = await admin.from("orders")
      .select("id, amount, currency, status, tap_charge_id").eq("id", orderId).single()
    if (error || !order) return NextResponse.json({ error: "Order unavailable" }, { status: 500 })
    if (!chargeMatchesOrder(charge, order)) {
      return NextResponse.json({ error: "Payment does not match order" }, { status: 409 })
    }
    const { error: updateError } = await admin.rpc("settle_tap_charge", {
      p_order_id: order.id, p_charge_id: charge.id,
      p_transaction_id: charge.reference?.transaction || charge.id,
      p_amount: charge.amount, p_currency: charge.currency,
    })
    if (updateError) return NextResponse.json({ error: "Unable to record payment" }, { status: 500 })
    return NextResponse.json({ received: true })
  } catch {
    console.error("Tap webhook processing failed")
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}
