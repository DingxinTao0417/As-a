import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), rpc: vi.fn(),storageFrom:vi.fn(),createSignedUrls:vi.fn() }))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc,storage:{from:mocks.storageFrom} }),
}))

import { exportUserData } from "@/app/actions/user-data"

const userId = "10000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.storageFrom.mockReturnValue({createSignedUrls:mocks.createSignedUrls})
  mocks.createSignedUrls.mockImplementation(async(paths:string[])=>({
    data:paths.map((path)=>({path,signedUrl:`https://files.example.test/${encodeURIComponent(path)}`})),
    error:null,
  }))
  mocks.requireAuth.mockResolvedValue({
    user: {
      id: userId,
      email: "user@example.test",
      phone: null,
      created_at: "2026-09-08T00:00:00.000Z",
      last_sign_in_at: "2026-09-08T01:00:00.000Z",
      user_metadata: { location: "Riyadh", bio: "Profile bio" },
      app_metadata: { provider: "email" },
    },
    supabase: {},
  })
})

describe("user data export", () => {
  it("returns one complete trusted database snapshot with auth metadata", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        schema_version: 10,
        profile: { id: userId, full_name: "Test User" },
        messages_sent_and_received: [{ id: "message-1" }],
        order_deliveries:[{files:[{path:"order/provider/delivery.pdf"}]}],
        dispute_evidence:[{storage_path:"dispute/user/evidence.pdf"}],
        provider_verification_documents:[{storage_path:"provider/user/credential.pdf"}],
      },
      error: null,
    })
    const result = await exportUserData()
    expect(result).toMatchObject({
      success: true,
      data: {
        format: "asaa-user-data",
        format_version: 11,
        account: {
          id: userId,
          user_metadata: { location: "Riyadh", bio: "Profile bio" },
        },
        data: { schema_version: 10, messages_sent_and_received: [{ id: "message-1" }] },
        private_file_downloads:[
          {bucket:"order-deliveries",path:"order/provider/delivery.pdf"},
          {bucket:"dispute-evidence",path:"dispute/user/evidence.pdf"},
          {bucket:"provider-verification",path:"provider/user/credential.pdf"},
        ],
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("export_user_data_snapshot_v10", { p_actor_id: userId })
    expect(mocks.storageFrom.mock.calls.map(([bucket])=>bucket)).toEqual(["order-deliveries","dispute-evidence","provider-verification"])
  })

  it("fails the whole export when the database snapshot cannot be completed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("query failed") })
    await expect(exportUserData()).resolves.toEqual({
      success: false,
      error: "Data export could not be completed",
    })
    expect(mocks.createSignedUrls).not.toHaveBeenCalled()
  })

  it("fails rather than returning a partial export when a private link cannot be signed",async()=>{
    mocks.rpc.mockResolvedValue({
      data:{schema_version:10,order_deliveries:[{files:[{path:"order/provider/delivery.pdf"}]}]},
      error:null,
    })
    mocks.createSignedUrls.mockResolvedValue({data:null,error:new Error("storage unavailable")})
    await expect(exportUserData()).resolves.toEqual({
      success:false,
      error:"Private export files could not be prepared",
    })
  })
})
