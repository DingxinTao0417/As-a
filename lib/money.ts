// Shared display arithmetic. Payment actions validate amounts before using these helpers.
export const PLATFORM_FEE_PERCENTAGE = 0.15
export const VAT_RATE = 0.15
export const MAX_SAR_AMOUNT = 1_000_000

export function toSARMinorUnits(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_SAR_AMOUNT) return null
  const minor = Math.round(value * 100)
  // Reject fractions of a halala without rejecting normal IEEE-754 representations.
  return Math.abs(value * 100 - minor) < 0.00001 ? minor : null
}

function roundSAR(amount: number): number {
  return Math.round(amount * 100) / 100
}

export function calculateFees(amountInSAR: number) {
  const amount = roundSAR(amountInSAR)
  const platformFee = roundSAR(amount * PLATFORM_FEE_PERCENTAGE)
  return { amount, platformFee, providerAmount: roundSAR(amount - platformFee) }
}

export function calculateFeesWithVAT(baseAmount: number) {
  const normalizedBaseAmount = roundSAR(baseAmount)
  const vatAmount = roundSAR(normalizedBaseAmount * VAT_RATE)
  const platformFee = roundSAR(normalizedBaseAmount * PLATFORM_FEE_PERCENTAGE)
  return {
    baseAmount: normalizedBaseAmount,
    vatAmount,
    totalAmount: roundSAR(normalizedBaseAmount + vatAmount),
    platformFee,
    providerAmount: roundSAR(normalizedBaseAmount - platformFee),
  }
}

export function formatSAR(amount: number): string {
  return new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR" }).format(amount)
}

export const formatCurrency = formatSAR
