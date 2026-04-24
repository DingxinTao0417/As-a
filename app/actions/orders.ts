"use server"

import { AuthError, requireAuth } from "@/lib/auth"
import { fail, ok } from "@/lib/action-result"
import { calculateFees, createCharge, retrieveCharge } from "@/lib/tap"

type OrderInput = {
  conversationId: string
  serviceNameAr: string
  serviceNameEn: string
  serviceDescriptionAr?: string
  serviceDescriptionEn?: string
  amount: number
  serviceId?: string
}

function normalizeSAR(amount: number) {
  return Math.round(Number(amount) * 100) / 100
}

export async function createOrder(data: OrderInput) {
  try {
    const { user, supabase } = await requireAuth()
    const amount = normalizeSAR(data.amount)

    if (!Number.isFinite(amount) || amount < 1) {
      return fail("Amount must be at least 1.00 SAR")
    }

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("seeker_id, provider_id")
      .eq("id", data.conversationId)
      .single()

    if (convError || !conversation) return fail("Conversation not found")

    const { data: provider, error: providerError } = await supabase
      .from("providers")
      .select("id, user_id")
      .eq("id", conversation.provider_id)
      .single()

    if (providerError || !provider || provider.user_id !== user.id) {
      return fail("You can only create orders for your own provider profile")
    }

    const fees = calculateFees(amount)
    const orderData: Record<string, unknown> = {
      conversation_id: data.conversationId,
      seeker_id: conversation.seeker_id,
      provider_id: conversation.provider_id,
      service_name_ar: data.serviceNameAr,
      service_name_en: data.serviceNameEn,
      service_description_ar: data.serviceDescriptionAr || "",
      service_description_en: data.serviceDescriptionEn || "",
      amount: fees.amount,
      platform_fee: fees.platformFee,
      provider_amount: fees.providerAmount,
      currency: "SAR",
      status: "pending",
      ...(data.serviceId ? { service_id: data.serviceId } : {}),
    }

    const { data: order, error } = await supabase.from("orders").insert(orderData).select().single()
    if (error) {
      console.error("Failed to create order:", error.message)
      return fail("Failed to create order. Please try again.")
    }

    return ok({ order })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    console.error("Unexpected error creating order:", error instanceof Error ? error.message : "Unknown")
    return fail("An unexpected error occurred")
  }
}

export async function createPaymentCharge(orderId: string) {
  try {
    const { user, supabase } = await requireAuth()

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, amount, currency, service_name_en, service_description_en, provider_id, seeker_id, status")
      .eq("id", orderId)
      .single()

    if (orderError || !order) return fail("Order not found")
    if (order.seeker_id !== user.id) return fail("You can only pay for your own orders")
    if (order.status !== "pending") return fail("This order has already been processed")

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!baseUrl?.startsWith("http")) {
      console.error("NEXT_PUBLIC_SITE_URL is not configured")
      return fail("Payment service is not configured")
    }

    const { data: profile } = await supabase.from("profiles").select("email").eq("id", user.id).single()
    const amount = normalizeSAR(Number(order.amount))

    const charge = await createCharge({
      amount,
      currency: order.currency || "SAR",
      description: order.service_name_en || order.service_description_en || "Professional service",
      customerEmail: profile?.email,
      metadata: { order_id: orderId },
      redirectUrl: `${baseUrl}/messages?provider=${order.provider_id}&payment=callback&order_id=${orderId}`,
    })

    await supabase.from("orders").update({ tap_charge_id: charge.id }).eq("id", orderId)
    return ok({ url: charge.transaction?.url || charge.redirect?.url })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    console.error("Payment charge error:", error instanceof Error ? error.message : "Unknown")
    return fail("Failed to create payment")
  }
}

export async function createCheckoutSession(orderId: string) {
  return createPaymentCharge(orderId)
}

