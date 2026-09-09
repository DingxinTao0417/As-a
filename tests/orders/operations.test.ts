import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireProvider: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return {
    ...actual,
    requireAdmin: mocks.requireAdmin,
    requireProvider: mocks.requireProvider,
  }
})

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))

import {
  exportAdminOrderReport,
  getAdminOperationsSummary,
  getAdminOrderPage,
  getAdminProviderPage,
  getAdminServicePage,
  getAdminUserPage,
  getProviderDashboardSnapshot,
  getProviderLedgerPage,
} from "@/app/actions/operations"

const actorId = "10000000-0000-4000-8000-000000000001"
const providerId = "20000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAdmin.mockResolvedValue({ user: { id: actorId } })
  mocks.requireProvider.mockResolvedValue({ user: { id: actorId }, provider: { id: providerId } })
})

describe("operations reporting actions", () => {
  it("loads a provider snapshot from one trusted aggregate", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        stats: {
          active_orders: 2,
          awaiting_delivery: 1,
          awaiting_confirmation: 1,
          completed_orders: 4,
          pending_earnings: "75.50",
          gross_completed: "400.00",
          refunded_amount: "25.00",
          open_refunds: 1,
          open_disputes: 2,
          available_balance: "180.00",
          reserved_balance: "20.00",
          paid_balance: "100.00",
          total_earned: "300.00",
        },
        orders: [{ id: "order-1", seeker_name: "Buyer" }],
        total_orders: 7,
      },
      error: null,
    })

    await expect(getProviderDashboardSnapshot(2, 5)).resolves.toEqual({
      success: true,
      data: {
        stats: {
          activeOrders: 2,
          awaitingDelivery: 1,
          awaitingConfirmation: 1,
          completedOrders: 4,
          pendingEarnings: 75.5,
          grossCompleted: 400,
          refundedAmount: 25,
          openRefunds: 1,
          openDisputes: 2,
          availableBalance: 180,
          reservedBalance: 20,
          paidBalance: 100,
          totalEarned: 300,
        },
        orders: [{ id: "order-1", seeker_name: "Buyer", seeker: { full_name: "Buyer", email: "" } }],
        total: 7,
        page: 2,
        pageSize: 5,
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_provider_dashboard_snapshot", {
      p_actor_id: actorId,
      p_provider_id: providerId,
      p_offset: 5,
      p_limit: 5,
    })
  })

  it("rejects invalid provider pagination before querying", async () => {
    await expect(getProviderDashboardSnapshot(0, 50)).resolves.toEqual({
      success: false,
      error: "Invalid dashboard page",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("loads provider ledger entries with a stable oldest cursor",async()=>{
    mocks.rpc.mockResolvedValue({data:[{
      id:"30000000-0000-4000-8000-000000000001",entry_type:"order_settlement",
      reference_key:"order:1:settlement",available_delta:"85.00",reserved_delta:"0",paid_delta:"0",
      created_at:"2026-09-08T00:00:00.000Z",total_count:"4",
    }],error:null})
    await expect(getProviderLedgerPage(null,1)).resolves.toEqual({success:true,data:{
      entries:[{id:"30000000-0000-4000-8000-000000000001",entry_type:"order_settlement",reference_key:"order:1:settlement",available_delta:"85.00",reserved_delta:"0",paid_delta:"0",created_at:"2026-09-08T00:00:00.000Z"}],
      total:4,nextCursor:{createdAt:"2026-09-08T00:00:00.000Z",id:"30000000-0000-4000-8000-000000000001"},
    }})
    expect(mocks.rpc).toHaveBeenCalledWith("get_provider_ledger_page",{
      p_actor_id:actorId,p_provider_id:providerId,p_before_created_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("returns paged admin orders and users without leaking the window count into rows", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ id: "order-1", total_count: "12", seeker_email: "buyer@example.test" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ id: actorId, total_count: "4", email: "admin@example.test" }],
        error: null,
      })

    await expect(getAdminOrderPage(2, 5, " charge ", "paid")).resolves.toEqual({
      success: true,
      data: {
        orders: [{ id: "order-1", seeker_email: "buyer@example.test" }],
        total: 12,
        page: 2,
        pageSize: 5,
      },
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_admin_order_page", {
      p_actor_id: actorId,
      p_query: "charge",
      p_status: "paid",
      p_offset: 5,
      p_limit: 5,
    })

    await expect(getAdminUserPage(1, 2, " admin ")).resolves.toEqual({
      success: true,
      data: {
        users: [{ id: actorId, email: "admin@example.test" }],
        total: 4,
        page: 1,
        pageSize: 2,
      },
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "get_admin_user_page", {
      p_actor_id: actorId,
      p_query: "admin",
      p_offset: 0,
      p_limit: 2,
    })
  })

  it("loads searched provider results with a stable server cursor",async()=>{
    const row={
      id:providerId,name_ar:"مزود",name_en:"Provider",title_ar:null,title_en:"Designer",
      bio_ar:null,bio_en:null,category:"design",skills:["Figma"],rating:"4.5",reviews_count:3,
      completed_projects:2,is_verified:false,is_active:true,avatar_url:null,portfolio_urls:[],
      tap_account_status:"not_connected",tap_charges_enabled:false,tap_payouts_enabled:false,
      tap_status_checked_at:null,tap_status_source:null,created_at:"2026-09-09T00:00:00.000Z",total_count:"2",
    }
    mocks.rpc.mockResolvedValue({data:[row],error:null})
    const result=await getAdminProviderPage(" design ","unverified",null,1)
    expect(result).toMatchObject({success:true,data:{
      providers:[{id:providerId,name_en:"Provider",rating:4.5,tap_payouts_enabled:false}],
      total:2,nextCursor:{createdAt:row.created_at,id:providerId},
    }})
    if(result.success)expect(result.data.providers[0]).not.toHaveProperty("total_count")
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_admin_provider_page",{
      p_actor_id:actorId,p_query:"design",p_filter:"unverified",
      p_before_created_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("loads the service moderation queue with server filters and pending totals",async()=>{
    const row={
      id:providerId,name_ar:"خدمة",name_en:"Service",description_ar:null,description_en:null,
      category:"design",price:"100.00",price_type:"fixed",delivery_time:"3 days",is_active:false,
      moderation_status:"pending_review",moderation_note:null,image_urls:[],features:[],
      created_at:"2026-09-09T00:00:00.000Z",providers:{name_ar:"مزود",name_en:"Provider",avatar_url:null},
    }
    mocks.rpc.mockResolvedValue({data:{services:[row],total:3,pending_count:2},error:null})
    await expect(getAdminServicePage(" design ","pending_review",null,1)).resolves.toMatchObject({
      success:true,data:{services:[{id:providerId,price:100}],total:3,pendingCount:2,
        nextCursor:{createdAt:row.created_at,id:providerId}},
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_service_page",{
      p_actor_id:actorId,p_query:"design",p_status:"pending_review",
      p_before_created_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("loads the admin summary and rejects database failures", async () => {
    const summary = { total_orders: 12, open_refunds: 0, provider_available: "18.00" }
    mocks.rpc.mockResolvedValueOnce({ data: summary, error: null })
    await expect(getAdminOperationsSummary()).resolves.toEqual({ success: true, data: { summary } })

    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("unavailable") })
    await expect(getAdminOrderPage()).resolves.toEqual({ success: false, error: "Admin orders could not be loaded" })
  })

  it("exports the complete filtered report and surfaces the explicit row limit failure", async () => {
    const report = { generated_at: "2026-09-08T00:00:00Z", row_count: 1, orders: [{ id: "order-1" }] }
    mocks.rpc.mockResolvedValueOnce({ data: report, error: null })
    await expect(exportAdminOrderReport(" buyer ", "all")).resolves.toEqual({ success: true, data: { report } })
    expect(mocks.rpc).toHaveBeenCalledWith("export_admin_order_report", {
      p_actor_id: actorId,
      p_query: "buyer",
      p_status: null,
      p_max_rows: 5000,
    })

    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("Report exceeds row limit") })
    await expect(exportAdminOrderReport()).resolves.toEqual({
      success: false,
      error: "Order report could not be generated or exceeds 5,000 rows",
    })
  })
})
