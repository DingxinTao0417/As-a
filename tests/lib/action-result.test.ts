import { describe, expect, it } from "vitest"
import { fail, ok } from "@/lib/action-result"

describe("ok", () => {
  it("returns success result", () => {
    const result = ok({ id: "123" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe("123")
    }
  })
})

describe("fail", () => {
  it("returns failure result", () => {
    const result = fail("Something went wrong")
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe("Something went wrong")
    }
  })
})
