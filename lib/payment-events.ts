import { createAdminClient } from "@/lib/supabase/admin"

type PaymentEventSource = "checkout" | "webhook" | "reconciliation"

export type TapPaymentObservation = {
  id: string
  status: string
  amount: number
  currency: string
  transaction?: { created?: string | number }
  reference?: { transaction?: string; gateway?: string; payment?: string }
}

type PaymentEventResult = {
  processing_status: "processed" | "quarantined"
  result: string
  order_status: string | null
}

export function tapPaymentEventKey(source: PaymentEventSource, charge: Pick<TapPaymentObservation, "id" | "status" | "transaction">) {
  return [source, charge.id, charge.status, charge.transaction?.created ?? "unknown"].join(":")
}

export async function recordAndProcessTapPayment(input: {
  source: PaymentEventSource
  eventKey: string
  charge: TapPaymentObservation
  claimedOrderId?: string | null
  claimedAttemptId?: string | null
}) {
  const admin = createAdminClient()
  const { data: eventId, error: recordError } = await admin.rpc("record_payment_event", {
    p_source: input.source,
    p_event_key: input.eventKey,
    p_charge_id: input.charge.id,
    p_external_status: input.charge.status,
    p_claimed_order_id: input.claimedOrderId || null,
    p_claimed_attempt_id: input.claimedAttemptId || null,
    p_amount: input.charge.amount,
    p_currency: input.charge.currency,
    p_signature_valid: true,
    p_reference_data: {
      transaction: input.charge.reference?.transaction || null,
      gateway: input.charge.reference?.gateway || null,
      payment: input.charge.reference?.payment || null,
      created: input.charge.transaction?.created ?? null,
    },
  })
  if (recordError || !eventId) {
    return { success: false as const, error: "Payment event could not be recorded" }
  }

  const { data, error: processError } = await admin.rpc("process_payment_event", {
    p_event_id: eventId,
  })
  if (processError || !data) {
    return { success: false as const, error: "Payment event could not be processed" }
  }

  return { success: true as const, data: data as PaymentEventResult }
}
