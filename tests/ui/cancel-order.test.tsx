import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { CancelOrderButton } from "@/components/cancel-order-button"
import { LanguageProvider } from "@/components/language-provider"
import { installBrowserStorage } from "./browser-storage"

const cancelPendingOrder = vi.hoisted(() => vi.fn())
vi.mock("@/app/actions/orders", () => ({ cancelPendingOrder }))
beforeEach(() => {
  vi.resetAllMocks()
  installBrowserStorage()
  window.localStorage.setItem("language", "en")
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it("requires confirmation before cancelling a quote", () => {
  render(<LanguageProvider><CancelOrderButton orderId="order-1" onCancelled={vi.fn()} /></LanguageProvider>)
  fireEvent.click(screen.getByRole("button", { name: "Cancel order" }))
  expect(screen.getByRole("alertdialog")).toBeVisible()
  expect(cancelPendingOrder).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Go back" }))
  expect(cancelPendingOrder).not.toHaveBeenCalled()
})

it("shows a checkout conflict without falsely refreshing a cancelled order", async () => {
  const onCancelled = vi.fn()
  cancelPendingOrder.mockResolvedValue({ success: false, error: "Checkout has started. Verify the payment first." })
  render(<LanguageProvider><CancelOrderButton orderId="order-1" onCancelled={onCancelled} /></LanguageProvider>)
  fireEvent.click(screen.getByRole("button", { name: "Cancel order" }))
  fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }))
  await expect(screen.findByRole("alert")).resolves.toHaveTextContent("Checkout has started")
  expect(onCancelled).not.toHaveBeenCalled()
  expect(screen.getByRole("alertdialog")).toBeVisible()
})

it("refreshes the order after a confirmed successful cancellation", async () => {
  const onCancelled = vi.fn()
  cancelPendingOrder.mockResolvedValue({ success: true, data: undefined })
  render(<LanguageProvider><CancelOrderButton orderId="order-1" onCancelled={onCancelled} /></LanguageProvider>)
  fireEvent.click(screen.getByRole("button", { name: "Cancel order" }))
  fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }))
  await waitFor(() => expect(onCancelled).toHaveBeenCalledOnce())
  expect(cancelPendingOrder).toHaveBeenCalledWith("order-1")
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
})