export async function completeOrder(orderId: string) {
  try {
    const { user, supabase } = await requireAuth()

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, provider_id, status")
      .eq("id", orderId)
      .single()

    if (orderError || !order) return fail("Order not found")

    const { data: provider } = await supabase
      .from("providers")
      .select("id")
      .eq("id", order.provider_id)
      .eq("user_id", user.id)
      .single()

    if (!provider) return fail("You can only complete your own orders")
    if (order.status !== "paid") return fail("Only paid orders can be marked as complete")

    const { data: updatedOrders, error } = await supabase
      .from("orders")
      .update({ status: "awaiting_confirmation", completed_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "paid")
      .select("id")

    if (error || !updatedOrders?.length) return fail("Failed to complete order")
    return ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to complete order")
  }
}

export async function confirmOrder(orderId: string) {
  try {
    const { user, supabase } = await requireAuth()

    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).single()
    if (orderError || !order) return fail("Order not found")
    if (order.seeker_id !== user.id) return fail("You can only confirm your own orders")
    if (order.status !== "awaiting_confirmation") return fail("This order is not ready for confirmation")

    const { data: confirmedOrders, error: updateError } = await supabase
      .from("orders")
      .update({ status: "completed" })
      .eq("id", orderId)
      .eq("status", "awaiting_confirmation")
      .select("id")

    if (updateError || !confirmedOrders?.length) return fail("Failed to confirm order")

    const { error: historyError } = await supabase.from("service_history").insert({
      seeker_id: order.seeker_id,
      provider_id: order.provider_id,
      service_name_ar: order.service_name_ar,
      service_name_en: order.service_name_en,
      service_description_ar: order.service_description_ar,
      service_description_en: order.service_description_en,
      amount: order.amount,
      status: "completed",
      order_id: order.id,
      service_id: order.service_id,
    })

    if (historyError) console.error("Failed to insert service history:", historyError.message)
    await supabase.rpc("increment_completed_projects", { p_provider_id: order.provider_id })

    return ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to confirm order")
  }
}

export async function verifyPayment(orderId: string) {
  try {
    const { user, supabase } = await requireAuth()

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, seeker_id, tap_charge_id")
      .eq("id", orderId)
      .single()

    if (orderError || !order) return fail("Order not found")
    if (order.seeker_id !== user.id) return fail("You can only verify your own orders")
    if (order.status !== "pending") return ok({ status: order.status })
    if (!order.tap_charge_id) return fail("No payment found for this order")

    const charge = await retrieveCharge(order.tap_charge_id)
    if (charge.status === "CAPTURED") {
      await supabase
        .from("orders")
        .update({ status: "paid", tap_transaction_id: charge.reference?.transaction || charge.id, paid_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("status", "pending")
        .select("id")

      return ok({ status: "paid" })
    }

    return fail("Payment not completed")
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to verify payment")
  }
}

export async function createDirectOrder(serviceId: string) {
  try {
    const { user, supabase } = await requireAuth()

    const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("*, providers(id, user_id)")
      .eq("id", serviceId)
      .single()

    if (serviceError || !service) return fail("Service not found")

    const providerUserId = Array.isArray(service.providers) ? service.providers[0]?.user_id : service.providers?.user_id
    if (providerUserId === user.id) return fail("You cannot purchase your own service")

    const amount = normalizeSAR(Number(service.price))
    if (!Number.isFinite(amount) || amount < 1) return fail("Service price is too low")

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("seeker_id", user.id)
      .eq("service_id", serviceId)
      .eq("status", "pending")
      .maybeSingle()

    if (existingOrder) return ok({ orderId: existingOrder.id })

    const fees = calculateFees(amount)
    let conversationId: string
    const { data: existingConv } = await supabase
      .from("conversations")
      .select("id")
      .eq("seeker_id", user.id)
      .eq("provider_id", service.provider_id)
      .maybeSingle()

    if (existingConv) {
      conversationId = existingConv.id
    } else {
      const { data: newConv, error: convError } = await supabase
        .from("conversations")
        .insert({ seeker_id: user.id, provider_id: service.provider_id })
        .select("id")
        .single()

      if (convError || !newConv) return fail("Failed to initialize order context")
      conversationId = newConv.id
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        conversation_id: conversationId,
        seeker_id: user.id,
        provider_id: service.provider_id,
        service_id: service.id,
        service_name_ar: service.name_ar,
        service_name_en: service.name_en,
        service_description_ar: service.description_ar || "",
        service_description_en: service.description_en || "",
        amount: fees.amount,
        platform_fee: fees.platformFee,
        provider_amount: fees.providerAmount,
        currency: "SAR",
        status: "pending",
      })
      .select("id")
      .single()

    if (orderError || !order) return fail("Failed to create order")
    return ok({ orderId: order.id })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("An unexpected error occurred")
  }
}
