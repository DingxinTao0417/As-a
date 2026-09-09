import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), rpc: vi.fn() }))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))

import {
  cancelAccountDeletionRequest,
  getAccountDeletionStatus,
  requestAccountDeletion,
} from "@/app/actions/delete-account"

const userId = "10000000-0000-4000-8000-000000000001"
const request = {
  id: "20000000-0000-4000-8000-000000000001",
  status: "requested",
  requested_at: "2026-09-08T00:00:00.000Z",
  cancelled_at: null,
  current_step: null,
  last_error: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockResolvedValue({ data: request, error: null })
})

describe("account deletion requests", () => {
  it("queues an idempotent request without signing the user out", async () => {
    await expect(requestAccountDeletion()).resolves.toEqual({ success: true, data: { request } })
    expect(mocks.rpc).toHaveBeenCalledWith("request_account_deletion", { p_actor_id: userId })
  })

  it("loads and cancels a still-pending request", async () => {
    await expect(getAccountDeletionStatus()).resolves.toEqual({ success: true, data: { request } })
    mocks.rpc.mockResolvedValue({ data: { ...request, status: "cancelled", cancelled_at: "2026-09-08T01:00:00.000Z" }, error: null })
    await expect(cancelAccountDeletionRequest()).resolves.toMatchObject({
      success: true,
      data: { request: { status: "cancelled" } },
    })
  })

  it("reports eligibility and cancellation failures without changing local state", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("blocked") })
    await expect(requestAccountDeletion()).resolves.toEqual({
      success: false,
      error: "Active orders, withdrawals, or unsettled balance prevent account deletion",
    })
    await expect(cancelAccountDeletionRequest()).resolves.toEqual({
      success: false,
      error: "This deletion request can no longer be cancelled",
    })
  })
})
