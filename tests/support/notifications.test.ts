import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), rpc: vi.fn() }))
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return { ...actual, requireAuth: mocks.requireAuth }
})
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))

import { getMyNotifications, markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications"

const userId = "10000000-0000-4000-8000-000000000001"
const notificationId = "20000000-0000-4000-8000-000000000001"
const notification = {
  id: notificationId,
  type: "message" as const,
  title_ar: "رسالة جديدة",
  title_en: "New message",
  body_ar: "لديك رسالة",
  body_en: "You have a message",
  link: "/messages",
  read_at: null,
  created_at: "2026-09-08T00:00:00.000Z",
  unread_count: 3,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: userId }, supabase: {} })
})

describe("notification actions", () => {
  it("loads notifications and the database-wide unread count", async () => {
    mocks.rpc.mockResolvedValue({ data: [notification], error: null })
    const result = await getMyNotifications(30)
    expect(result).toMatchObject({ success: true, data: { unreadCount: 3, notifications: [{ id: notificationId }] } })
    if (result.success) expect(result.data.notifications[0]).not.toHaveProperty("unread_count")
    expect(mocks.rpc).toHaveBeenCalledWith("get_user_notification_page",{
      p_actor_id:userId,p_before_created_at:null,p_before_id:null,p_limit:30,
    })
  })

  it("passes a stable cursor and returns the next page boundary",async()=>{
    const rows=Array.from({length:2},(_,index)=>({...notification,id:`20000000-0000-4000-8000-00000000000${index+1}`,created_at:`2026-09-08T0${2-index}:00:00.000Z`}))
    mocks.rpc.mockResolvedValue({data:rows,error:null})
    const cursor={createdAt:"2026-09-09T00:00:00.000Z",id:"30000000-0000-4000-8000-000000000001"}
    const result=await getMyNotifications(2,cursor)
    expect(result).toMatchObject({success:true,data:{nextCursor:{createdAt:"2026-09-08T01:00:00.000Z",id:"20000000-0000-4000-8000-000000000002"}}})
    expect(mocks.rpc).toHaveBeenCalledWith("get_user_notification_page",{
      p_actor_id:userId,p_before_created_at:cursor.createdAt,p_before_id:cursor.id,p_limit:2,
    })
  })

  it("marks only the authenticated user's selected notification as read", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    await expect(markNotificationRead(notificationId)).resolves.toEqual({ success: true, data: undefined })
    expect(mocks.rpc).toHaveBeenCalledWith("mark_notification_read", {
      p_actor_id: userId,
      p_notification_id: notificationId,
    })
  })

  it("marks all notifications read and preserves failures", async () => {
    mocks.rpc.mockResolvedValue({ data: 3, error: null })
    await expect(markAllNotificationsRead()).resolves.toEqual({ success: true, data: { count: 3 } })
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") })
    await expect(markAllNotificationsRead()).resolves.toEqual({ success: false, error: "Notifications could not be marked as read" })
  })
})
