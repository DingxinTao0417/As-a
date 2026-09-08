import { createHmac } from "node:crypto"
import type { TapCharge } from "@/lib/tap"

export const TEST_KEY = "sk_test_unitsecret"
export const orderFixture = {
  id: "11111111-1111-4111-8111-111111111111",
  seeker_id: "22222222-2222-4222-8222-222222222222",
  provider_id: "33333333-3333-4333-8333-333333333333",
  amount: 100, currency: "SAR", status: "pending", tap_charge_id: "chg_test123",
}
export const capturedCharge: TapCharge = {
  id: "chg_test123", object: "charge", live_mode: false, status: "CAPTURED", amount: 100, currency: "SAR",
  metadata: { order_id: orderFixture.id },
  reference: { payment: "payment_123", gateway: "gateway_123", transaction: "transaction_123" },
  transaction: { created: "1750000000000", url: "https://checkout.tap.company/test123" },
}

export function signCharge(charge: TapCharge, decimals = 2) {
  const fields = [
    "x_id", charge.id, "x_amount", charge.amount.toFixed(decimals), "x_currency", charge.currency,
    "x_gateway_reference", charge.reference?.gateway || "", "x_payment_reference", charge.reference?.payment,
    "x_status", charge.status, "x_created", charge.transaction?.created,
  ]
  return createHmac("sha256", TEST_KEY).update(fields.join("")).digest("hex")
}
