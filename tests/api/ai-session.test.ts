import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), rpc: vi.fn() }))
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))

import { getAIChatSession } from "@/app/actions/ai-chat"

const userId = "10000000-0000-4000-8000-000000000001"
const sessionId = "20000000-0000-4000-8000-000000000001"
const requestId = "30000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
})

describe("AI chat session actions", () => {
  it("restores completed turns as user and assistant messages", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: sessionId,
        language: "en",
        turns: [{
          client_request_id: requestId,
          user: "Where is my order?",
          assistant: "Check the trusted order status.",
          created_at: "2026-09-08T00:00:00.000Z",
        }],
      },
      error: null,
    })
    await expect(getAIChatSession(sessionId)).resolves.toEqual({
      success: true,
      data: {
        sessionId,
        language: "en",
        messages: [
          { id: requestId, role: "user", content: "Where is my order?" },
          { id: `${requestId}:assistant`, role: "assistant", content: "Check the trusted order status." },
        ],
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith("get_ai_chat_session", {
      p_actor_id: userId,
      p_session_id: sessionId,
    })
  })

  it("rejects invalid identifiers and malformed database results", async () => {
    await expect(getAIChatSession("bad")).resolves.toEqual({ success: false, error: "Invalid AI chat session" })
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rpc.mockResolvedValue({ data: { id: sessionId, turns: [{ user: "missing fields" }] }, error: null })
    await expect(getAIChatSession(sessionId)).resolves.toEqual({ success: false, error: "AI chat session could not be restored" })
  })
})
