"use server"

import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { fail, ok } from "@/lib/action-result"
import { createCharge, retrieveCharge } from "@/lib/tap"
import { createAdminClient } from "@/lib/supabase/admin"
import { recordAndProcessTapPayment, tapPaymentEventKey } from "@/lib/payment-events"

type OrderInput = {
  conversationId: string
  clientRequestId: string
  serviceNameAr: string
  serviceNameEn: string
  serviceDescriptionAr?: string
  serviceDescriptionEn?: string
  amount: number
  serviceId?: string
}

const uuidSchema = z.string().uuid()
const conversationOrderCursor=z.object({createdAt:z.string().datetime(),id:uuidSchema})
export type ConversationOrderCursor=z.infer<typeof conversationOrderCursor>
const orderInputSchema = z.object({
  conversationId: uuidSchema,
  clientRequestId: uuidSchema,
  serviceNameAr: z.string().trim().min(1).max(200),
  serviceNameEn: z.string().trim().min(1).max(200),
  serviceDescriptionAr: z.string().max(5000).optional(),
  serviceDescriptionEn: z.string().max(5000).optional(),
  amount: z.number().finite().min(1).max(1000000),
  serviceId: uuidSchema.optional(),
})
const deliverySchema = z.object({
  orderId: uuidSchema,
  clientRequestId: uuidSchema,
  note: z.string().trim().min(3).max(5000),
  links: z.array(z.string().trim().url().startsWith("https://").max(2000)).max(5),
  files: z.array(z.object({
    path:z.string().min(1).max(500),
    name:z.string().trim().min(1).max(255).refine((value)=>!/[\\/]/.test(value)),
    mime:z.enum([
      "application/pdf","application/zip","application/x-zip-compressed","text/plain",
      "image/jpeg","image/png","image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]),
    size:z.number().int().min(1).max(25*1024*1024),
  })).max(5).default([]),
})
const revisionSchema = z.object({
  orderId: uuidSchema,
  reason: z.string().trim().min(3).max(2000),
})

function normalizeSAR(amount: number) {
  return Math.round(Number(amount) * 100) / 100
}

type PaymentAttempt = {
  id: string
  status: string
  external_charge_id: string | null
  checkout_url: string | null
  is_new?: boolean
}

function asPaymentAttempt(value: unknown): PaymentAttempt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const attempt = value as Record<string, unknown>
  if (typeof attempt.id !== "string" || typeof attempt.status !== "string") return null
  return {
    id: attempt.id,
    status: attempt.status,
    external_charge_id: typeof attempt.external_charge_id === "string" ? attempt.external_charge_id : null,
    checkout_url: typeof attempt.checkout_url === "string" ? attempt.checkout_url : null,
    is_new: typeof attempt.is_new === "boolean" ? attempt.is_new : undefined,
  }
}

export async function getConversationOrders(
  conversationId:string,cursor:ConversationOrderCursor|null=null,limit=50,
){
  try{
    const {user}=await requireAuth()
    const parsedCursor=cursor?conversationOrderCursor.safeParse(cursor):null
    if(!uuidSchema.safeParse(conversationId).success||!Number.isInteger(limit)||limit<1||limit>100
      ||(parsedCursor&&!parsedCursor.success))return fail("Invalid conversation order page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_conversation_order_page",{
      p_actor_id:user.id,p_conversation_id:conversationId,p_before_created_at:value?.createdAt||null,
      p_before_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Orders could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.orders))return fail("Orders could not be loaded")
    const rows=snapshot.orders as Array<Record<string,unknown>>;const last=rows.at(-1)
    return ok({
      orders:rows.map((order)=>({...order,amount:Number(order.amount),platform_fee:Number(order.platform_fee),provider_amount:Number(order.provider_amount)})),
      total:Number(snapshot.total||0),
      nextCursor:rows.length===limit&&last?{createdAt:String(last.created_at),id:String(last.id)}:null,
    })
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Orders could not be loaded")
  }
}

export async function createOrder(data: OrderInput) {
  try {
    const { user } = await requireAuth()
    const parsed = orderInputSchema.safeParse(data)
    if (!parsed.success || normalizeSAR(parsed.data.amount) !== parsed.data.amount) {
      return fail("Provide valid order details and an amount with no more than two decimal places")
    }

    const admin = createAdminClient()
    const { data: orderId, error } = await admin.rpc("create_quoted_order", {
      p_conversation_id: parsed.data.conversationId,
      p_actor_id: user.id,
      p_client_request_id: parsed.data.clientRequestId,
      p_service_name_ar: parsed.data.serviceNameAr,
      p_service_name_en: parsed.data.serviceNameEn,
      p_service_description_ar: parsed.data.serviceDescriptionAr || "",
      p_service_description_en: parsed.data.serviceDescriptionEn || "",
      p_amount: parsed.data.amount,
      p_service_id: parsed.data.serviceId || null,
    })
    if (error || !orderId) {
      return fail("Failed to create order. Please try again.")
    }

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single()
    if (orderError || !order) return fail("Order was created but could not be loaded")

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
    if (process.env.TAP_PAYMENTS_ENABLED !== "true") return fail("Payments are currently unavailable")
    if (!uuidSchema.safeParse(orderId).success) return fail("Invalid order")

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, amount, currency, service_name_en, service_description_en, provider_id, seeker_id, status")
      .eq("id", orderId)
      .single()

    if (orderError || !order) return fail("Order not found")
    if (order.seeker_id !== user.id) return fail("You can only pay for your own orders")
    if (order.status !== "pending") return fail("This order has already been processed")
    const amount = normalizeSAR(Number(order.amount))
    if (!Number.isFinite(amount) || amount < 1 || order.currency !== "SAR") {
      return fail("Invalid order amount or currency")
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!baseUrl?.startsWith("http")) {
      console.error("NEXT_PUBLIC_SITE_URL is not configured")
      return fail("Payment service is not configured")
    }

    const admin = createAdminClient()
    const { data: attemptData, error: reservationError } = await admin.rpc("begin_payment_attempt", {
      p_order_id: order.id,
      p_actor_id: user.id,
    })
    const attempt = asPaymentAttempt(attemptData)
    if (reservationError || !attempt) return fail("Payment attempt could not be started")

    let charge: Awaited<ReturnType<typeof createCharge>>
    let eventSource: "checkout" | "reconciliation"
    if (attempt.external_charge_id) {
      charge = await retrieveCharge(attempt.external_charge_id)
      eventSource = "reconciliation"
    } else if (attempt.is_new) {
      charge = await createCharge({
        amount,
        currency: order.currency || "SAR",
        description: order.service_name_en || order.service_description_en || "Professional service",
        customerEmail: user.email,
        metadata: { order_id: orderId, payment_attempt_id: attempt.id },
        redirectUrl: `${baseUrl}/messages?provider=${order.provider_id}&payment=callback&order_id=${orderId}`,
      })
      eventSource = "checkout"
    } else {
      return fail("A payment attempt is awaiting reconciliation. Please try again later.")
    }

    if (normalizeSAR(charge.amount) !== amount || charge.currency !== order.currency
        || charge.metadata?.order_id !== order.id
        || (charge.metadata?.payment_attempt_id && charge.metadata.payment_attempt_id !== attempt.id)) {
      return fail("Payment details do not match this order")
    }

    const checkoutUrl = charge.transaction?.url || charge.redirect?.url || attempt.checkout_url
    const { error: saveError } = await admin.rpc("record_tap_charge_attempt", {
      p_attempt_id: attempt.id,
      p_actor_id: user.id,
      p_charge_id: charge.id,
      p_external_status: charge.status,
      p_transaction_id: charge.reference?.transaction || null,
      p_checkout_url: checkoutUrl,
      p_amount: charge.amount,
      p_currency: charge.currency,
    })
    if (saveError) return fail("Payment was created but could not be recorded. Please contact support.")

    const processed = await recordAndProcessTapPayment({
      source: eventSource,
      eventKey: tapPaymentEventKey(eventSource, charge),
      charge,
      claimedOrderId: order.id,
      claimedAttemptId: attempt.id,
    })
    if (!processed.success) return fail(processed.error)
    if (processed.data.processing_status === "quarantined") {
      return fail("Payment requires manual reconciliation. Please contact support.")
    }
    if (charge.status === "CAPTURED" || processed.data.order_status !== "pending") {
      return ok({ url: `${baseUrl}/messages?provider=${order.provider_id}&payment=callback&order_id=${order.id}` })
    }

    if (["FAILED", "DECLINED", "RESTRICTED", "VOID", "CANCELLED", "ABANDONED", "TIMEDOUT", "TIMED_OUT"].includes(charge.status)) {
      return fail("Payment was not completed. You can try again.")
    }
    if(charge.status==="UNKNOWN")return fail("Payment status is unknown and requires reconciliation")
    return checkoutUrl ? ok({ url: checkoutUrl }) : fail("Payment was not initiated. Please try again.")
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    console.error("Payment charge error:", error instanceof Error ? error.message : "Unknown")
    return fail("Failed to create payment")
  }
}

export async function createCheckoutSession(orderId: string) {
  return createPaymentCharge(orderId)
}

export async function cancelPendingOrder(orderId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuidSchema.safeParse(orderId).success) return fail("Invalid order")
    const { error } = await createAdminClient().rpc("cancel_pending_order", {
      p_order_id: orderId,
      p_actor_id: user.id,
    })
    return error
      ? fail("This order can no longer be cancelled online. Check its payment status first.")
      : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to cancel order")
  }
}

