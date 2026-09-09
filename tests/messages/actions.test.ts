import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), rpc: vi.fn() }))

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))

import {
  getConversationMessages,
  getConversationPage,
  getConversationUnreadCounts,
  markConversationRead,
  openProviderConversation,
  sendConversationMessage,
  sendServiceCardMessage,
  setConversationPreference,
} from "@/app/actions/messages"

const userId = "10000000-0000-4000-8000-000000000001"
const conversationId = "20000000-0000-4000-8000-000000000001"
const requestId = "30000000-0000-4000-8000-000000000001"
const message = { id: "40000000-0000-4000-8000-000000000001", content: "hello" }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "send_conversation_message" || name === "send_service_card_message" ? message
      : name === "mark_conversation_read" ? 2
      : name === "open_provider_conversation" ? conversationId
      : name === "get_conversation_messages" ? [
          { id: "40000000-0000-4000-8000-000000000002", created_at: "2026-09-08T02:00:00.000Z", content: "new" },
          { id: "40000000-0000-4000-8000-000000000001", created_at: "2026-09-08T01:00:00.000Z", content: "old" },
        ]
      : name === "get_conversation_unread_counts" ? [{ conversation_id: conversationId, unread_count: 3 }]
      : name === "get_conversation_page" ? [{
          id: conversationId,
          provider_id: "50000000-0000-4000-8000-000000000001",
          seeker_id: userId,
          last_message_at: "2026-09-08T03:00:00.000Z",
          other_party_name_ar: "مزود",
          other_party_name_en: "Provider",
          is_pinned: true,
          unread_count: 2,
          total_count: "3",
        }]
      : null,
    error: null,
  }))
})

describe("message actions", () => {
  it("opens or restores a provider conversation through an idempotent transaction", async () => {
    const providerId = "50000000-0000-4000-8000-000000000001"
    await expect(openProviderConversation(providerId)).resolves.toEqual({ success: true, data: { conversationId } })
    expect(mocks.rpc).toHaveBeenCalledWith("open_provider_conversation", {
      p_actor_id: userId,
      p_provider_id: providerId,
    })
  })

  it("sends with a stable client request identifier and authenticated actor", async () => {
    await expect(sendConversationMessage({ conversationId, clientRequestId: requestId, content: " hello " })).resolves.toEqual({
      success: true,
      data: { message },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("send_conversation_message", {
      p_actor_id: userId,
      p_conversation_id: conversationId,
      p_client_request_id: requestId,
      p_content: "hello",
    })
  })

  it("sends service cards by identifier so the database builds trusted content", async () => {
    const serviceId = "50000000-0000-4000-8000-000000000001"
    await expect(sendServiceCardMessage({ conversationId, clientRequestId: requestId, serviceId })).resolves.toEqual({
      success: true,
      data: { message },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("send_service_card_message", {
      p_actor_id: userId,
      p_conversation_id: conversationId,
      p_client_request_id: requestId,
      p_service_id: serviceId,
    })
  })

  it("rejects invalid payloads and propagates a safe failure", async () => {
    await expect(sendConversationMessage({ conversationId, clientRequestId: "bad", content: "hello" })).resolves.toEqual({
      success: false,
      error: "Invalid message",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("rejected") })
    await expect(sendConversationMessage({ conversationId, clientRequestId: requestId, content: "hello" })).resolves.toEqual({
      success: false,
      error: "Message could not be sent",
    })
  })

  it("updates only the authenticated participant preference", async () => {
    await expect(setConversationPreference(conversationId, "archived", true)).resolves.toEqual({
      success: true,
      data: { clearedAt: null },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("set_conversation_preference", {
      p_actor_id: userId,
      p_conversation_id: conversationId,
      p_preference: "archived",
      p_enabled: true,
    })
  })

  it("marks received messages as read through the trusted transaction", async () => {
    await expect(markConversationRead(conversationId)).resolves.toEqual({ success: true, data: { count: 2 } })
    expect(mocks.rpc).toHaveBeenCalledWith("mark_conversation_read", {
      p_actor_id: userId,
      p_conversation_id: conversationId,
    })
  })

  it("returns ascending message pages with a stable oldest cursor", async () => {
    const result = await getConversationMessages(conversationId, undefined, 2)
    expect(result).toMatchObject({
      success: true,
      data: {
        messages: [{ content: "old" }, { content: "new" }],
        nextCursor: {
          createdAt: "2026-09-08T01:00:00.000Z",
          id: "40000000-0000-4000-8000-000000000001",
        },
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_conversation_messages", expect.objectContaining({ p_limit: 2 }))
  })

  it("loads unread counts for the authenticated participant", async () => {
    await expect(getConversationUnreadCounts()).resolves.toEqual({
      success: true,
      data: { counts: [{ conversation_id: conversationId, unread_count: 3 }] },
    })
  })

  it("returns a stable server-filtered conversation page and cursor", async () => {
    const result = await getConversationPage({ archived:false,query:" Provider ",pageSize:1 })
    expect(result).toEqual({
      success:true,
      data:{
        conversations:[{
          id:conversationId,
          provider_id:"50000000-0000-4000-8000-000000000001",
          seeker_id:userId,
          last_message_at:"2026-09-08T03:00:00.000Z",
          other_party_name_ar:"مزود",
          other_party_name_en:"Provider",
          is_pinned:true,
          unread_count:2,
        }],
        total:3,
        nextCursor:{
          pinned:true,
          lastMessageAt:"2026-09-08T03:00:00.000Z",
          id:conversationId,
        },
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_conversation_page",{
      p_actor_id:userId,
      p_archived:false,
      p_query:"Provider",
      p_before_pinned:null,
      p_before_last_message_at:null,
      p_before_id:null,
      p_limit:1,
    })
  })
})
