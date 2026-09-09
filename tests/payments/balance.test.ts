import { afterEach,beforeEach,describe,expect,it,vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireProvider: vi.fn(),rpc:vi.fn(),retrieveDestination:vi.fn() }))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireProvider: mocks.requireProvider }
})
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))
vi.mock("@/lib/tap",()=>({
  retrieveTapDestination:mocks.retrieveDestination,
  tapDestinationCapabilities:(destination:{status:string|{value?:string;payout?:boolean}})=>{
    const value=typeof destination.status==="string"?destination.status:destination.status.value||"unknown"
    const status=value.toLowerCase()
    const payout=typeof destination.status==="object"&&destination.status.payout===true
    return {status,chargesEnabled:status==="active",payoutsEnabled:status==="active"&&payout}
  },
}))

import { checkAccountStatus,createPayout,getProviderBalance,getProviderWithdrawals } from "@/app/actions/tap-connect"

const userId = "10000000-0000-4000-8000-000000000001"
const providerId = "20000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireProvider.mockResolvedValue({
    user:{id:userId},provider:{id:providerId,tap_destination_id:"61025843",tap_onboarding_completed:true,tap_account_status:"active"},
  })
  mocks.retrieveDestination.mockResolvedValue({id:"61025843",status:{value:"Active",payout:true}})
  vi.stubEnv("TAP_MARKETPLACE_ENABLED","true")
})
afterEach(()=>vi.unstubAllEnvs())

describe("provider ledger actions", () => {
  it("loads available, reserved and paid balances from the trusted ledger", async () => {
    mocks.rpc.mockResolvedValue({
      data: { available: "70.00", reserved: "15.00", paid: "20.00", total_earned: "105.00" },
      error: null,
    })
    await expect(getProviderBalance()).resolves.toEqual({
      success: true,
      data: { available: 70, reserved: 15, paid: 20, totalEarned: 105 },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_provider_balance", {
      p_provider_id: providerId,
      p_actor_id: userId,
    })
  })

  it("does not turn a failed balance query into a zero balance", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") })
    await expect(getProviderBalance()).resolves.toEqual({ success: false, error: "Balance could not be loaded" })
  })

  it("submits withdrawals through the ledger reservation transaction", async () => {
    const requestId = "30000000-0000-4000-8000-000000000001"
    mocks.rpc.mockImplementation(async(name:string)=>({
      data:name==="sync_provider_tap_destination_status"?{status:"active"}:requestId,error:null,
    }))
    await expect(createPayout(70)).resolves.toEqual({ success: true, data: { requestId } })
    expect(mocks.retrieveDestination).toHaveBeenCalledWith("61025843")
    expect(mocks.rpc).toHaveBeenCalledWith("sync_provider_tap_destination_status",{
      p_actor_id:userId,p_provider_id:providerId,p_destination_id:"61025843",
      p_external_status:"active",p_charges_enabled:true,p_payouts_enabled:true,
    })
    expect(mocks.rpc).toHaveBeenCalledWith("request_provider_withdrawal", {
      p_provider_id: providerId,
      p_actor_id: userId,
      p_amount: 70,
    })
  })

  it("loads payout tracking references for the provider", async () => {
    const withdrawal = {
      id:"30000000-0000-4000-8000-000000000001",amount:"50.00",status:"processing",
      requested_at:"2026-09-09T00:00:00.000Z",processed_at:null,notes:null,payout_method:"tap_dashboard",
      external_reference:"payout_1",failure_reason:null,payout_attempts:[],
    }
    mocks.rpc.mockResolvedValue({data:{withdrawals:[withdrawal],total:3},error:null})
    await expect(getProviderWithdrawals(null,1)).resolves.toMatchObject({success:true,data:{
      withdrawals:[{id:withdrawal.id,amount:50,external_reference:"payout_1"}],total:3,
      nextCursor:{requestedAt:withdrawal.requested_at,id:withdrawal.id},
    }})
    expect(mocks.rpc).toHaveBeenCalledWith("get_provider_withdrawal_page",{
      p_actor_id:userId,p_provider_id:providerId,p_before_requested_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("does not trust stored onboarding flags when Marketplace verification is disabled",async()=>{
    vi.stubEnv("TAP_MARKETPLACE_ENABLED","false")
    await expect(checkAccountStatus()).resolves.toEqual({
      success:false,error:"Tap Marketplace status verification is not enabled",
    })
    await expect(createPayout(10)).resolves.toEqual({
      success:false,error:"Tap Marketplace status verification is not enabled",
    })
    expect(mocks.retrieveDestination).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("requires an explicit external payout capability before reserving funds",async()=>{
    mocks.retrieveDestination.mockResolvedValue({id:"61025843",status:"Active"})
    mocks.rpc.mockResolvedValue({data:{status:"active"},error:null})
    await expect(checkAccountStatus()).resolves.toEqual({success:true,data:{
      isComplete:false,status:"active",chargesEnabled:true,payoutsEnabled:false,
    }})
    await expect(createPayout(10)).resolves.toEqual({
      success:false,error:"Tap payouts are not enabled for this provider",
    })
    expect(mocks.rpc).not.toHaveBeenCalledWith("request_provider_withdrawal",expect.anything())
  })
})
