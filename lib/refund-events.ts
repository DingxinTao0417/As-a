import { createAdminClient } from "@/lib/supabase/admin"
import type { TapRefund } from "@/lib/tap"

type RefundEventSource = "checkout" | "webhook" | "reconciliation"

export function tapRefundEventKey(source: RefundEventSource, refund: Pick<TapRefund, "id" | "status" | "created">) {
  return [source, refund.id, refund.status, refund.created ?? "unknown"].join(":")
}

export async function recordAndProcessTapRefund(input: {
  source: RefundEventSource
  eventKey: string
  refund: TapRefund
  claimedRefundRequestId?: string | null
  claimedRefundAttemptId?: string | null
}) {
  const admin = createAdminClient()
  const { data: eventId, error: recordError } = await admin.rpc("record_refund_event", {
    p_source: input.source,
    p_event_key: input.eventKey,
    p_external_refund_id: input.refund.id,
    p_external_status: input.refund.status,
    p_claimed_refund_request_id: input.claimedRefundRequestId || null,
    p_claimed_refund_attempt_id: input.claimedRefundAttemptId || null,
    p_charge_id: input.refund.charge_id,
    p_amount: input.refund.amount,
    p_currency: input.refund.currency,
    p_signature_valid: true,
    p_reference_data: {
      gateway: input.refund.reference?.gateway || null,
      payment: input.refund.reference?.payment || null,
      transaction: input.refund.reference?.transaction || null,
      created: input.refund.created ?? null,
    },
  })
  if (recordError || !eventId) return { success: false as const, error: "Refund event could not be recorded" }
  const { data, error } = await admin.rpc("process_refund_event", { p_event_id: eventId })
  if (error || !data || typeof data !== "object") return { success: false as const, error: "Refund event could not be processed" }
  return { success: true as const, data: data as { processing_status: "processed" | "quarantined"; result: string } }
}
