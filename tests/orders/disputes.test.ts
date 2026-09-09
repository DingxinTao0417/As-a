import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}))
vi.mock("@/lib/auth", async () => {
  const actual=await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth:mocks.requireAuth, requireAdmin:mocks.requireAdmin }
})
vi.mock("@/lib/supabase/admin",()=>({ createAdminClient:()=>({ rpc:mocks.rpc }) }))
vi.mock("next/cache",()=>({ revalidatePath:mocks.revalidatePath }))

import {
  addDisputeEvidence,
  createOrderDispute,
  getAdminDisputes,
  getDisputeEligibleOrders,
  getDisputeEvidence,
  getMyDisputes,
  reviewDispute,
} from "@/app/actions/disputes"

const userId="10000000-0000-4000-8000-000000000001"
const orderId="20000000-0000-4000-8000-000000000001"
const requestId="30000000-0000-4000-8000-000000000001"
const disputeId="40000000-0000-4000-8000-000000000001"
const dispute={ id:disputeId,order_id:orderId,opened_by:userId,category:"quality",description:"The delivered work does not match the scope",requested_resolution:"Review the delivery",status:"open" }

beforeEach(()=>{
  vi.resetAllMocks()
  const supabase={}
  mocks.requireAuth.mockResolvedValue({ user:{ id:userId },supabase })
  mocks.requireAdmin.mockResolvedValue({ user:{ id:userId },supabase })
  mocks.rpc.mockResolvedValue({ data:dispute,error:null })
})

describe("dispute actions",()=>{
  it("creates an ownership-checked idempotent dispute",async()=>{
    await expect(createOrderDispute({ orderId,clientRequestId:requestId,category:"quality",description:dispute.description,requestedResolution:dispute.requested_resolution })).resolves.toEqual({ success:true,data:{ dispute } })
    expect(mocks.rpc).toHaveBeenCalledWith("create_order_dispute",{
      p_actor_id:userId,p_order_id:orderId,p_client_request_id:requestId,p_category:"quality",
      p_description:dispute.description,p_requested_resolution:dispute.requested_resolution,
    })
  })

  it("rejects incomplete disputes before the database call",async()=>{
    const result=await createOrderDispute({ orderId,clientRequestId:requestId,category:"other",description:"short",requestedResolution:"x" })
    expect(result.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("loads eligible orders and participant/admin queues",async()=>{
    const timestamp="2026-09-09T00:00:00.000Z"
    const eligible={id:orderId,service_name_ar:"طلب",service_name_en:"Order",status:"completed",amount:"100",currency:"SAR",dispute_status:"none",created_at:timestamp}
    const disputeRow={...dispute,ledger_hold_amount:"85",assigned_to:null,resolution:null,resolution_note:null,resolution_refund_id:null,created_at:timestamp,updated_at:timestamp}
    const evidence={id:requestId,dispute_id:disputeId,uploaded_by:userId,storage_path:`${disputeId}/${userId}/evidence.pdf`,description:null,created_at:timestamp}
    mocks.rpc.mockImplementation(async(name:string)=>name==="get_dispute_eligible_order_page"
      ?{data:{orders:[eligible],total:2},error:null}
      :name==="get_dispute_evidence_page"
        ?{data:{evidence:[evidence],total:3},error:null}
        :{data:{disputes:[disputeRow],total:4,open_count:1},error:null})
    await expect(getDisputeEligibleOrders(null,1)).resolves.toMatchObject({success:true,data:{
      orders:[{id:orderId,amount:100}],total:2,nextCursor:{createdAt:timestamp,id:orderId},
    }})
    await expect(getMyDisputes(null,1)).resolves.toMatchObject({success:true,data:{
      disputes:[{id:disputeId,ledger_hold_amount:85}],total:4,openCount:1,nextCursor:{updatedAt:timestamp,id:disputeId},
    }})
    await expect(getAdminDisputes("active",null,1)).resolves.toMatchObject({success:true,data:{disputes:[{id:disputeId}],total:4,openCount:1}})
    await expect(getDisputeEvidence(disputeId,null,1)).resolves.toMatchObject({success:true,data:{
      evidence:[{id:requestId}],total:3,nextCursor:{createdAt:timestamp,id:requestId},
    }})
  })

  it("records only a validated private evidence path",async()=>{
    const evidence={ id:requestId,dispute_id:disputeId,uploaded_by:userId,storage_path:`${disputeId}/${userId}/evidence.pdf` }
    mocks.rpc.mockResolvedValue({ data:evidence,error:null })
    await expect(addDisputeEvidence(disputeId,evidence.storage_path,"Delivery screenshot")).resolves.toEqual({ success:true,data:{ evidence } })
    expect(mocks.rpc).toHaveBeenCalledWith("add_dispute_evidence",{
      p_actor_id:userId,p_dispute_id:disputeId,p_storage_path:evidence.storage_path,p_description:"Delivery screenshot",
    })
  })

  it("requires an audited administrator decision and refund amount",async()=>{
    await expect(reviewDispute(disputeId,"refund","Valid decision")).resolves.toMatchObject({ success:false })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data:{ ...dispute,status:"resolved",resolution:"refund" },error:null })
    await expect(reviewDispute(disputeId,"refund","Partial refund required",20)).resolves.toMatchObject({ success:true,data:{ dispute:{ resolution:"refund" } } })
    expect(mocks.rpc).toHaveBeenCalledWith("review_order_dispute",{
      p_actor_id:userId,p_dispute_id:disputeId,p_action:"refund",p_note:"Partial refund required",p_refund_amount:20,
    })
  })
})
