// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), revalidate: vi.fn(), query: {} as any }))
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.auth, AuthError: class AuthError extends Error {} }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
import { AuthError } from "@/lib/auth"
import { reviewWithdrawal, setServiceActive, setUserAdmin, verifyProvider } from "@/app/actions/admin"

const actor = "11111111-1111-4111-8111-111111111111"
const target = "22222222-2222-4222-8222-222222222222"

describe("administrator mutation boundaries", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { id: actor } })
    mocks.query = {}
    mocks.query.rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    mocks.admin.mockReturnValue(mocks.query)
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks() })
  it("rejects every administrator operation before creating a privileged client", async () => {
    mocks.auth.mockRejectedValue(new AuthError("Administrator access required"))
    const results = await Promise.all([
      setUserAdmin(target, true), verifyProvider(target, true), setServiceActive(target, true), reviewWithdrawal(target, "completed", "bank-ref-1"),
    ])
    expect(results.every((result) => !result.success)).toBe(true)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("prevents an administrator from removing their own access", async () => {
    expect((await setUserAdmin(actor, false)).success).toBe(false)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("requires evidence when marking a manual transfer complete", async () => {
    expect((await reviewWithdrawal(target, "completed")).success).toBe(false)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("does not reprocess completed or rejected withdrawals", async () => {
    mocks.query.rpc.mockResolvedValue({ data: null, error: { message: "Withdrawal already processed" } })
    expect((await reviewWithdrawal(target, "completed", "bank-ref-1")).success).toBe(false)
    expect(mocks.query.rpc).toHaveBeenCalledWith("apply_admin_action", {
      p_actor_id: actor, p_action: "review_withdrawal", p_target_id: target, p_value: "completed", p_note: "bank-ref-1",
    })
  })
  it("surfaces database failures without claiming success", async () => {
    mocks.query.rpc.mockResolvedValue({ data: null, error: { message: "sensitive database detail" } })
    const result = await verifyProvider(target, true)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).not.toContain("sensitive")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
