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
  serviceId?: string
}) {
  try {
    console.log("[v0] Creating order with data:", JSON.stringify(data, null, 2))

    // Validate amount
    if (data.amountCents < 100) {
      console.log("[v0] Amount too low:", data.amountCents)
      return { error: "Amount must be at least $1.00" }
    }

    // Calculate fees
    const fees = calculateFees(data.amountCents)
    console.log("[v0] Calculated fees:", JSON.stringify(fees, null, 2))

    // Create order in database
    const supabase = await createServerClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    console.log("[v0] Current user:", user?.id)

    if (userError || !user) {
      console.error("[v0] User not authenticated:", userError)
      return { error: "You must be logged in to create an order" }
    }

    console.log("[v0] Verifying provider ownership...")
    const { data: providerCheck, error: providerError } = await supabase
      .from("providers")
      .select("id, user_id")
      .eq("id", data.providerId)
      .single()

    console.log("[v0] Provider check result:", {
      found: !!providerCheck,
      providerId: providerCheck?.id,
      providerUserId: providerCheck?.user_id,
      currentUserId: user.id,
      matches: providerCheck?.user_id === user.id,
    })

    if (providerError || !providerCheck) {
      console.error("[v0] Provider not found:", providerError)
      return { error: "Provider profile not found" }
    }

    if (providerCheck.user_id !== user.id) {
      console.error("[v0] Provider ownership mismatch:", {
        providerUserId: providerCheck.user_id,
        currentUserId: user.id,
      })
      return { error: "You can only create orders for your own provider profile" }
    }

    console.log("[v0] Provider ownership verified successfully")

    const orderData: Record<string, any> = {
      conversation_id: data.conversationId,
      seeker_id: data.seekerId,
      provider_id: data.providerId,
      service_name_ar: data.serviceNameAr,
      service_name_en: data.serviceNameEn,
      service_description_ar: data.serviceDescriptionAr || "",
      service_description_en: data.serviceDescriptionEn || "",
      amount_cents: fees.amountCents,
      platform_fee_cents: fees.platformFeeCents,
      provider_amount_cents: fees.providerAmountCents,
      status: "pending",
    }

    if (data.serviceId) {
      orderData.service_id = data.serviceId
    }

    console.log("[v0] Inserting order data:", JSON.stringify(orderData, null, 2))

    const { data: order, error } = await supabase.from("orders").insert(orderData).select().single()

    if (error) {
      console.error("[v0] Database error details:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      })
      return { error: `Failed to create order: ${error.message}` }
    }

    console.log("[v0] Order created successfully:", order)
    return { order }
  } catch (error) {
    console.error("[v0] Unexpected error creating order:", error)
    return { error: `Failed to create order: ${error instanceof Error ? error.message : "Unknown error"}` }
  }
}

export async function createCheckoutSession(orderId: string) {
  try {
    console.log("[v0] ========== CREATING CHECKOUT SESSION ==========")
    console.log("[v0] Order ID:", orderId)

    const supabase = await createServerClient()

    console.log("[v0] Fetching order details...")
    const { data: orders, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId)

    console.log("[v0] Orders query result:", { orders, orderError })

    if (orderError || !orders || orders.length === 0) {
      console.error("[v0] Order not found:", orderError)
      return { error: "Order not found" }
    }

    const order = orders[0]
    console.log("[v0] Order found:", {
      id: order.id,
      amount_cents: order.amount_cents,
      service_name: order.service_name_en,
      status: order.status,
    })

    console.log("[v0] Fetching seeker email...")
    const { data: seekers, error: seekerError } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", order.seeker_id)

    const seekerEmail = seekers && seekers.length > 0 ? seekers[0].email : null
    console.log("[v0] Seeker email:", seekerEmail)

    console.log("[v0] Initializing Stripe...")
    const stripe = getStripe()
    console.log("[v0] Stripe initialized:", !!stripe)

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.startsWith("http")
      ? process.env.NEXT_PUBLIC_SITE_URL
      : "https://v0-professional-services-platform-ruby.vercel.app"

    console.log("[v0] Base URL:", baseUrl)

    const sessionConfig = {
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: order.currency || "usd",
            product_data: {
              name: order.service_name_en || "Service",
              description: order.service_description_en || "Professional service",
            },
            unit_amount: order.amount_cents,
          },
          quantity: 1,
        },
      ],
      mode: "payment" as const,
      success_url: `${baseUrl}/messages?payment=success&order_id=${orderId}`,
      cancel_url: `${baseUrl}/messages?payment=cancelled`,
      metadata: {
        order_id: orderId,
        platform_fee_cents: order.platform_fee_cents.toString(),
        provider_amount_cents: order.provider_amount_cents.toString(),
      },
    }

    console.log("[v0] Creating Stripe checkout session with config:", JSON.stringify(sessionConfig, null, 2))

    const session = await stripe.checkout.sessions.create(sessionConfig)

    console.log("[v0] Checkout session created successfully:", {
      id: session.id,
      url: session.url,
    })

    console.log("[v0] Updating order with session ID...")
    await supabase.from("orders").update({ stripe_checkout_session_id: session.id }).eq("id", orderId)

    console.log("[v0] ========== CHECKOUT SESSION CREATED ==========")
    return { url: session.url }
  } catch (error) {
    console.error("[v0] ========== CHECKOUT SESSION ERROR ==========")
    console.error("[v0] Error type:", error?.constructor?.name)
    console.error("[v0] Error message:", error instanceof Error ? error.message : String(error))
    console.error("[v0] Error stack:", error instanceof Error ? error.stack : "No stack trace")
    console.error("[v0] Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2))
    return { error: `Failed to create checkout session: ${error instanceof Error ? error.message : "Unknown error"}` }
  }
}

