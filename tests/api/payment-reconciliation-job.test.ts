import { afterEach,beforeEach,describe,expect,it,vi } from "vitest"

const mocks=vi.hoisted(()=>({
  reconcile:vi.fn(),
  queryResult:{data:[] as unknown[],error:null as unknown},
}))

function query(){
  const value:Record<string,unknown>={}
  for(const method of ["select","in","not","lt","order"])value[method]=vi.fn(()=>value)
  value.limit=vi.fn(async()=>mocks.queryResult)
  return value
}

vi.mock("@/lib/payment-reconciliation",()=>({reconcileTapPaymentAttempt:mocks.reconcile}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:vi.fn(()=>query())})}))

import { POST } from "@/app/api/jobs/payment-reconciliation/route"

const secret="test-reconciliation-secret-12345"
const request=(authorization?:string)=>new Request("https://app.example.test/api/jobs/payment-reconciliation",{
  method:"POST",headers:authorization?{authorization}:{},
})

beforeEach(()=>{
  vi.resetAllMocks()
  mocks.queryResult={data:[],error:null}
})
afterEach(()=>vi.unstubAllEnvs())

describe("payment reconciliation job",()=>{
  it("fails closed when the job secret is missing or incorrect",async()=>{
    expect((await POST(request())).status).toBe(503)
    vi.stubEnv("RECONCILIATION_JOB_SECRET",secret)
    expect((await POST(request("Bearer wrong-secret"))).status).toBe(401)
  })

  it("keeps external Tap reads disabled behind the reconciliation gate",async()=>{
    vi.stubEnv("RECONCILIATION_JOB_SECRET",secret)
    const response=await POST(request(`Bearer ${secret}`))
    expect(response.status).toBe(503)
    expect(mocks.reconcile).not.toHaveBeenCalled()
  })

  it("scans a bounded stale batch and reports outcomes without exposing identifiers",async()=>{
    vi.stubEnv("RECONCILIATION_JOB_SECRET",secret)
    vi.stubEnv("TAP_PAYMENT_RECONCILIATION_ENABLED","true")
    vi.stubEnv("PAYMENT_RECONCILIATION_MIN_AGE_MINUTES","30")
    mocks.queryResult={data:[{id:"a"},{id:"b"},{id:"c"}],error:null}
    mocks.reconcile
      .mockResolvedValueOnce({success:true,data:{externalStatus:"CAPTURED",orderStatus:"paid"}})
      .mockResolvedValueOnce({success:false,error:"mismatch"})
      .mockRejectedValueOnce(new Error("network"))
    const response=await POST(request(`Bearer ${secret}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({scanned:3,processed:1,needsReview:1,failed:1,minimumAgeMinutes:30})
    expect(mocks.reconcile).toHaveBeenCalledTimes(3)
  })
})
