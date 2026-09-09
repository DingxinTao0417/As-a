import { recordAndProcessTapPayment,tapPaymentEventKey } from "@/lib/payment-events"
import { retrieveCharge } from "@/lib/tap"

export type ReconciliationAttempt={
  id:string
  order_id:string
  external_charge_id:string
  amount:number|string
  currency:string
}

export async function reconcileTapPaymentAttempt(attempt:ReconciliationAttempt){
  const charge=await retrieveCharge(attempt.external_charge_id)
  if(charge.id!==attempt.external_charge_id
    || Number(charge.amount)!==Number(attempt.amount)
    || charge.currency!==attempt.currency
    || charge.metadata?.order_id!==attempt.order_id
    || (charge.metadata?.payment_attempt_id&&charge.metadata.payment_attempt_id!==attempt.id)){
    return {success:false as const,error:"Tap payment details do not match this attempt"}
  }
  const processed=await recordAndProcessTapPayment({
    source:"reconciliation",eventKey:tapPaymentEventKey("reconciliation",charge),charge,
    claimedOrderId:attempt.order_id,claimedAttemptId:attempt.id,
  })
  if(!processed.success)return processed
  if(processed.data.processing_status!=="processed")return {success:false as const,error:"Payment still requires manual reconciliation"}
  return {success:true as const,data:{externalStatus:charge.status,orderStatus:processed.data.order_status}}
}
