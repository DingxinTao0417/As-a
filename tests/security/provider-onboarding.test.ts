import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc,from:mocks.from }),
}))

import { getCurrentProviderContext,registerProviderProfile } from "@/app/actions/providers"

const userId = "10000000-0000-4000-8000-000000000001"
const providerId = "20000000-0000-4000-8000-000000000001"
const input = {
  nameAr: "مقدم خدمة",
  nameEn: "Provider",
  titleAr: "مصمم",
  titleEn: "Designer",
  bioAr: "",
  bioEn: "",
  startingPrice: 100,
  skills: ["Figma"],
  categories: ["design"],
  avatarUrl: "/placeholder.svg",
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockResolvedValue({ data: providerId, error: null })
  mocks.from.mockImplementation((table:string)=>({
    select:()=>({eq:()=>({maybeSingle:vi.fn().mockResolvedValue(table==="profiles"
      ?{data:{role:"provider"},error:null}
      :{data:{id:providerId,tap_destination_id:"dest_test",tap_account_status:"active",tap_onboarding_completed:true},error:null})})}),
  }))
})

describe("provider onboarding", () => {
  it("passes normalized profile data and the authenticated actor to the trusted transaction", async () => {
    await expect(registerProviderProfile(input)).resolves.toEqual({ success: true, data: { providerId } })
    expect(mocks.rpc).toHaveBeenCalledWith("register_provider_profile", expect.objectContaining({
      p_actor_id: userId,
      p_name_en: "Provider",
      p_starting_price: 100,
      p_skills: ["Figma"],
      p_categories: ["design"],
    }))
  })

  it("rejects invalid prices and image schemes before the database call", async () => {
    await expect(registerProviderProfile({ ...input, startingPrice: 100.001 })).resolves.toMatchObject({ success: false })
    await expect(registerProviderProfile({ ...input, avatarUrl: "javascript:alert(1)" })).resolves.toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("does not report success when the transaction fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("rejected") })
    await expect(registerProviderProfile(input)).resolves.toEqual({
      success: false,
      error: "Provider profile could not be saved",
    })
  })

  it("loads the authenticated role and minimal provider context through the trusted client",async()=>{
    await expect(getCurrentProviderContext()).resolves.toEqual({success:true,data:{
      role:"provider",provider:{id:providerId,tap_destination_id:"dest_test",tap_account_status:"active",tap_onboarding_completed:true},
    }})
    expect(mocks.from).toHaveBeenCalledWith("profiles")
    expect(mocks.from).toHaveBeenCalledWith("providers")
  })
})
