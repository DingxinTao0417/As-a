"use server"
import { getStripe, calculateFees } from "@/lib/stripe"
import { createServerClient } from "@/lib/supabase/server"

export async function createOrder(data: {
  conversationId: string
  seekerId: string
  providerId: string
  serviceNameAr: string
  serviceNameEn: string
  serviceDescriptionAr?: string
  serviceDescriptionEn?: string
  amountCents: number
}) {
  try {
    console.log("[v0] Creating order:", data)

    // Validate amount
    if (data.amountCents < 100) {
      return { error: "Amount must be at least $1.00" }
    }

    // Calculate fees
    const fees = calculateFees(data.amountCents)
    console.log("[v0] Calculated fees:", fees)

    // Create order in database
    const supabase = createServerClient()

    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        conversation_id: data.conversationId,
        seeker_id: data.seekerId,
        provider_id: data.providerId,
        service_name_ar: data.serviceNameAr,
        service_name_en: data.serviceNameEn,
        service_description_ar: data.serviceDescriptionAr,
        service_description_en: data.serviceDescriptionEn,
        amount_cents: fees.amountCents,
        platform_fee_cents: fees.platformFeeCents,
        provider_amount_cents: fees.providerAmountCents,
        status: "pending",
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Database error:", error)
      return { error: "Failed to create order" }
    }

    console.log("[v0] Order created:", order)
    return { order }
  } catch (error) {
    console.error("[v0] Error creating order:", error)
    return { error: "Failed to create order" }
  }
}

export async function createCheckoutSession(orderId: string) {
  try {
    console.log("[v0] Creating checkout session for order:", orderId)

    const supabase = createServerClient()

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, seeker:seeker_id(email), provider:provider_id(name_en, name_ar)")
      .eq("id", orderId)
      .single()

    if (orderError || !order) {
      console.error("[v0] Order not found:", orderError)
      return { error: "Order not found" }
    }

    console.log("[v0] Order details:", order)

    const stripe = getStripe()

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: order.currency || "usd",
            product_data: {
              name: order.service_name_en,
              description: order.service_description_en || `Service by ${order.provider?.name_en || "Provider"}`,
            },
            unit_amount: order.amount_cents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/messages?payment=success&order_id=${orderId}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/messages?payment=cancelled`,
      metadata: {
        order_id: orderId,
        platform_fee_cents: order.platform_fee_cents.toString(),
        provider_amount_cents: order.provider_amount_cents.toString(),
      },
    })

    console.log("[v0] Checkout session created:", session.id)

    // Update order with session ID
    await supabase.from("orders").update({ stripe_checkout_session_id: session.id }).eq("id", orderId)

    return { url: session.url }
  } catch (error) {
    console.error("[v0] Error creating checkout session:", error)
    return { error: "Failed to create checkout session" }
  }
}

export async function completeOrder(orderId: string) {
  try {
    console.log("[v0] Completing order:", orderId)

    const supabase = createServerClient()

    // Update order status
    const { data: order, error } = await supabase
      .from("orders")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select()
      .single()

    if (error) {
      console.error("[v0] Error updating order:", error)
      return { error: "Failed to complete order" }
    }

    // Add to service history
    await supabase.from("service_history").insert({
      seeker_id: order.seeker_id,
      provider_id: order.provider_id,
      service_name_ar: order.service_name_ar,
      service_name_en: order.service_name_en,
      service_description_ar: order.service_description_ar,
      service_description_en: order.service_description_en,
      amount: order.provider_amount_cents / 100, // Convert to dollars
      status: "completed",
    })

    console.log("[v0] Order completed successfully")
    return { success: true }
  } catch (error) {
    console.error("[v0] Error completing order:", error)
    return { error: "Failed to complete order" }
  }
}
