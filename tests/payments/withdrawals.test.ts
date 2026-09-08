// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { checkAccountStatus, createAccountLink, createConnectAccount, createPayout } from "@/app/actions/tap-connect"
import { requireProvider } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireProvider: vi.fn(), AuthError: class extends Error {} }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))

const provider = { id: "provider", tap_destination_id: "dest_verified", tap_onboarding_completed: true, tap_account_status: "active" }
const admin = { rpc: vi.fn() }
function authenticate(profile = provider) {
  vi.mocked(requireProvider).mockResolvedValue({ user: { id: "provider-user" }, provider: profile } as unknown as Awaited<ReturnType<typeof requireProvider>>)
}
beforeEach(() => {
  vi.clearAllMocks()
  authenticate()
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>)
  admin.rpc.mockResolvedValue({ data: "withdrawal-request-id", error: null })
})

describe("withdrawal requests", () => {
  it.each([NaN, Infinity, -1, 0, 0.001, 1.234, 1_000_001])("rejects invalid withdrawal %s", async (amount) => {
    expect((await createPayout(amount)).success).toBe(false)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it("reserves funds for review and does not report an external transfer", async () => {
    expect(await createPayout(85)).toEqual({ success: true, data: { requestId: "withdrawal-request-id", status: "pending" } })
    expect(admin.rpc).toHaveBeenCalledWith("request_provider_withdrawal", { p_provider_id: "provider", p_actor_id: "provider-user", p_amount: 85 })
  })
  it("fails closed for placeholder accounts even if an old completion flag is set", async () => {
    authenticate({ ...provider, tap_destination_id: "tap_placeholder_provider" })
    expect(await checkAccountStatus()).toEqual({ success: true, data: { isComplete: false, chargesEnabled: false, payoutsEnabled: false } })
    expect((await createPayout(85)).success).toBe(false)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it("does not manufacture an account or onboarding URL", async () => {
    authenticate({ ...provider, tap_onboarding_completed: false })
    expect((await createConnectAccount()).success).toBe(false)
    expect((await createAccountLink()).success).toBe(false)
    expect(createAdminClient).not.toHaveBeenCalled()
  })
  it("does not claim success when funds cannot be reserved", async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { message: "Insufficient balance" } })
    expect((await createPayout(85)).success).toBe(false)
  })
})
