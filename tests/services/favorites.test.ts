import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), rpc: vi.fn(),from:vi.fn() }))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc,from:mocks.from }) }))

import { getFavoriteProviders,getProviderFavoriteStatus,setProviderFavorite } from "@/app/actions/favorites"

const userId = "10000000-0000-4000-8000-000000000001"
const providerId = "20000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockImplementation(async (_name: string, params: { p_favorite: boolean }) => ({ data: params.p_favorite, error: null }))
  const query:Record<string,unknown>={}
  query.select=vi.fn(()=>query);query.eq=vi.fn(()=>query)
  query.maybeSingle=vi.fn().mockResolvedValue({data:{id:"30000000-0000-4000-8000-000000000001"},error:null})
  mocks.from.mockReturnValue(query)
})

describe("provider favorites", () => {
  it("uses the authenticated actor for idempotent add and remove operations", async () => {
    await expect(setProviderFavorite(providerId, true)).resolves.toEqual({ success: true, data: { favorite: true } })
    expect(mocks.rpc).toHaveBeenCalledWith("set_provider_favorite", {
      p_actor_id: userId,
      p_provider_id: providerId,
      p_favorite: true,
    })
    await expect(setProviderFavorite(providerId, false)).resolves.toEqual({ success: true, data: { favorite: false } })
  })

  it("rejects invalid targets and database failures", async () => {
    await expect(setProviderFavorite("not-a-provider", true)).resolves.toEqual({ success: false, error: "Invalid favorite" })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("rejected") })
    await expect(setProviderFavorite(providerId, true)).resolves.toEqual({ success: false, error: "Favorite could not be saved" })
  })

  it("loads provider cards through one stable favorite cursor",async()=>{
    const favoriteId="30000000-0000-4000-8000-000000000001"
    const createdAt="2026-09-09T00:00:00.000Z"
    mocks.rpc.mockResolvedValue({data:{favorites:[{
      id:favoriteId,provider_id:providerId,created_at:createdAt,
      provider:{name_ar:"مزود",name_en:"Provider",title_ar:null,title_en:"Designer",avatar_url:null,
        rating:"4.5",starting_price:"100",is_verified:true,is_available:true},
    }],total:3},error:null})
    await expect(getFavoriteProviders(null,1)).resolves.toMatchObject({success:true,data:{
      favorites:[{id:favoriteId,provider:{rating:4.5,starting_price:100,is_available:true}}],
      total:3,nextCursor:{createdAt,id:favoriteId},
    }})
    expect(mocks.rpc).toHaveBeenCalledWith("get_favorite_provider_page",{
      p_actor_id:userId,p_before_created_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("loads the current user's favorite status without a browser table read",async()=>{
    await expect(getProviderFavoriteStatus(providerId)).resolves.toEqual({success:true,data:{favorite:true}})
    expect(mocks.from).toHaveBeenCalledWith("favorites")
  })
})
