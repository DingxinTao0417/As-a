"use server"

import { createHash } from "node:crypto"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { fail, ok } from "@/lib/action-result"
import { calculateFees, toSARMinorUnits } from "@/lib/money"
import { chargeMatchesOrder, createCharge, getCheckoutUrl, getPaymentSiteUrl, getTapSecretKey, retrieveCharge } from "@/lib/tap"
import { createAdminClient } from "@/lib/supabase/admin"

const uuid = z.string().uuid()
const orderInput = z.object({
  conversationId: uuid,
  serviceNameAr: z.string().trim().min(1).max(200),
  serviceNameEn: z.string().trim().min(1).max(200),
  serviceDescriptionAr: z.string().trim().max(5000).optional(),
  serviceDescriptionEn: z.string().trim().max(5000).optional(),
  amount: z.number().refine((value) => {
    const minor = toSARMinorUnits(value)
    return minor !== null && minor >= 100
  }),
  serviceId: uuid.optional(),
})
type OrderInput = z.infer<typeof orderInput>

export async function createOrder(input: OrderInput) {
  try {
    const { user, supabase } = await requireAuth()
    const parsed = orderInput.safeParse(input)
    if (!parsed.success) return fail("Provide valid order details and an amount of at least 1.00 SAR (maximum two decimal places)")
    const data = parsed.data
    const { data: conversation, error: convError } = await supabase
      .from("conversations").select("seeker_id, provider_id").eq("id", data.conversationId).single()
    if (convError || !conversation) return fail("Conversation not found")
    const { data: provider, error: providerError } = await supabase
      .from("providers").select("id, user_id").eq("id", conversation.provider_id).single()
    if (providerError || !provider || provider.user_id !== user.id) {
      return fail("You can only create orders for your own provider profile")
    }
    if (conversation.seeker_id === user.id) return fail("You cannot create an order for yourself")
    if (data.serviceId) {
      const { data: service, error } = await supabase.from("services").select("id")
        .eq("id", data.serviceId).eq("provider_id", provider.id).eq("is_active", true).single()
      if (error || !service) return fail("Service does not belong to this provider or is unavailable")
    }
    const fees = calculateFees(data.amount)
    const { data: order, error } = await createAdminClient().from("orders").insert({
      conversation_id: data.conversationId,
      seeker_id: conversation.seeker_id,
      provider_id: provider.id,
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
    }).select().single()
    if (error || !order) return fail("Failed to create order. Please try again.")
    return ok({ order })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    console.error("Order creation failed")
    return fail("An unexpected error occurred")
  }
}

export async function createPaymentCharge(orderId: string) {
  try {
    const { user, supabase } = await requireAuth()
    if (process.env.TAP_PAYMENTS_ENABLED !== "true") return fail("Payments are currently unavailable")
    if (!uuid.safeParse(orderId).success) return fail("Invalid order")
    const { data: order, error: orderError } = await supabase.from("orders")
      .select("id, amount, currency, service_name_en, provider_id, seeker_id, status, tap_charge_id")
      .eq("id", orderId).single()
    if (orderError || !order) return fail("Order not found")
    if (order.seeker_id !== user.id) return fail("You can only pay for your own orders")
    if (order.status !== "pending") return fail("This order has already been processed")
    const minor = toSARMinorUnits(Number(order.amount))
    if (minor === null || minor < 100 || order.currency !== "SAR") return fail("Invalid order amount or currency")

    const redirect = new URL("/messages", getPaymentSiteUrl())
    redirect.search = new URLSearchParams({ provider: order.provider_id, payment: "callback", order_id: orderId }).toString()
    // Detect local misconfiguration before reserving an otherwise cancellable order.
    getTapSecretKey()
    const admin = createAdminClient()
    const { error: reservationError } = await admin.rpc("begin_order_checkout", {
      p_order_id: order.id, p_actor_id: user.id,
    })
    if (reservationError) return fail("This order changed or was cancelled. Please refresh before paying.")
    if (order.tap_charge_id) {
      const previous = await retrieveCharge(order.tap_charge_id)
      if (!chargeMatchesOrder(previous, order)) return fail("Payment details do not match this order")
      if (previous.status === "CAPTURED") {
        const { error } = await admin.rpc("settle_tap_charge", {
          p_order_id: order.id, p_charge_id: previous.id,
          p_transaction_id: previous.reference?.transaction || previous.id,
          p_amount: previous.amount, p_currency: previous.currency,
        })
        return error ? fail("Failed to record payment. Please try again.") : ok({ url: redirect.toString() })
      }
      if (["INITIATED", "IN_PROGRESS"].includes(previous.status)) {
        const url = getCheckoutUrl(previous)
        return url ? ok({ url }) : fail("Payment is still processing. Please try again later.")
      }
      if (!["VOID", "CANCELLED", "FAILED", "DECLINED", "RESTRICTED", "ABANDONED", "TIMEDOUT"].includes(previous.status)) {
        return fail("Payment is still processing. Please try again later.")
      }
    }

    // Concurrent requests and retries after a network failure share the same Tap reference.
    const idempotencyKey = createHash("sha256").update(`${order.id}:${order.tap_charge_id || "initial"}`).digest("hex")
    const charge = await createCharge({
      amount: minor / 100,
      currency: order.currency,
      description: order.service_name_en || "Professional service",
      customerEmail: user.email,
      metadata: { order_id: orderId },
      redirectUrl: redirect.toString(),
      idempotencyKey,
    })
    if (!chargeMatchesOrder(charge, { ...order, tap_charge_id: null })) return fail("Payment details do not match this order")

    // Compare-and-set prevents an older response overwriting a newer payment attempt.
    let save = admin.from("orders").update({ tap_charge_id: charge.id }).eq("id", orderId).eq("status", "pending")
    save = order.tap_charge_id ? save.eq("tap_charge_id", order.tap_charge_id) : save.is("tap_charge_id", null)
    const { data: saved, error: saveError } = await save.select("id")
    if (saveError) return fail("Failed to save payment. Please try again.")
    if (!saved?.length) {
      const { data: current, error } = await admin.from("orders").select("tap_charge_id, status").eq("id", orderId).single()
      if (error || !current || current.tap_charge_id !== charge.id) return fail("Order changed. Please refresh and try again.")
      if (current.status !== "pending") return ok({ url: redirect.toString() })
    }
    if (charge.status === "CAPTURED") {
      const { error } = await admin.rpc("settle_tap_charge", {
        p_order_id: order.id, p_charge_id: charge.id, p_transaction_id: charge.reference?.transaction || charge.id,
        p_amount: charge.amount, p_currency: charge.currency,
      })
      return error ? fail("Failed to record payment. Please try again.") : ok({ url: redirect.toString() })
    }
    const url = getCheckoutUrl(charge)
    return url && ["INITIATED", "IN_PROGRESS"].includes(charge.status)
      ? ok({ url }) : fail("Payment was not initiated. Please try again.")
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    console.error("Payment charge creation failed")
    return fail("Failed to create payment")
  }
}