export async function completeOrder(orderId: string) {
  try {
    console.log("[v0] Completing order:", orderId)

    const supabase = await createServerClient()

    const { data: order, error } = await supabase
      .from("orders")
      .update({
        status: "awaiting_confirmation",
        completed_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select()
      .single()

    if (error) {
      console.error("[v0] Error updating order:", error)
      return { error: "Failed to complete order" }
    }

    console.log("[v0] Order marked as awaiting confirmation")
    return { success: true }
  } catch (error) {
    console.error("[v0] Error completing order:", error)
    return { error: "Failed to complete order" }
  }
}

export async function confirmOrder(orderId: string) {
  try {
    console.log("[v0] Confirming order completion:", orderId)

    const supabase = await createServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: "You must be logged in" }
    }

    // Get order details
    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).single()

    if (orderError || !order) {
      return { error: "Order not found" }
    }

    // Verify the user is the seeker
    if (order.seeker_id !== user.id) {
      return { error: "You can only confirm your own orders" }
    }

    // Update order status to completed
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "completed",
      })
      .eq("id", orderId)

    if (updateError) {
      console.error("[v0] Error updating order:", updateError)
      return { error: "Failed to confirm order" }
    }

    // Add to service history
    await supabase.from("service_history").insert({
      seeker_id: order.seeker_id,
      provider_id: order.provider_id,
      service_name_ar: order.service_name_ar,
      service_name_en: order.service_name_en,
      service_description_ar: order.service_description_ar,
      service_description_en: order.service_description_en,
      amount: order.provider_amount_cents / 100,
      status: "completed",
    })

    console.log("[v0] Order confirmed and added to history")
    return { success: true }
  } catch (error) {
    console.error("[v0] Error confirming order:", error)
    return { error: "Failed to confirm order" }
  }
}

export async function verifyPayment(orderId: string) {
  try {
    console.log("[v0] Verifying payment for order:", orderId)

    const supabase = await createServerClient()

    // Get the order with the stored checkout session ID
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single()

    if (orderError || !order) {
      console.error("[v0] Order not found:", orderError)
      return { error: "Order not found" }
    }

    // If already paid, no need to verify
    if (order.status !== "pending") {
      console.log("[v0] Order already in status:", order.status)
      return { success: true, status: order.status }
    }

    // Check if we have a checkout session ID
    if (!order.stripe_checkout_session_id) {
      console.error("[v0] No checkout session ID stored for order")
      return { error: "No checkout session found for this order" }
    }

    // Verify the checkout session with Stripe
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id)

    console.log("[v0] Stripe session status:", session.payment_status)

    if (session.payment_status === "paid") {
      // Update order to paid
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "paid",
          stripe_payment_intent_id: session.payment_intent as string,
          paid_at: new Date().toISOString(),
        })
        .eq("id", orderId)

      if (updateError) {
        console.error("[v0] Error updating order:", updateError)
        return { error: "Failed to update order status" }
      }

      console.log("[v0] Order updated to paid status via URL callback")
      return { success: true, status: "paid" }
    }

    return { error: "Payment not completed", status: session.payment_status }
  } catch (error) {
    console.error("[v0] Error verifying payment:", error)
    return { error: `Failed to verify payment: ${error instanceof Error ? error.message : "Unknown error"}` }
  }
}
