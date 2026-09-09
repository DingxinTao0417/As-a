import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))

import { getPublicProviderDetail,getPublicProviderServices,getPublicServiceDetail,getServiceCatalog } from "@/app/actions/catalog"

const row = {
  id: "30000000-0000-4000-8000-000000000001",
  name_ar: "خدمة",
  name_en: "Service",
  description_ar: null,
  description_en: "Description",
  category: "design",
  price: 100,
  price_type: "fixed",
  delivery_time: "3 days",
  features: ["Source files"],
  image_urls: ["/placeholder.svg"],
  provider_id: "20000000-0000-4000-8000-000000000001",
  provider_name_ar: "مزود",
  provider_name_en: "Provider",
  provider_avatar_url: null,
  provider_rating: 4.5,
  provider_reviews_count: 10,
  provider_is_verified: true,
  created_at: "2026-09-08T00:00:00Z",
  total_count: 25,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.rpc.mockResolvedValue({ data: [row], error: null })
})
afterEach(() => vi.useRealTimers())

describe("service catalog", () => {
  it("requests a stable server-side page and maps provider data", async () => {
    const result = await getServiceCatalog({ query: "design", category: "design", sort: "rating", page: 2, pageSize: 12 })
    expect(result).toMatchObject({ success: true, data: { total: 25 } })
    if (!result.success) throw new Error(result.error)
    expect(result.data.services[0].providers).toMatchObject({ name_en: "Provider", rating: 4.5, is_verified: true })
    expect(mocks.rpc).toHaveBeenCalledWith("search_service_catalog", {
      p_query: "design",
      p_category: "design",
      p_sort: "rating",
      p_offset: 12,
      p_limit: 12,
    })
  })

  it("rejects invalid queries and reports database failure", async () => {
    await expect(getServiceCatalog({ query: "", category: "all", sort: "newest", page: 0, pageSize: 12 })).resolves.toEqual({
      success: false,
      error: "Invalid catalog query",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") })
    await expect(getServiceCatalog({ query: "", category: "all", sort: "newest", page: 1, pageSize: 12 })).resolves.toEqual({
      success: false,
      error: "Services could not be loaded",
    })
  })

  it("turns an unresponsive database request into a retryable failure", async () => {
    vi.useFakeTimers()
    mocks.rpc.mockReturnValue(new Promise(() => {}))
    const result = getServiceCatalog({ query: "", category: "all", sort: "newest", page: 1, pageSize: 12 })
    await vi.advanceTimersByTimeAsync(8_000)
    await expect(result).resolves.toEqual({ success: false, error: "Services could not be loaded" })
  })

  it("loads only the public services for one provider with a stable cursor",async()=>{
    mocks.rpc.mockResolvedValue({data:{services:[row],total:3},error:null})
    const result=await getPublicProviderServices(row.provider_id,null,1)
    expect(result).toMatchObject({success:true,data:{
      services:[{id:row.id,price:100}],total:3,nextCursor:{createdAt:row.created_at,id:row.id},
    }})
    expect(mocks.rpc).toHaveBeenCalledWith("get_public_provider_service_page",{
      p_provider_id:row.provider_id,p_before_created_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("loads one public service snapshot and distinguishes an unavailable record",async()=>{
    const detail={...row,is_active:true,providers:{
      id:row.provider_id,name_ar:"مزود",name_en:"Provider",title_ar:"مصمم",title_en:"Designer",
      avatar_url:null,rating:"4.5",reviews_count:"10",completed_projects:"7",is_verified:true,
      bio_ar:null,bio_en:null,response_time:null,
    }}
    mocks.rpc.mockResolvedValueOnce({data:{service:detail,related_services:[{
      id:"30000000-0000-4000-8000-000000000002",name_ar:"أخرى",name_en:"Related",
      category:"design",price:"80",price_type:"fixed",provider_id:row.provider_id,
      created_at:row.created_at,providers:{name_ar:"مزود",name_en:"Provider",avatar_url:null,rating:"4.5"},
    }]},error:null})
    await expect(getPublicServiceDetail(row.id)).resolves.toMatchObject({success:true,data:{
      service:{id:row.id,price:100,providers:{rating:4.5,reviews_count:10}},
      relatedServices:[{name_en:"Related",price:80}],
    }})
    mocks.rpc.mockResolvedValueOnce({data:null,error:null})
    await expect(getPublicServiceDetail(row.id)).resolves.toEqual({success:true,data:{service:null,relatedServices:[]}})
  })

  it("loads only the public provider projection and distinguishes an unavailable profile",async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{
      id:row.provider_id,name_ar:"مزود",name_en:"Provider",title_ar:"مصمم",title_en:"Designer",
      bio_ar:null,bio_en:"Bio",avatar_url:null,rating:"4.5",reviews_count:"10",
      completed_projects:"7",skills:["Figma"],categories:["design"],is_verified:true,
    },error:null})
    await expect(getPublicProviderDetail(row.provider_id)).resolves.toMatchObject({success:true,data:{provider:{
      id:row.provider_id,rating:4.5,reviews_count:10,completed_projects:7,skills:["Figma"],
    }}})
    expect(mocks.rpc).toHaveBeenCalledWith("get_public_provider_detail",{p_provider_id:row.provider_id})
    mocks.rpc.mockResolvedValueOnce({data:null,error:null})
    await expect(getPublicProviderDetail(row.provider_id)).resolves.toEqual({success:true,data:{provider:null}})
  })
})
