import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHmac } from "node:crypto"
import { calculateFees, calculateFeesWithVAT, formatSAR, toSARMinorUnits } from "@/lib/money"
import { chargeMatchesOrder, createCharge, getCheckoutUrl, getPaymentSiteUrl, retrieveCharge, verifyWebhookSignature } from "@/lib/tap"
import { capturedCharge, orderFixture, signCharge, TEST_KEY } from "../payments/fixtures"

vi.mock("server-only", () => ({}))

beforeEach(() => {
  vi.stubEnv("TAP_SECRET_KEY", TEST_KEY)
  vi.stubEnv("TAP_PAYMENTS_ENABLED", "true")
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://market.example")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("calculateFees", () => {
  it("calculates 15% platform fee correctly in SAR", () => {
    const result = calculateFees(100)
    expect(result.amount).toBe(100)
    expect(result.platformFee).toBe(15)
    expect(result.providerAmount).toBe(85)
  })

  it("rounds correctly for decimal SAR amounts", () => {
    const result = calculateFees(99.99)
    expect(result.platformFee + result.providerAmount).toBeCloseTo(99.99, 2)
  })
})

describe("calculateFeesWithVAT", () => {
  it("adds 15% VAT to the base SAR amount", () => {
    const result = calculateFeesWithVAT(100)
    expect(result.baseAmount).toBe(100)
    expect(result.vatAmount).toBe(15)
    expect(result.totalAmount).toBe(115)
    expect(result.platformFee).toBe(15)
    expect(result.providerAmount).toBe(85)
  })
})

describe("formatSAR", () => {
  it("formats SAR currency", () => {
    const result = formatSAR(100)
    expect(result).toMatch(/SAR|ر\.س/)
    expect(result).toMatch(/[100١٠٠]/)
  })
})

describe("payment amount validation", () => {
  it.each([NaN, Infinity, -1, 0.001, 10.555, 100_000_000, "10", null])("rejects invalid amount %s", (amount) => {
    expect(toSARMinorUnits(amount)).toBeNull()
  })
  it("accepts ordinary binary decimal representations", () => {
    expect(toSARMinorUnits(19.99)).toBe(1999)
    expect(toSARMinorUnits(0.1 + 0.2)).toBe(30)
  })
})

describe("Tap webhook protocol", () => {
  it("verifies the official canonical field sequence instead of a raw JSON HMAC", () => {
    const payload = JSON.stringify(capturedCharge)
    expect(verifyWebhookSignature(payload, signCharge(capturedCharge), TEST_KEY)).toBe(true)
    const oldSignature = createHmac("sha256", TEST_KEY).update(payload).digest("hex")
    expect(verifyWebhookSignature(payload, oldSignature, TEST_KEY)).toBe(false)
  })
  it("is independent of JSON field order and whitespace", () => {
    const reordered = Object.fromEntries(Object.entries(capturedCharge).reverse())
    expect(verifyWebhookSignature(JSON.stringify(reordered, null, 2), signCharge(capturedCharge), TEST_KEY)).toBe(true)
  })
  it("formats SAR with two decimals and KWD with three, allowing absent gateway reference", () => {
    const kwd = { ...capturedCharge, currency: "KWD", amount: 3, reference: { payment: "payment_123" } }
    expect(verifyWebhookSignature(JSON.stringify(kwd), signCharge(kwd, 3), TEST_KEY)).toBe(true)
    expect(verifyWebhookSignature(JSON.stringify(kwd), signCharge(kwd, 2), TEST_KEY)).toBe(false)
  })
  it.each(["", "a", "g".repeat(64), "00".repeat(32)])("rejects invalid signatures %s", (signature) => {
    expect(verifyWebhookSignature(JSON.stringify(capturedCharge), signature, TEST_KEY)).toBe(false)
  })
  it("rejects tampering with signed amount or status", () => {
    expect(verifyWebhookSignature(JSON.stringify({ ...capturedCharge, amount: 1000 }), signCharge(capturedCharge), TEST_KEY)).toBe(false)
    expect(verifyWebhookSignature(JSON.stringify({ ...capturedCharge, status: "FAILED" }), signCharge(capturedCharge), TEST_KEY)).toBe(false)
  })
  it.each(["null", "{", "[]", '{"currency":"__proto__"}'])("rejects malformed payload %s", (payload) => {
    expect(verifyWebhookSignature(payload, signCharge(capturedCharge), TEST_KEY)).toBe(false)
  })
})

describe("charge identity and amount checks", () => {
  it("accepts the matching order", () => expect(chargeMatchesOrder(capturedCharge, orderFixture)).toBe(true))
  it.each([
    { amount: 99.99 }, { currency: "USD" }, { id: "chg_other" }, { live_mode: true },
    { metadata: { order_id: "another-order" } }, { amount: 100.001 },
  ])("rejects a mismatched charge %j", (change) => {
    expect(chargeMatchesOrder({ ...capturedCharge, ...change }, orderFixture)).toBe(false)
  })
  it("never uses the merchant callback as a checkout URL", () => {
    expect(getCheckoutUrl({ ...capturedCharge, transaction: {}, redirect: { url: "https://market.example/messages" } })).toBeNull()
    expect(getCheckoutUrl({ ...capturedCharge, transaction: { url: "javascript:alert(1)" } })).toBeNull()
  })
})

describe("Tap requests", () => {
  const params = {
    amount: 100, description: "Professional service", metadata: { order_id: orderFixture.id },
    redirectUrl: "https://market.example/messages", idempotencyKey: "stable-order-attempt-reference",
  }
  it("uses Tap idempotency, a mandatory customer, 3DS, bounded no-cache requests and webhook URL", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => capturedCharge })
    vi.stubGlobal("fetch", request)
    await createCharge(params)
    const [url, options] = request.mock.calls[0]
    expect(url).toBe("https://api.tap.company/v2/charges")
    expect(options.cache).toBe("no-store")
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(options.body)).toMatchObject({
      amount: 100, currency: "SAR", threeDSecure: true, customer: { first_name: "Customer" },
      reference: { order: orderFixture.id, idempotent: params.idempotencyKey },
      post: { url: "https://market.example/api/webhooks/tap" },
    })
  })
  it("fails closed when payments have not been enabled", async () => {
    vi.stubEnv("TAP_PAYMENTS_ENABLED", "false")
    const request = vi.fn()
    vi.stubGlobal("fetch", request)
    await expect(createCharge(params)).rejects.toThrow("unavailable")
    expect(request).not.toHaveBeenCalled()
  })
  it("rejects unsafe charge IDs without making a request", async () => {
    const request = vi.fn()
    vi.stubGlobal("fetch", request)
    await expect(retrieveCharge("../../refunds")).rejects.toThrow("Invalid Tap charge")
    expect(request).not.toHaveBeenCalled()
  })
  it("does not expose payment API error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: "customer secret" }) }))
    await expect(createCharge(params)).rejects.toThrow("Tap API request failed (400)")
  })
  it("requires HTTPS in production and rejects credentials in site URL", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000")
    expect(() => getPaymentSiteUrl()).toThrow()
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://user:password@market.example")
    expect(() => getPaymentSiteUrl()).toThrow()
  })
})
