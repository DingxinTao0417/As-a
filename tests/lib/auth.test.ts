import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthError, requireAdmin, requireAuth, requireProvider } from "@/lib/auth"

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), maybeSingle: vi.fn(), from: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: mocks.maybeSingle }
  mocks.from.mockReturnValue(query)
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user", user_metadata: { is_admin: true } } }, error: null })
  mocks.maybeSingle.mockResolvedValue({ data: { deletion_requested_at: null }, error: null })
})

describe("AuthError", () => {
  it("creates error with code", () => {
    const error = new AuthError("Not logged in", "UNAUTHENTICATED")
    expect(error.message).toBe("Not logged in")
    expect(error.code).toBe("UNAUTHENTICATED")
    expect(error.name).toBe("AuthError")
  })
  it("defaults to UNAUTHORIZED code", () => expect(new AuthError("Forbidden").code).toBe("UNAUTHORIZED"))
})

describe("account authorization", () => {
  it("rejects invalid sessions before querying profiles", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } })
    await expect(requireAuth()).rejects.toMatchObject({ code: "UNAUTHENTICATED" })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([
    { data: null, error: null },
    { data: null, error: { message: "database unavailable" } },
  ])("fails closed when the account lookup is unavailable", async (result) => {
    mocks.maybeSingle.mockResolvedValue(result)
    await expect(requireAuth()).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" })
  })
  it("rejects a valid JWT for an account pending deletion", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { deletion_requested_at: "2026-09-08" }, error: null })
    await expect(requireAuth()).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" })
  })
  it("does not trust editable user metadata to grant administrator access", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: { deletion_requested_at: null }, error: null })
      .mockResolvedValueOnce({ data: { is_admin: false }, error: null })
    await expect(requireAdmin()).rejects.toMatchObject({ code: "ADMIN_REQUIRED" })
  })
  it("requires explicit administrator status in the database", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: { deletion_requested_at: null }, error: null })
      .mockResolvedValueOnce({ data: { is_admin: true }, error: null })
    await expect(requireAdmin()).resolves.toMatchObject({ user: { id: "user" } })
  })
  it("requires an owned provider record", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: { deletion_requested_at: null }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    await expect(requireProvider()).rejects.toMatchObject({ code: "PROVIDER_REQUIRED" })
  })
})