export async function submitOrderDelivery(input: {
  orderId: string
  clientRequestId: string
  note: string
  links: string[]
  files?: Array<{path:string;name:string;mime:string;size:number}>
}) {
  try {
    const { user } = await requireAuth()
    const parsed = deliverySchema.safeParse(input)
    if (!parsed.success) return fail("Add a delivery note and up to five valid links and files")
    const { data, error } = await createAdminClient().rpc("submit_order_delivery", {
      p_order_id: parsed.data.orderId,
      p_actor_id: user.id,
      p_client_request_id: parsed.data.clientRequestId,
      p_note: parsed.data.note,
      p_links: parsed.data.links,
      p_files:parsed.data.files,
    })
    if (error || !data) return fail("Only the provider can deliver an eligible order")
    return ok({ delivery: data })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to submit delivery")
  }
}

export async function getOrderDeliveryRequest(orderId:string,clientRequestId:string) {
  try{
    const { user }=await requireAuth()
    if(!uuidSchema.safeParse(orderId).success||!uuidSchema.safeParse(clientRequestId).success)return fail("Invalid delivery request")
    const { data,error }=await createAdminClient().rpc("get_order_delivery_request",{
      p_actor_id:user.id,p_order_id:orderId,p_client_request_id:clientRequestId,
    })
    return error||(data!==null&&(!data||typeof data!=="object"||Array.isArray(data)))
      ?fail("Delivery request could not be checked")
      :ok({delivery:data as Record<string,unknown>|null})
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Delivery request could not be checked")
  }
}

