import { createHmac } from "node:crypto"
import { afterEach,describe,expect,it,vi } from "vitest"
import {
  calculateFees,calculateFeesWithVAT,formatSAR,retrieveTapDestination,
  tapDestinationCapabilities,verifyWebhookSignature,
} from "@/lib/tap"

afterEach(()=>{
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
  it("uses western digits for the English interface",()=>{
    expect(formatSAR(100,"en")).toMatch(/100.*SAR|SAR.*100/)
  })
})

describe("verifyWebhookSignature", () => {
  const payload = {
    id: "chg_test123",
    amount: 100,
    currency: "SAR",
    status: "CAPTURED",
    reference: { gateway: "gateway-1", payment: "payment-1" },
    transaction: { created: "1788890400000" },
  }
  const secret = "sk_test_example"

  it("accepts Tap's documented field-based hashstring", () => {
    const hashInput = "x_idchg_test123x_amount100.00x_currencySARx_gateway_referencegateway-1x_payment_referencepayment-1x_statusCAPTUREDx_created1788890400000"
    const signature = createHmac("sha256", secret).update(hashInput).digest("hex")
    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true)
  })

  it("rejects a signature after a payment field is changed", () => {
    const hashInput = "x_idchg_test123x_amount100.00x_currencySARx_gateway_referencegateway-1x_payment_referencepayment-1x_statusCAPTUREDx_created1788890400000"
    const signature = createHmac("sha256", secret).update(hashInput).digest("hex")
    expect(verifyWebhookSignature({ ...payload, amount: 99 }, signature, secret)).toBe(false)
  })

  it("accepts Tap's refund hashstring using the top-level created field", () => {
    const refund = {
      id: "re_test123",
      amount: 20,
      currency: "SAR",
      status: "ACCEPTED",
      reference: { gateway: "gateway-r", payment: "payment-r" },
      created: "1788890500000",
    }
    const hashInput = "x_idre_test123x_amount20.00x_currencySARx_gateway_referencegateway-rx_payment_referencepayment-rx_statusACCEPTEDx_created1788890500000"
    const signature = createHmac("sha256", secret).update(hashInput).digest("hex")
    expect(verifyWebhookSignature(refund, signature, secret)).toBe(true)
  })
})

describe("Tap Marketplace destination status",()=>{
  it("keeps charge and payout capability as separate external facts",()=>{
    expect(tapDestinationCapabilities({id:"61025843",status:"Active"})).toEqual({
      status:"active",chargesEnabled:true,payoutsEnabled:false,
    })
    expect(tapDestinationCapabilities({id:"61025843",status:{value:"Active",payout:true}})).toEqual({
      status:"active",chargesEnabled:true,payoutsEnabled:true,
    })
    expect(tapDestinationCapabilities({id:"61025843",status:{value:"Pending",payout:true}})).toEqual({
      status:"pending",chargesEnabled:false,payoutsEnabled:false,
    })
  })

  it("retrieves a destination with the separate server-only Marketplace key",async()=>{
    vi.stubEnv("TAP_MARKETPLACE_SECRET_KEY","sk_test_marketplace")
    const fetchMock=vi.fn().mockResolvedValue({
      ok:true,json:async()=>({id:"61025843",status:"Active"}),
    })
    vi.stubGlobal("fetch",fetchMock)
    await expect(retrieveTapDestination("61025843")).resolves.toMatchObject({id:"61025843"})
    expect(fetchMock).toHaveBeenCalledWith("https://api.tap.company/v2/destination/61025843",expect.objectContaining({
      method:"GET",headers:expect.objectContaining({Authorization:"Bearer sk_test_marketplace"}),
    }))
  })
})
