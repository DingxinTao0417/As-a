import { cleanup,fireEvent,render,screen } from "@testing-library/react"
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest"

const mocks=vi.hoisted(()=>({
  t:(_arabic:string,english:string)=>english,toast:vi.fn(),getEvents:vi.fn(),getAttempts:vi.fn(),
}))
vi.mock("@/components/language-provider",()=>({useLanguage:()=>({language:"en",t:mocks.t})}))
vi.mock("@/hooks/use-toast",()=>({useToast:()=>({toast:mocks.toast})}))
vi.mock("@/app/actions/admin",()=>({
  getPaymentExceptions:mocks.getEvents,getPaymentReconciliationPage:mocks.getAttempts,
  recoverPaymentAttemptCharge:vi.fn(),reconcilePaymentAttempt:vi.fn(),relinkPaymentEvent:vi.fn(),retryPaymentEvent:vi.fn(),
}))

import AdminPaymentsPage from "@/app/admin/payments/page"

beforeEach(()=>{
  vi.resetAllMocks()
  mocks.getEvents.mockResolvedValue({success:true,data:{
    events:[],total:0,pendingCount:0,quarantinedCount:0,nextCursor:null,
  }})
  mocks.getAttempts.mockResolvedValue({success:true,data:{attempts:[{
    id:"50000000-0000-4000-8000-000000000001",order_id:"40000000-0000-4000-8000-000000000001",
    status:"creating",external_status:null,external_charge_id:null,amount:100,currency:"SAR",
    last_checked_at:null,created_at:"2026-09-09T00:00:00.000Z",updated_at:"2026-09-09T00:00:00.000Z",
    service_name_ar:"خدمة",service_name_en:"Service",seeker_email:"buyer@example.test",
    last_event_at:null,last_event_status:null,last_event_result:null,
  }],total:1,nextCursor:null}})
})
afterEach(()=>cleanup())

describe("administrator payment recovery",()=>{
  it("renders an actionable recovery form for an attempt without a Charge ID",async()=>{
    render(<AdminPaymentsPage />)
    fireEvent.click(await screen.findByRole("button",{name:"Recover Charge"}))
    expect(screen.getByRole("heading",{name:"Recover Missing Charge"})).toBeVisible()
    expect(screen.getByLabelText("Charge ID")).toHaveAttribute("placeholder","chg_...")
    expect(screen.getByLabelText("Recovery reason and review evidence")).toBeVisible()
    expect(screen.getByRole("button",{name:"Verify and Recover"})).toBeDisabled()
  })
})
