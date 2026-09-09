"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const uuid = z.string().uuid()
const messageInput = z.object({
  conversationId: uuid,
  clientRequestId: uuid,
  content: z.string().trim().min(1).max(10000),
})

export async function openProviderConversation(providerId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(providerId).success) return fail("Invalid provider")
    const { data: conversationId, error } = await createAdminClient().rpc("open_provider_conversation", {
      p_actor_id: user.id,
      p_provider_id: providerId,
    })
    return error || !conversationId
      ? fail("Conversation could not be opened")
      : ok({ conversationId: conversationId as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Conversation could not be opened")
  }
}

export async function sendConversationMessage(input: z.infer<typeof messageInput>) {
  try {
    const { user } = await requireAuth()
    const parsed = messageInput.safeParse(input)
    if (!parsed.success) return fail("Invalid message")
    const { data, error } = await createAdminClient().rpc("send_conversation_message", {
      p_actor_id: user.id,
      p_conversation_id: parsed.data.conversationId,
      p_client_request_id: parsed.data.clientRequestId,
      p_content: parsed.data.content,
    })
    return error || !data ? fail("Message could not be sent") : ok({ message: data })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Message could not be sent")
  }
}

export async function sendServiceCardMessage(input: {
  conversationId: string
  clientRequestId: string
  serviceId: string
}) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(input.conversationId).success
        || !uuid.safeParse(input.clientRequestId).success
        || !uuid.safeParse(input.serviceId).success) {
      return fail("Invalid service card")
    }
    const { data, error } = await createAdminClient().rpc("send_service_card_message", {
      p_actor_id: user.id,
      p_conversation_id: input.conversationId,
      p_client_request_id: input.clientRequestId,
      p_service_id: input.serviceId,
    })
    return error || !data ? fail("Service card could not be sent") : ok({ message: data })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Service card could not be sent")
  }
}

export async function setConversationPreference(
  conversationId: string,
  preference: "pinned" | "archived" | "cleared",
  enabled?: boolean,
) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(conversationId).success
        || !["pinned", "archived", "cleared"].includes(preference)
        || (preference !== "cleared" && typeof enabled !== "boolean")) {
      return fail("Invalid conversation preference")
    }
    const { data: clearedAt, error } = await createAdminClient().rpc("set_conversation_preference", {
      p_actor_id: user.id,
      p_conversation_id: conversationId,
      p_preference: preference,
      p_enabled: preference === "cleared" ? null : enabled,
    })
    return error ? fail("Conversation preference could not be saved") : ok({ clearedAt: clearedAt as string | null })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Conversation preference could not be saved")
  }
}

export async function markConversationRead(conversationId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(conversationId).success) return fail("Invalid conversation")
    const { data, error } = await createAdminClient().rpc("mark_conversation_read", {
      p_actor_id: user.id,
      p_conversation_id: conversationId,
    })
    return error ? fail("Messages could not be marked as read") : ok({ count: Number(data || 0) })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Messages could not be marked as read")
  }
}

const messageCursor = z.object({ createdAt: z.string().datetime(), id: uuid })
const conversationCursor = z.object({
  pinned: z.boolean(),
  lastMessageAt: z.string().datetime(),
  id: uuid,
})

export async function getConversationMessages(
  conversationId: string,
  cursor?: z.infer<typeof messageCursor>,
  pageSize = 50,
) {
  try {
    const { user } = await requireAuth()
    const parsedCursor = cursor ? messageCursor.safeParse(cursor) : null
    if (!uuid.safeParse(conversationId).success
        || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
        || (parsedCursor && !parsedCursor.success)) {
      return fail("Invalid message page")
    }
    const value = parsedCursor?.success ? parsedCursor.data : null
    const { data, error } = await createAdminClient().rpc("get_conversation_messages", {
      p_actor_id: user.id,
      p_conversation_id: conversationId,
      p_before_created_at: value?.createdAt || null,
      p_before_id: value?.id || null,
      p_limit: pageSize,
    })
    if (error) return fail("Messages could not be loaded")
    const descending = (data || []) as Array<{ id: string; created_at: string } & Record<string, unknown>>
    const oldest = descending.at(-1)
    return ok({
      messages: [...descending].reverse(),
      nextCursor: descending.length === pageSize && oldest
        ? { createdAt: oldest.created_at, id: oldest.id }
        : null,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Messages could not be loaded")
  }
}

export async function getConversationUnreadCounts() {
  try {
    const { user } = await requireAuth()
    const { data, error } = await createAdminClient().rpc("get_conversation_unread_counts", {
      p_actor_id: user.id,
    })
    return error
      ? fail("Unread counts could not be loaded")
      : ok({ counts: (data || []) as Array<{ conversation_id: string; unread_count: number }> })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Unread counts could not be loaded")
  }
}

export async function getConversationPage(input: {
  archived?: boolean
  query?: string
  cursor?: z.infer<typeof conversationCursor> | null
  pageSize?: number
} = {}) {
  try {
    const { user } = await requireAuth()
    const archived = input.archived ?? false
    const query = (input.query ?? "").trim()
    const pageSize = input.pageSize ?? 50
    const parsedCursor = input.cursor ? conversationCursor.safeParse(input.cursor) : null
    if (typeof archived !== "boolean" || query.length > 100
        || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
        || (parsedCursor && !parsedCursor.success)) {
      return fail("Invalid conversation page")
    }
    const cursor = parsedCursor?.success ? parsedCursor.data : null
    const { data, error } = await createAdminClient().rpc("get_conversation_page", {
      p_actor_id: user.id,
      p_archived: archived,
      p_query: query || null,
      p_before_pinned: cursor?.pinned ?? null,
      p_before_last_message_at: cursor?.lastMessageAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: pageSize,
    })
    if (error) return fail("Conversations could not be loaded")
    const rows = (data || []) as Array<Record<string, unknown>>
    const last = rows.at(-1)
    return ok({
      conversations: rows.map((row) => {
        const conversation = { ...row }
        delete conversation.total_count
        return conversation
      }),
      total: rows.length ? Number(rows[0].total_count) : 0,
      nextCursor: rows.length === pageSize && last
        ? {
            pinned: Boolean(last.is_pinned),
            lastMessageAt: String(last.last_message_at),
            id: String(last.id),
          }
        : null,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Conversations could not be loaded")
  }
}