export async function requestOrderRevision(orderId: string, reason: string) {
  try {
    const { user } = await requireAuth()
    const parsed = revisionSchema.safeParse({ orderId, reason })
    if (!parsed.success) return fail("Explain the requested revision in at least 3 characters")
    const { data, error } = await createAdminClient().rpc("request_order_revision", {
      p_order_id: parsed.data.orderId,
      p_actor_id: user.id,
      p_reason: parsed.data.reason,
    })
    if (error || !data) return fail("This delivery can no longer be revised")
    return ok({ status: data as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to request a revision")
  }
}

export async function confirmOrder(orderId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuidSchema.safeParse(orderId).success) return fail("Invalid order")
    const { error } = await createAdminClient().rpc("confirm_order", {
      p_order_id: orderId,
      p_actor_id: user.id,
    })
    if (error) return fail("Only the customer can confirm a delivered order")
    return ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to confirm order")
  }
}

export async function verifyPayment(orderId: string) {
  try {
    const { user, supabase } = await requireAuth()
    if (!uuidSchema.safeParse(orderId).success) return fail("Invalid order")

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, seeker_id, provider_id, amount, currency")
      .eq("id", orderId)
      .single()

    if (orderError || !order) return fail("Order not found")
    if (order.seeker_id !== user.id) return fail("You can only verify your own orders")
    if (order.status !== "pending") return ok({ status: order.status })
    const admin = createAdminClient()
    const { data: attemptData, error: attemptError } = await admin.rpc("get_order_payment_attempt", {
      p_order_id: order.id,
      p_actor_id: user.id,
    })
    const attempt = asPaymentAttempt(attemptData)
    if (attemptError || !attempt) return fail("No payment found for this order")
    if (!attempt.external_charge_id) {
      return fail("Payment is awaiting reconciliation. Please try again later.")
    }

    const charge = await retrieveCharge(attempt.external_charge_id)
    if (normalizeSAR(charge.amount) !== normalizeSAR(Number(order.amount))
        || charge.currency !== order.currency || charge.metadata?.order_id !== order.id) {
      return fail("Payment details do not match this order")
    }

    const checkoutUrl = charge.transaction?.url || charge.redirect?.url || attempt.checkout_url
    const { error: saveError } = await admin.rpc("record_tap_charge_attempt", {
      p_attempt_id: attempt.id,
      p_actor_id: user.id,
      p_charge_id: charge.id,
      p_external_status: charge.status,
      p_transaction_id: charge.reference?.transaction || charge.id,
      p_checkout_url: checkoutUrl,
      p_amount: charge.amount,
      p_currency: charge.currency,
    })
    if (saveError) return fail("Failed to record payment")

    const source = "reconciliation" as const
    const processed = await recordAndProcessTapPayment({
      source,
      eventKey: tapPaymentEventKey(source, charge),
      charge,
      claimedOrderId: order.id,
      claimedAttemptId: attempt.id,
    })
    if (!processed.success) return fail(processed.error)
    if (processed.data.processing_status === "quarantined") {
      return fail("Payment requires manual reconciliation. Please contact support.")
    }
    if (charge.status !== "CAPTURED") return fail("Payment not completed")
    return ok({ status: processed.data.order_status || "paid" })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to verify payment")
  }
}

export async function createDirectOrder(serviceId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuidSchema.safeParse(serviceId).success) return fail("Invalid service")
    const admin=createAdminClient()
    const { data: service, error: serviceError } = await admin
      .from("services")
      .select("id, price_type")
      .eq("id", serviceId)
      .eq("is_active", true)
      .single()
    if (serviceError || !service) return fail("Service not found or unavailable")
    if (service.price_type !== "fixed") return fail("This service requires a confirmed quote before payment")

    const { data: orderId, error } = await admin.rpc("create_direct_order", {
      p_service_id: serviceId,
      p_actor_id: user.id,
    })
    return error || !orderId ? fail("Failed to create order") : ok({ orderId: orderId as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("An unexpected error occurred")
  }
}
