import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))

import { saveProfileAvatar, saveProfileDetails } from "@/app/actions/profile"

const userId = "10000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockImplementation(async(name:string)=>({
    data:name==="update_own_profile"
      ? { id:userId,full_name:"Test User",phone:null,location:"Riyadh",bio:"Profile bio" }
      : ["https://project.supabase.co/storage/v1/object/public/avatars/old.webp"],
    error:null,
  }))
})

afterEach(() => vi.unstubAllEnvs())

describe("profile actions", () => {
  it("updates profile and provider avatar references in one trusted transaction", async () => {
    const url = "https://project.supabase.co/storage/v1/object/public/avatars/user/new.webp"
    await expect(saveProfileAvatar(url)).resolves.toEqual({
      success: true,
      data: { oldUrls: ["https://project.supabase.co/storage/v1/object/public/avatars/old.webp"] },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("update_profile_avatar", {
      p_actor_id: userId,
      p_avatar_url: url,
    })
  })

  it("rejects another origin and does not claim success after a database error", async () => {
    await expect(saveProfileAvatar("https://evil.example/avatar.webp")).resolves.toEqual({
      success: false,
      error: "Invalid avatar URL",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()

    mocks.rpc.mockResolvedValue({ data: null, error: new Error("rejected") })
    await expect(saveProfileAvatar("https://project.supabase.co/storage/v1/object/public/avatars/user/new.webp")).resolves.toEqual({
      success: false,
      error: "Avatar could not be saved",
    })
  })

  it("saves all editable profile fields in one trusted transaction",async()=>{
    await expect(saveProfileDetails({ fullName:" Test User ",phone:"",location:" Riyadh ",bio:" Profile bio " })).resolves.toEqual({
      success:true,
      data:{ profile:{ id:userId,full_name:"Test User",phone:null,location:"Riyadh",bio:"Profile bio" } },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("update_own_profile",{
      p_actor_id:userId,
      p_full_name:"Test User",
      p_phone:"",
      p_location:"Riyadh",
      p_bio:"Profile bio",
    })
  })

  it("rejects incomplete profile details before writing",async()=>{
    await expect(saveProfileDetails({ fullName:" ",phone:"",location:"",bio:"" })).resolves.toEqual({ success:false,error:"Invalid profile details" })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
