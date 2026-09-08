import { beforeEach, describe, expect, it, vi } from "vitest"
import { requestAccountDeletion } from "@/app/actions/delete-account"
import { exportUserData } from "@/app/actions/user-data"

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), signOut: vi.fn(), from: vi.fn(), requireAuth: vi.fn() }))
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAuth: mocks.requireAuth,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({
    user: { id: "owner", email: "owner@example.test" },
    supabase: { rpc: mocks.rpc, auth: { signOut: mocks.signOut }, from: mocks.from },
  })
  mocks.rpc.mockResolvedValue({ error: null })
  mocks.signOut.mockResolvedValue({ error: null })
})

describe("account deletion", () => {
  it("uses the atomic database transaction and signs out only after success", async () => {
    await expect(requestAccountDeletion()).resolves.toMatchObject({ success: true })
    expect(mocks.rpc).toHaveBeenCalledWith("request_account_deletion")
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })
  it("preserves the session when active orders prevent deletion", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "P0001" } })
    await expect(requestAccountDeletion()).resolves.toMatchObject({ success: false })
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
  it("does not report success when the database check fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "08006", message: "private DB details" } })
    const result = await requestAccountDeletion()
    expect(result).toMatchObject({ success: false })
    expect(JSON.stringify(result)).not.toContain("private DB details")
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})

describe("data export", () => {
  function setupTables(failedTable?: string) {
    const requestedRanges: Array<{ table: string; after: string }> = []
    mocks.from.mockImplementation((table: string) => {
      let offset = 0
      const query = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        gt: vi.fn((_column: string, after: string) => { offset = Number(after) + 1; requestedRanges.push({ table, after }); return query }),
        eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: { id: "owner" }, error: null })),
        then(resolve: (value: unknown) => unknown) {
          if (table === failedTable) return Promise.resolve({ data: null, error: { message: "failure" } }).then(resolve)
          const data = table === "messages" ? Array.from({ length: offset === 0 ? 500 : 2 }, (_, i) => ({ id: `${offset + i}` })) : []
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    })
    return requestedRanges
  }
  it("exports rows beyond a single API page", async () => {
    const ranges = setupTables()
    const result = await exportUserData()
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.messages_sent).toHaveLength(502)
    expect(ranges).toContainEqual({ table: "messages", after: "499" })
  })
  it("fails the whole export instead of silently omitting a failed table", async () => {
    setupTables("messages")
    await expect(exportUserData()).resolves.toMatchObject({ success: false })
  })
})
