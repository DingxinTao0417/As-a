"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const uuid = z.string().uuid()

export type PersistedAIMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

export async function getAIChatSession(sessionId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(sessionId).success) return fail("Invalid AI chat session")
    const { data, error } = await createAdminClient().rpc("get_ai_chat_session", {
      p_actor_id: user.id,
      p_session_id: sessionId,
    })
    if (error || !data || typeof data !== "object") return fail("AI chat session could not be restored")
    const session = data as Record<string, unknown>
    if (!Array.isArray(session.turns)) return fail("AI chat session could not be restored")
    const messages: PersistedAIMessage[] = []
    for (const item of session.turns) {
      if (!item || typeof item !== "object") return fail("AI chat session could not be restored")
      const turn = item as Record<string, unknown>
      if (typeof turn.client_request_id !== "string" || typeof turn.user !== "string"
          || typeof turn.assistant !== "string") return fail("AI chat session could not be restored")
      messages.push(
        { id: turn.client_request_id, role: "user", content: turn.user },
        { id: `${turn.client_request_id}:assistant`, role: "assistant", content: turn.assistant },
      )
    }
    return ok({
      sessionId: typeof session.id === "string" ? session.id : sessionId,
      language: session.language === "ar" ? "ar" as const : "en" as const,
      messages,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("AI chat session could not be restored")
  }
}
