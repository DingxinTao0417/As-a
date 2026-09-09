import { type NextRequest, NextResponse } from "next/server"
import { verifyWebhookSignature, type TapRefund } from "@/lib/tap"
import { recordAndProcessTapPayment, tapPaymentEventKey, type TapPaymentObservation } from "@/lib/payment-events"
import { recordAndProcessTapRefund, tapRefundEventKey } from "@/lib/refund-events"

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const signature = req.headers.get("hashstring") || ""
    const webhookSecret = process.env.TAP_WEBHOOK_SECRET || process.env.TAP_SECRET_KEY

    if (!webhookSecret) {
      console.error("TAP_WEBHOOK_SECRET not configured")
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
    }

    let event: Record<string, unknown>
    try {
      event = JSON.parse(body) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    if (!verifyWebhookSignature(event as Parameters<typeof verifyWebhookSignature>[0], signature, webhookSecret)) {
      console.error("Webhook signature verification failed")
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
    }

    const metadata = event.metadata && typeof event.metadata === "object"
      ? event.metadata as Record<string, unknown>
      : {}
    const transaction = event.transaction && typeof event.transaction === "object"
      ? event.transaction as Record<string, unknown>
      : {}
    const reference = event.reference && typeof event.reference === "object"
      ? event.reference as Record<string, unknown>
      : {}
    const source = "webhook" as const
    const eventId = String(event.id)
    const isRefund = event.object === "refund" || eventId.startsWith("re_") || eventId.startsWith("rfnd_")
    if (isRefund) {
      const chargeObject = event.charge && typeof event.charge === "object"
        ? event.charge as Record<string, unknown>
        : {}
      const refund: TapRefund = {
        id: eventId,
        status: String(event.status),
        amount: Number(event.amount),
        currency: String(event.currency),
        charge_id: typeof event.charge_id === "string" ? event.charge_id : String(chargeObject.id || ""),
        created: (event.created ?? transaction.created) as string | number | undefined,
        metadata: Object.fromEntries(
          Object.entries(metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        ),
        reference: {
          transaction: typeof reference.transaction === "string" ? reference.transaction : undefined,
          gateway: typeof reference.gateway === "string" ? reference.gateway : undefined,
          payment: typeof reference.payment === "string" ? reference.payment : undefined,
        },
      }
      const processed = await recordAndProcessTapRefund({
        source,
        eventKey: tapRefundEventKey(source, refund),
        refund,
        claimedRefundRequestId: typeof metadata.refund_request_id === "string" ? metadata.refund_request_id : null,
        claimedRefundAttemptId: typeof metadata.refund_attempt_id === "string" ? metadata.refund_attempt_id : null,
      })
      if (!processed.success) {
        console.error("Failed to persist Tap refund webhook:", processed.error)
        return NextResponse.json({ error: processed.error }, { status: 500 })
      }
      return NextResponse.json({ received: true, processingStatus: processed.data.processing_status })
    }

    const charge: TapPaymentObservation = {
      id: eventId,
      status: String(event.status),
      amount: Number(event.amount),
      currency: String(event.currency),
      transaction: { created: transaction.created as string | number },
      reference: {
        transaction: typeof reference.transaction === "string" ? reference.transaction : undefined,
        gateway: typeof reference.gateway === "string" ? reference.gateway : undefined,
        payment: typeof reference.payment === "string" ? reference.payment : undefined,
      },
    }
    const processed = await recordAndProcessTapPayment({
      source,
      eventKey: tapPaymentEventKey(source, charge),
      charge,
      claimedOrderId: typeof metadata.order_id === "string" ? metadata.order_id : null,
      claimedAttemptId: typeof metadata.payment_attempt_id === "string" ? metadata.payment_attempt_id : null,
    })
    if (!processed.success) {
      console.error("Failed to persist Tap webhook:", processed.error)
      return NextResponse.json({ error: processed.error }, { status: 500 })
    }

    return NextResponse.json({
      received: true,
      processingStatus: processed.data.processing_status,
    })
  } catch (error) {
    console.error("Webhook error:", error instanceof Error ? error.message : "Unknown")
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}
