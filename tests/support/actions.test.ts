import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  queryResult: { data: [] as unknown[], error: null as unknown },
  revalidatePath: vi.fn(),
}))

function query() {
  const value: Record<string, unknown> = { data: mocks.queryResult.data, error: mocks.queryResult.error }
  for (const method of ["select", "eq", "order", "limit"]) value[method] = vi.fn(() => value)
  return value
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth, requireAdmin: mocks.requireAdmin }
})
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: vi.fn(() => query()) }),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import {
  createSupportTicket,
  getAdminSupportTickets,
  getMySupportTickets,
  getSupportTicketMessages,
  replySupportTicket,
  setSupportTicketStatus,
} from "@/app/actions/support"

const userId = "10000000-0000-4000-8000-000000000001"
const ticketId = "20000000-0000-4000-8000-000000000001"
const requestId = "30000000-0000-4000-8000-000000000001"
const ticket = {
  id: ticketId,
  requester_id: userId,
  order_id: null,
  assigned_to: null,
  subject: "Payment question",
  description: "I need help understanding the order status",
  language: "en" as const,
  status: "open" as const,
  created_at: "2026-09-08T00:00:00.000Z",
  updated_at: "2026-09-08T00:00:00.000Z",
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.requireAdmin.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockResolvedValue({ data: ticket, error: null })
  mocks.queryResult = { data: [], error: null }
})

describe("support actions", () => {
  it("creates an idempotent ticket through the trusted transaction", async () => {
    await expect(createSupportTicket({
      clientRequestId: requestId,
      subject: ticket.subject,
      description: ticket.description,
      language: "en",
      orderId: null,
    })).resolves.toEqual({ success: true, data: { ticket } })
    expect(mocks.rpc).toHaveBeenCalledWith("create_support_ticket", {
      p_actor_id: userId,
      p_client_request_id: requestId,
      p_subject: ticket.subject,
      p_description: ticket.description,
      p_language: "en",
      p_order_id: null,
    })
  })

  it("rejects incomplete tickets before the database call", async () => {
    const result = await createSupportTicket({
      clientRequestId: requestId,
      subject: "x",
      description: "short",
      language: "en",
      orderId: null,
    })
    expect(result.success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("loads user and administrator queues with explicit failure handling", async () => {
    const row={...ticket,requester_name:"Test User",requester_email:"user@example.test",total_count:"1"}
    mocks.rpc.mockResolvedValue({data:[row],error:null})
    await expect(getMySupportTickets()).resolves.toEqual({ success: true, data: { tickets: [ticket],total:1,nextCursor:null } })
    await expect(getAdminSupportTickets()).resolves.toEqual({ success: true, data: { tickets: [{...ticket,requester:{full_name:"Test User",email:"user@example.test"}}],total:1,nextCursor:null } })
    expect(mocks.rpc).toHaveBeenCalledWith("get_support_ticket_page",expect.objectContaining({p_admin_view:true,p_limit:50}))
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") })
    await expect(getMySupportTickets()).resolves.toEqual({ success: false, error: "Support tickets could not be loaded" })
  })

  it("loads and sends ticket replies with a stable request ID", async () => {
    const message = { id: requestId, ticket_id: ticketId, sender_id: userId, body: "More detail", created_at: ticket.created_at }
    mocks.rpc.mockResolvedValueOnce({ data: [{...message,total_count:1}], error: null }).mockResolvedValueOnce({ data: message, error: null })
    await expect(getSupportTicketMessages(ticketId)).resolves.toEqual({ success: true, data: { messages: [message],total:1,nextCursor:null } })
    expect(mocks.rpc).toHaveBeenCalledWith("get_support_ticket_message_page",{
      p_actor_id:userId,p_ticket_id:ticketId,p_before_created_at:null,p_before_id:null,p_limit:50,
    })
    await expect(replySupportTicket({ ticketId, clientRequestId: requestId, body: "More detail" })).resolves.toEqual({ success: true, data: { message } })
    expect(mocks.rpc).toHaveBeenLastCalledWith("reply_support_ticket", {
      p_actor_id: userId,
      p_ticket_id: ticketId,
      p_client_request_id: requestId,
      p_body: "More detail",
    })
  })

  it("requires an audited reason for administrator status changes", async () => {
    await expect(setSupportTicketStatus(ticketId, "closed", " ")).resolves.toMatchObject({ success: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: "closed", error: null })
    await expect(setSupportTicketStatus(ticketId, "closed", "Resolved with user")).resolves.toEqual({
      success: true,
      data: { status: "closed" },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("set_support_ticket_status", {
      p_actor_id: userId,
      p_ticket_id: ticketId,
      p_status: "closed",
      p_reason: "Resolved with user",
    })
  })
})
