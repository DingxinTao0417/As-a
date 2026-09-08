import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { usePaymentReturn } from "@/components/use-payment-return"

const mocks = vi.hoisted(() => ({ verifyPayment: vi.fn(), replace: vi.fn(), toast: vi.fn() }))
vi.mock("@/app/actions/orders", () => ({ verifyPayment: mocks.verifyPayment }))
vi.mock("next/navigation", () => ({ useRouter: () => mocks }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock("@/components/language-provider", () => ({ useLanguage: () => ({ t: (_ar: string, en: string) => en }) }))

beforeEach(() => { vi.resetAllMocks() })

describe("payment return", () => {
  it("keeps the provider destination until auth loads and preserves it during cleanup", async () => {
    mocks.verifyPayment.mockResolvedValue({ success: true, data: { status: "paid" } })
    const { result, rerender } = renderHook(({ authenticated }) => usePaymentReturn("provider=provider-1&payment=callback&order_id=order-1&tap_id=charge-1", authenticated), { initialProps: { authenticated: false } })
    expect(mocks.verifyPayment).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
    rerender({ authenticated: true })
    await waitFor(() => expect(result.current).toBe(1))
    expect(mocks.replace).toHaveBeenCalledWith("/messages?provider=provider-1", { scroll: false })
    expect(mocks.verifyPayment).toHaveBeenCalledWith("order-1")
    rerender({ authenticated: true })
    expect(mocks.verifyPayment).toHaveBeenCalledOnce()
  })

  it("notifies the user about a payment verification failure", async () => {
    mocks.verifyPayment.mockResolvedValue({ success: false, error: "Payment is still pending" })
    const { result } = renderHook(() => usePaymentReturn("payment=callback&order_id=order-1&conversation=conv-1", true))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Payment is still pending", variant: "destructive" })))
    expect(mocks.replace).toHaveBeenCalledWith("/messages?conversation=conv-1", { scroll: false })
    expect(result.current).toBe(0)
  })

  it("handles transport errors without treating the payment as successful", async () => {
    mocks.verifyPayment.mockRejectedValue(new Error("Connection lost"))
    const { result } = renderHook(() => usePaymentReturn("payment=success&order_id=order-1", true))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Check your order status before trying to pay again." })))
    expect(result.current).toBe(0)
  })

  it("signals a refresh when verification finishes after the page has opened", async () => {
    let finish!: (value: unknown) => void
    mocks.verifyPayment.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { result } = renderHook(() => usePaymentReturn("provider=provider-1&payment=callback&order_id=order-1", true))
    expect(result.current).toBe(0)
    await act(async () => { finish({ success: true, data: { status: "paid" } }) })
    expect(result.current).toBe(1)
  })
})
