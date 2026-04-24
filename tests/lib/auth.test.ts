import { describe, expect, it } from "vitest"
import { AuthError } from "@/lib/auth"

describe("AuthError", () => {
  it("creates error with code", () => {
    const error = new AuthError("Not logged in", "UNAUTHENTICATED")
    expect(error.message).toBe("Not logged in")
    expect(error.code).toBe("UNAUTHENTICATED")
    expect(error.name).toBe("AuthError")
  })

  it("defaults to UNAUTHORIZED code", () => {
    const error = new AuthError("Forbidden")
    expect(error.code).toBe("UNAUTHORIZED")
  })
})
