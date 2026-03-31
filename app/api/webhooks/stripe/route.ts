import { type NextRequest, NextResponse } from "next/server"
import { getStripe } from "@/lib/stripe"
import { createServerClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const sig = req.headers.get("stripe-signature")

    if (!sig) {
      return NextResponse.json({ error: "No signature" }, { status: 400 })
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error("[v0] No webhook secret configured")
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
    }

    const stripe = getStripe()

    let event
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
    } catch (err) {
      console.error("[v0] Webhook signature verification failed:", err)
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }

    console.log("[v0] Stripe webhook event:", event.type)

    // Handle successful payment
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any
      const orderId = session.metadata?.order_id

      if (!orderId) {
        console.error("[v0] No order_id in metadata")
        return NextResponse.json({ error: "No order_id" }, { status: 400 })
      }

      console.log("[v0] Payment successful for order:", orderId)

      // Update order in database
      const supabase = await createServerClient()
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "paid",
          stripe_payment_intent_id: session.payment_intent,
          paid_at: new Date().toISOString(),
        })
        .eq("id", orderId)

      if (updateError) {
        console.error("[v0] Failed to update order to paid:", updateError)
        return NextResponse.json({ error: "Failed to update order" }, { status: 500 })
      }

      console.log("[v0] Order updated to paid status")
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("[v0] Webhook error:", error)
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}
