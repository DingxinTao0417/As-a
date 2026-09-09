"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAdmin, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const uuid = z.string().uuid()
const ticketInput = z.object({
  clientRequestId: uuid,
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(5000),
  language: z.enum(["ar", "en"]),
  orderId: uuid.nullish(),
})
const replyInput = z.object({
  ticketId: uuid,
  clientRequestId: uuid,
  body: z.string().trim().min(1).max(5000),
})
const ticketCursor=z.object({updatedAt:z.string().datetime(),id:uuid})
const messageCursor=z.object({createdAt:z.string().datetime(),id:uuid})

export type SupportTicket = {
  id: string
  requester_id: string
  order_id: string | null
  assigned_to: string | null
  subject: string
  description: string
  language: "ar" | "en"
  status: "open" | "in_progress" | "closed"
  created_at: string
  updated_at: string
  requester?: { full_name: string | null; email: string | null } | null
}

export type SupportTicketMessage = {
  id: string
  ticket_id: string
  sender_id: string
  body: string
  created_at: string
}

function supportFailure(error: unknown, fallback: string) {
  if (error instanceof AuthError) return fail(error.message)
  return fail(fallback)
}

export async function createSupportTicket(input: z.infer<typeof ticketInput>) {
  try {
    const { user } = await requireAuth()
    const parsed = ticketInput.safeParse(input)
    if (!parsed.success) return fail("Provide a subject and at least 10 characters of detail")
    const { data, error } = await createAdminClient().rpc("create_support_ticket", {
      p_actor_id: user.id,
      p_client_request_id: parsed.data.clientRequestId,
      p_subject: parsed.data.subject,
      p_description: parsed.data.description,
      p_language: parsed.data.language,
      p_order_id: parsed.data.orderId || null,
    })
    if (error || !data) return fail("Support ticket could not be created")
    revalidatePath("/support")
    revalidatePath("/admin/support")
    return ok({ ticket: data as SupportTicket })
  } catch (error) {
    return supportFailure(error, "Support ticket could not be created")
  }
}

async function getSupportTicketPage(adminView:boolean,cursor:z.infer<typeof ticketCursor>|null,limit:number) {
  try {
    const { user }=adminView?await requireAdmin():await requireAuth()
    const parsedCursor=cursor?ticketCursor.safeParse(cursor):null
    if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid support ticket page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_support_ticket_page",{
      p_actor_id:user.id,p_admin_view:adminView,p_before_updated_at:value?.updatedAt||null,p_before_id:value?.id||null,p_limit:limit,
    })
    if(error)return fail(adminView?"Support queue could not be loaded":"Support tickets could not be loaded")
    const rows=(data||[]) as Array<SupportTicket&{requester_name?:string|null;requester_email?:string|null;total_count:number|string}>
    const last=rows.at(-1)
    return ok({
      tickets:rows.map((row)=>{
        const ticket={...row} as Record<string,unknown>
        delete ticket.requester_name;delete ticket.requester_email;delete ticket.total_count
        return adminView
          ? {...ticket,requester:{full_name:row.requester_name||null,email:row.requester_email||null}}
          : ticket
      }),
      total:rows.length?Number(rows[0].total_count):0,
      nextCursor:rows.length===limit&&last?{updatedAt:last.updated_at,id:last.id}:null,
    })
  } catch (error) {
    return supportFailure(error,adminView?"Support queue could not be loaded":"Support tickets could not be loaded")
  }
}

export async function getMySupportTickets(cursor:z.infer<typeof ticketCursor>|null=null,limit=50) {
  return getSupportTicketPage(false,cursor,limit)
}

export async function getAdminSupportTickets(cursor:z.infer<typeof ticketCursor>|null=null,limit=50) {
  return getSupportTicketPage(true,cursor,limit)
}

export async function getSupportTicketMessages(ticketId:string,cursor:z.infer<typeof messageCursor>|null=null,limit=50) {
  try {
    const { user } = await requireAuth()
    const parsedCursor=cursor?messageCursor.safeParse(cursor):null
    if (!uuid.safeParse(ticketId).success||!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success)) return fail("Invalid support ticket")
    const value=parsedCursor?.success?parsedCursor.data:null
    const { data, error } = await createAdminClient().rpc("get_support_ticket_message_page", {
      p_actor_id: user.id,
      p_ticket_id: ticketId,
      p_before_created_at:value?.createdAt||null,
      p_before_id:value?.id||null,
      p_limit:limit,
    })
    if(error)return fail("Support replies could not be loaded")
    const descending=(data||[]) as Array<SupportTicketMessage&{total_count:number|string}>
    const oldest=descending.at(-1)
    return ok({
      messages:[...descending].reverse().map((row)=>{const message={...row} as Record<string,unknown>;delete message.total_count;return message}),
      total:descending.length?Number(descending[0].total_count):0,
      nextCursor:descending.length===limit&&oldest?{createdAt:oldest.created_at,id:oldest.id}:null,
    })
  } catch (error) {
    return supportFailure(error, "Support replies could not be loaded")
  }
}

export async function replySupportTicket(input: z.infer<typeof replyInput>) {
  try {
    const { user } = await requireAuth()
    const parsed = replyInput.safeParse(input)
    if (!parsed.success) return fail("Enter a valid support reply")
    const { data, error } = await createAdminClient().rpc("reply_support_ticket", {
      p_actor_id: user.id,
      p_ticket_id: parsed.data.ticketId,
      p_client_request_id: parsed.data.clientRequestId,
      p_body: parsed.data.body,
    })
    if (error || !data) return fail("Support reply could not be sent")
    revalidatePath("/support")
    revalidatePath("/admin/support")
    return ok({ message: data as SupportTicketMessage })
  } catch (error) {
    return supportFailure(error, "Support reply could not be sent")
  }
}

export async function setSupportTicketStatus(
  ticketId: string,
  status: "open" | "in_progress" | "closed",
  reason: string,
) {
  try {
    const { user } = await requireAdmin()
    if (!uuid.safeParse(ticketId).success || !["open", "in_progress", "closed"].includes(status)
        || reason.trim().length < 3 || reason.trim().length > 1000) {
      return fail("Enter a valid status and reason")
    }
    const { data, error } = await createAdminClient().rpc("set_support_ticket_status", {
      p_actor_id: user.id,
      p_ticket_id: ticketId,
      p_status: status,
      p_reason: reason.trim(),
    })
    if (error || !data) return fail("Support status could not be saved")
    revalidatePath("/support")
    revalidatePath("/admin/support")
    revalidatePath("/admin/audit")
    return ok({ status: data as string })
  } catch (error) {
    return supportFailure(error, "Support status could not be saved")
  }
}
