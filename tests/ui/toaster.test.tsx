import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Toaster } from "@/components/ui/toaster"
import { toast } from "@/hooks/use-toast"

afterEach(() => cleanup())

describe("Toaster", () => {
  it("renders and dismisses notifications created by the shared toast hook", async () => {
    render(<Toaster />)

    act(() => {
      toast({ title: "Saved", description: "Your changes are visible." })
    })

    expect(await screen.findByText("Saved")).toBeVisible()
    expect(screen.getByText("Your changes are visible.")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))
    await waitFor(() => expect(screen.queryByText("Saved")).not.toBeInTheDocument())
  })
})
