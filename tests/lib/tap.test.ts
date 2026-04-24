import { describe, expect, it } from "vitest"
import { calculateFees, calculateFeesWithVAT, formatSAR } from "@/lib/tap"

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
