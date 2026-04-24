import { type NextRequest, NextResponse } from "next/server"
import { verifyWebhookSignature } from "@/lib/tap"
import { createServerClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const signature = req.headers.get("hashstring") || ""
    const webhookSecret = process.env.TAP_WEBHOOK_SECRET

    if (!webhookSecret) {
      console.error("TAP_WEBHOOK_SECRET not configured")
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
    }

    if (!verifyWebhookSignature(body, signature, webhookSecret)) {
      console.error("Webhook signature verification failed")
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }

    const event = JSON.parse(body)

    if (event.status === "CAPTURED") {
      const chargeId = event.id
      const orderId = event.metadata?.order_id

      if (!orderId) {
        console.error("No order_id in webhook metadata")
        return NextResponse.json({ error: "No order_id" }, { status: 400 })
      }

      const supabase = await createServerClient()
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "paid",
          tap_charge_id: chargeId,
          tap_transaction_id: event.reference?.transaction || chargeId,
          paid_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("status", "pending")
        .select("id")

      if (updateError) {
        console.error("Failed to update order from Tap webhook:", updateError.message)
        return NextResponse.json({ error: "Failed to update order" }, { status: 500 })
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Webhook error:", error instanceof Error ? error.message : "Unknown")
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}
