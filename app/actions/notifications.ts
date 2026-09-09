"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const uuid = z.string().uuid()
const notificationCursor=z.object({createdAt:z.string().datetime(),id:uuid})

export type Notification = {
  id: string
  type: "message" | "order" | "withdrawal" | "support" | "refund" | "dispute"
  title_ar: string
  title_en: string
  body_ar: string
  body_en: string
  link: string | null
  read_at: string | null
  created_at: string
}

export async function getMyNotifications(limit = 30,cursor?:z.infer<typeof notificationCursor>|null) {
  try {
    const { user } = await requireAuth()
    const parsedCursor=cursor?notificationCursor.safeParse(cursor):null
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (parsedCursor&&!parsedCursor.success)) return fail("Invalid notification limit")
    const value=parsedCursor?.success?parsedCursor.data:null
    const { data, error } = await createAdminClient().rpc("get_user_notification_page", {
      p_actor_id: user.id,
      p_before_created_at:value?.createdAt||null,
      p_before_id:value?.id||null,
      p_limit: limit,
    })
    if (error) return fail("Notifications could not be loaded")
    const rows = (data || []) as Array<Notification & { unread_count: number | string }>
    return ok({
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title_ar: row.title_ar,
        title_en: row.title_en,
        body_ar: row.body_ar,
        body_en: row.body_en,
        link: row.link,
        read_at: row.read_at,
        created_at: row.created_at,
      })),
      unreadCount: rows.length > 0 ? Number(rows[0].unread_count) : 0,
      nextCursor:rows.length===limit?{createdAt:rows.at(-1)!.created_at,id:rows.at(-1)!.id}:null,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Notifications could not be loaded")
  }
}

export async function markNotificationRead(notificationId: string) {
  try {
    const { user } = await requireAuth()
    if (!uuid.safeParse(notificationId).success) return fail("Invalid notification")
    const { data, error } = await createAdminClient().rpc("mark_notification_read", {
      p_actor_id: user.id,
      p_notification_id: notificationId,
    })
    return error || !data ? fail("Notification could not be marked as read") : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Notification could not be marked as read")
  }
}

export async function markAllNotificationsRead() {
  try {
    const { user } = await requireAuth()
    const { data, error } = await createAdminClient().rpc("mark_all_notifications_read", {
      p_actor_id: user.id,
    })
    return error ? fail("Notifications could not be marked as read") : ok({ count: Number(data || 0) })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Notifications could not be marked as read")
  }
}
