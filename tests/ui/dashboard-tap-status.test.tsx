import { cleanup,render,screen } from "@testing-library/react"
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest"

const mocks=vi.hoisted(()=>({
  getUser:vi.fn(),router:{push:vi.fn()},toast:vi.fn(),getContext:vi.fn(),checkStatus:vi.fn(),
  getSnapshot:vi.fn(),getWithdrawals:vi.fn(),getLedger:vi.fn(),
}))

vi.mock("@/components/language-provider",()=>({
  useLanguage:()=>({language:"en",t:(_arabic:string,english:string)=>english}),
}))
vi.mock("next/navigation",()=>({useRouter:()=>mocks.router}))
vi.mock("@/hooks/use-toast",()=>({useToast:()=>({toast:mocks.toast})}))
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:mocks.getUser}})}))
vi.mock("@/app/actions/providers",()=>({getCurrentProviderContext:mocks.getContext}))
vi.mock("@/app/actions/tap-connect",()=>({
  createConnectAccount:vi.fn(),createAccountLink:vi.fn(),createPayout:vi.fn(),
  checkAccountStatus:mocks.checkStatus,getProviderWithdrawals:mocks.getWithdrawals,
}))
vi.mock("@/app/actions/operations",()=>({
  getProviderDashboardSnapshot:mocks.getSnapshot,getProviderLedgerPage:mocks.getLedger,
}))
vi.mock("@/components/header",()=>({Header:()=>null}))
vi.mock("@/components/footer",()=>({Footer:()=>null}))
vi.mock("@/components/orders-table",()=>({OrdersTable:()=>null}))

import DashboardPage from "@/app/dashboard/page"

beforeEach(()=>{
  vi.resetAllMocks()
  mocks.getUser.mockResolvedValue({data:{user:{id:"user-1"}},error:null})
  mocks.getContext.mockResolvedValue({success:true,data:{
    role:"provider",provider:{id:"provider-1",tap_destination_id:"61025843",tap_onboarding_completed:true},
  }})
  mocks.checkStatus.mockResolvedValue({success:true,data:{
    isComplete:false,status:"active",chargesEnabled:true,payoutsEnabled:false,
  }})
  mocks.getSnapshot.mockResolvedValue({success:true,data:{orders:[],total:0,stats:{
    activeOrders:0,completedOrders:0,pendingEarnings:0,availableBalance:0,reservedBalance:0,
    paidBalance:0,openRefunds:0,openDisputes:0,
  }}})
  mocks.getWithdrawals.mockResolvedValue({success:true,data:{withdrawals:[],total:0,nextCursor:null}})
  mocks.getLedger.mockResolvedValue({success:true,data:{entries:[],total:0,nextCursor:null}})
})
afterEach(()=>cleanup())

describe("provider Tap status",()=>{
  it("renders externally verified collection separately from pending payout activation",async()=>{
    render(<DashboardPage />)
    expect(await screen.findByText("Payment collection is active, but payouts still await Tap approval.")).toBeVisible()
    expect(screen.getByRole("button",{name:"Refresh Tap status"})).toBeVisible()
    expect(screen.getByRole("button",{name:"Connect Tap Payment First"})).toBeDisabled()
  })
})
