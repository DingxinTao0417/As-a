import { beforeEach,describe,expect,it,vi } from "vitest"

const mocks=vi.hoisted(()=>({requireProvider:vi.fn(),requireAdmin:vi.fn(),rpc:vi.fn(),revalidatePath:vi.fn()}))
vi.mock("@/lib/auth",async()=>{const actual=await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");return{...actual,requireProvider:mocks.requireProvider,requireAdmin:mocks.requireAdmin}})
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}))
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidatePath}))

import {
  cancelProviderVerification,
  getAdminProviderVerificationRequests,
  getMyProviderVerificationRequests,
  reviewProviderVerification,
  revokeProviderVerification,
  submitProviderVerification,
} from "@/app/actions/verification"

const userId="10000000-0000-4000-8000-000000000001"
const providerId="20000000-0000-4000-8000-000000000001"
const requestId="30000000-0000-4000-8000-000000000001"
const clientRequestId="40000000-0000-4000-8000-000000000001"
const document={path:`${providerId}/${userId}/${clientRequestId}-0.pdf`,name:"credential.pdf",mime:"application/pdf" as const,size:1024}

beforeEach(()=>{
  vi.resetAllMocks();mocks.requireProvider.mockResolvedValue({user:{id:userId},provider:{id:providerId}});mocks.requireAdmin.mockResolvedValue({user:{id:userId}})
})

describe("provider verification actions",()=>{
  it("submits a request with trusted provider identity and bounded documents",async()=>{
    mocks.rpc.mockResolvedValue({data:{id:requestId,status:"pending"},error:null})
    await expect(submitProviderVerification({clientRequestId,note:"Professional credential",documents:[document]})).resolves.toEqual({success:true,data:{request:{id:requestId,status:"pending"}}})
    expect(mocks.rpc).toHaveBeenCalledWith("request_provider_verification",{p_actor_id:userId,p_provider_id:providerId,p_client_request_id:clientRequestId,p_note:"Professional credential",p_documents:[document]})
  })

  it("rejects unsupported document types before writing",async()=>{
    const result=await submitProviderVerification({clientRequestId,note:"",documents:[{...document,mime:"application/octet-stream" as never}]})
    expect(result.success).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("loads owner and administrator history with a stable cursor",async()=>{
    const row={id:requestId,provider_id:providerId,requested_by:userId,note:null,status:"pending",review_note:null,reviewed_at:null,created_at:"2026-09-09T00:00:00.000Z",updated_at:"2026-09-09T00:00:00.000Z",provider_name_ar:"مزود",provider_name_en:"Provider",provider_is_verified:false,documents:[document],total_count:"1"}
    mocks.rpc.mockResolvedValue({data:[row],error:null})
    await expect(getMyProviderVerificationRequests(null,1)).resolves.toMatchObject({success:true,data:{providerId,total:1,nextCursor:{id:requestId}}})
    await expect(getMyProviderVerificationRequests({updatedAt:row.updated_at,id:requestId},20)).resolves.toMatchObject({success:true})
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_provider_verification_page",{
      p_actor_id:userId,p_admin_view:false,p_before_updated_at:row.updated_at,p_before_id:requestId,p_limit:20,
    })
    await expect(getAdminProviderVerificationRequests()).resolves.toMatchObject({success:true,data:{providerId:null,total:1,requests:[{id:requestId}]}})
  })

  it("reviews, cancels and revokes only through explicit trusted operations",async()=>{
    mocks.rpc.mockResolvedValue({data:true,error:null})
    await expect(cancelProviderVerification(requestId)).resolves.toEqual({success:true,data:undefined})
    await expect(reviewProviderVerification(requestId,"approved","Documents verified")).resolves.toMatchObject({success:true})
    await expect(revokeProviderVerification(providerId,"Credential expired")).resolves.toEqual({success:true,data:undefined})
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_provider_verification",{p_actor_id:userId,p_provider_id:providerId,p_reason:"Credential expired"})
  })
})