export async function createCheckoutSession(orderId: string) {
  return createPaymentCharge(orderId)
}

export async function cancelPendingOrder(orderId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(orderId).success) return fail("Invalid order")
    const { error } = await createAdminClient().rpc("cancel_pending_order", {
      p_order_id: orderId, p_actor_id: user.id,
    })
    return error
      ? fail("This order can no longer be cancelled online. Check its payment status before requesting cancellation.")
      : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to cancel order")
  }
}

export async function completeOrder(orderId: string) {
  try {
    const { user, supabase } = await requireAuth()
    if (!uuid.safeParse(orderId).success) return fail("Invalid order")
    const { data: order, error: orderError } = await supabase.from("orders")
      .select("id, provider_id, status").eq("id", orderId).single()
    if (orderError || !order) return fail("Order not found")
    const { data: provider, error: providerError } = await supabase.from("providers").select("id")
      .eq("id", order.provider_id).eq("user_id", user.id).single()
    if (providerError || !provider) return fail("You can only complete your own orders")
    if (order.status !== "paid") return fail("Only paid orders can be marked as complete")
    const { data: updated, error } = await createAdminClient().from("orders")
      .update({ status: "awaiting_confirmation", completed_at: new Date().toISOString() })
      .eq("id", orderId).eq("provider_id", provider.id).eq("status", "paid").select("id")
    return error || !updated?.length ? fail("Failed to complete order") : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to complete order")
  }
}

export async function confirmOrder(orderId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(orderId).success) return fail("Invalid order")
    // This service-only function verifies the actor while holding the order row lock.
    const { error } = await createAdminClient().rpc("confirm_order", { p_order_id: orderId, p_actor_id: user.id })
    return error ? fail("Order cannot be confirmed") : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to confirm order")
  }
}

export async function verifyPayment(orderId: string) {
  try {
    const { user, supabase } = await requireAuth()
    if (!uuid.safeParse(orderId).success) return fail("Invalid order")
    const { data: order, error: orderError } = await supabase.from("orders")
      .select("id, status, seeker_id, tap_charge_id, amount, currency").eq("id", orderId).single()
    if (orderError || !order) return fail("Order not found")
    if (order.seeker_id !== user.id) return fail("You can only verify your own orders")
    if (order.status !== "pending") return ok({ status: order.status })
    if (!order.tap_charge_id) return fail("No payment found for this order")
    const charge = await retrieveCharge(order.tap_charge_id)
    if (!chargeMatchesOrder(charge, order)) return fail("Payment details do not match this order")
    if (charge.status !== "CAPTURED") return fail("Payment not completed")
    const { data: status, error } = await createAdminClient().rpc("settle_tap_charge", {
      p_order_id: order.id, p_charge_id: charge.id,
      p_transaction_id: charge.reference?.transaction || charge.id,
      p_amount: charge.amount, p_currency: charge.currency,
    })
    if (error || !status) return fail("Failed to record payment. Please try again.")
    return ok({ status: status as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to verify payment")
  }
}

export async function createDirectOrder(serviceId: string) {
  try {
    const { user, supabase } = await requireAuth()
    if (!uuid.safeParse(serviceId).success) return fail("Invalid service")
    const { data: service, error: serviceError } = await supabase.from("services")
      .select("*, providers(id, user_id)").eq("id", serviceId).eq("is_active", true).single()
    if (serviceError || !service) return fail("Service not found or unavailable")
    const provider = Array.isArray(service.providers) ? service.providers[0] : service.providers
    if (!provider) return fail("Service provider is unavailable")
    if (provider.user_id === user.id) return fail("You cannot purchase your own service")
    const minor = toSARMinorUnits(Number(service.price))
    if (minor === null || minor < 100) return fail("Service price is invalid")
    // The transaction re-reads the service and price and serializes duplicate checkout requests.
    const { data: orderId, error } = await createAdminClient().rpc("create_direct_order", {
      p_service_id: serviceId, p_actor_id: user.id,
    })
    if (error || !orderId) return fail("Failed to create order")
    return ok({ orderId: orderId as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("An unexpected error occurred")
  }
}
