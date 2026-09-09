import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireProvider: vi.fn(),
  rpc: vi.fn(),
  storageFrom:vi.fn(),
  remove:vi.fn(),
}))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireProvider: mocks.requireProvider }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc,storage:{from:mocks.storageFrom} }) }))

import {
  createServiceDraft,
  deleteService,
  getServiceImageCleanupJobs,
  getProviderServicePage,
  queueServiceImageCleanup,
  retryServiceImageCleanupJobs,
  setServicePublishIntent,
  submitServiceForReview,
  updateServiceDraft,
} from "@/app/actions/services"

const userId = "10000000-0000-4000-8000-000000000001"
const providerId = "20000000-0000-4000-8000-000000000001"
const serviceId = "30000000-0000-4000-8000-000000000001"
const input = {
  nameAr: "خدمة",
  nameEn: "Service",
  descriptionAr: "",
  descriptionEn: "",
  category: "design" as const,
  price: 100,
  priceType: "fixed" as const,
  deliveryTime: "3 days",
  features: ["Source files"],
  imageUrls: ["/placeholder.svg"],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireProvider.mockResolvedValue({ user: { id: userId }, provider: { id: providerId } })
  mocks.storageFrom.mockReturnValue({remove:mocks.remove})
  mocks.remove.mockResolvedValue({data:[],error:null})
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "create_service_draft" ? serviceId
      : name === "delete_service" ? input.imageUrls
      : name === "queue_service_image_cleanup" ? 1
      : null,
    error: null,
  }))
})

afterEach(()=>vi.unstubAllEnvs())

describe("service management actions", () => {
  it("creates an inactive service through the trusted draft transaction", async () => {
    await expect(createServiceDraft(input)).resolves.toEqual({ success: true, data: { serviceId } })
    expect(mocks.rpc).toHaveBeenCalledWith("create_service_draft", expect.objectContaining({
      p_actor_id: userId,
      p_name_en: "Service",
      p_category: "design",
      p_price: 100,
    }))
  })

  it("validates price precision and image URLs before saving", async () => {
    await expect(createServiceDraft({ ...input, price: 100.001 })).resolves.toMatchObject({ success: false })
    await expect(updateServiceDraft(serviceId, { ...input, imageUrls: ["javascript:alert(1)"] })).resolves.toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("accepts configured loopback Storage URLs but rejects remote HTTP origins",async()=>{
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","http://127.0.0.1:54321")
    const localUrl=`http://127.0.0.1:54321/storage/v1/object/public/service-images/${providerId}/${serviceId}/image.png`
    await expect(updateServiceDraft(serviceId,{...input,imageUrls:[localUrl]})).resolves.toEqual({success:true,data:undefined})
    mocks.rpc.mockClear()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","http://supabase.example.com")
    const insecureUrl=`http://supabase.example.com/storage/v1/object/public/service-images/${providerId}/${serviceId}/image.png`
    await expect(updateServiceDraft(serviceId,{...input,imageUrls:[insecureUrl]})).resolves.toMatchObject({success:false})
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("updates content and image references through the trusted transaction", async () => {
    await expect(updateServiceDraft(serviceId, input)).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("update_service_draft", expect.objectContaining({
      p_actor_id: userId,
      p_service_id: serviceId,
      p_image_urls: input.imageUrls,
    }))
  })

  it("submits drafts and changes an approved provider publication preference", async () => {
    await expect(submitServiceForReview(serviceId)).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("submit_service_for_review", {
      p_actor_id: userId,
      p_service_id: serviceId,
    })
    mocks.rpc.mockClear()
    await expect(setServicePublishIntent(serviceId, false)).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("set_service_publish_intent", {
      p_actor_id: userId,
      p_service_id: serviceId,
      p_publish: false,
    })
  })

  it("returns stored image references only after a successful delete", async () => {
    await expect(deleteService(serviceId)).resolves.toEqual({ success: true, data: { imageUrls: input.imageUrls } })
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("has orders") })
    await expect(deleteService(serviceId)).resolves.toEqual({
      success: false,
      error: "Services with existing orders cannot be deleted",
    })
  })

  it("persists valid cleanup paths in the provider-scoped queue",async()=>{
    const path=`${providerId}/${serviceId}/orphan.webp`
    await expect(queueServiceImageCleanup(serviceId,[path])).resolves.toEqual({success:true,data:{queued:1}})
    expect(mocks.rpc).toHaveBeenCalledWith("queue_service_image_cleanup",{
      p_actor_id:userId,p_provider_id:providerId,p_service_id:serviceId,p_paths:[path],
    })
    await expect(queueServiceImageCleanup(serviceId,[`other/${serviceId}/orphan.webp`])).resolves.toMatchObject({success:false})
  })

  it("loads and retries the persisted cleanup queue without dropping failures",async()=>{
    const path=`${providerId}/${serviceId}/orphan.webp`
    const row={id:"50000000-0000-4000-8000-000000000001",service_id:serviceId,storage_path:path,attempt_count:0,created_at:"2026-09-09T00:00:00.000Z",total_count:"1"}
    mocks.rpc.mockImplementation(async(name:string)=>({
      data:name==="get_service_image_cleanup_page"?[row]:name==="record_service_image_cleanup_result"?1:null,
      error:null,
    }))
    await expect(getServiceImageCleanupJobs()).resolves.toMatchObject({success:true,data:{total:1,jobs:[{storage_path:path}]}})
    await expect(retryServiceImageCleanupJobs()).resolves.toEqual({success:true,data:{completed:1,remaining:0}})
    expect(mocks.remove).toHaveBeenCalledWith([path])
    expect(mocks.rpc).toHaveBeenCalledWith("record_service_image_cleanup_result",{
      p_actor_id:userId,p_job_ids:[row.id],p_succeeded:true,p_error:null,
    })

    mocks.remove.mockResolvedValueOnce({data:null,error:new Error("offline")})
    await expect(retryServiceImageCleanupJobs()).resolves.toEqual({success:false,error:"Some image files could not be cleaned up"})
    expect(mocks.rpc).toHaveBeenLastCalledWith("record_service_image_cleanup_result",{
      p_actor_id:userId,p_job_ids:[row.id],p_succeeded:false,p_error:"Storage deletion failed",
    })
  })

  it("loads provider services with a sort-specific stable cursor",async()=>{
    const row={id:serviceId,name_ar:"خدمة",name_en:"Service",description_ar:null,description_en:null,
      category:"design",price:"100.00",price_type:"fixed",delivery_time:"3 days",features:[],image_urls:[],
      is_active:false,moderation_status:"draft",moderation_note:null,provider_publish_intent:false,
      created_at:"2026-09-09T00:00:00.000Z",sort_name:"خدمة"}
    mocks.rpc.mockResolvedValue({data:{services:[row],total:3},error:null})
    await expect(getProviderServicePage(" service ","price","asc","ar",null,1)).resolves.toMatchObject({
      success:true,data:{services:[{id:serviceId,price:100}],total:3,
        nextCursor:{sort:"price",direction:"asc",language:"ar",id:serviceId,price:100}},
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_provider_service_page",{
      p_actor_id:userId,p_provider_id:providerId,p_query:"service",p_sort:"price",p_direction:"asc",p_language:"ar",
      p_cursor_created_at:null,p_cursor_price:null,p_cursor_name:null,p_cursor_id:null,p_limit:1,
    })
  })
})
