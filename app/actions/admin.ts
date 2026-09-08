"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { AuthError, requireAdmin } from "@/lib/auth"
import { fail, ok, type ActionResult } from "@/lib/action-result"
import { createAdminClient } from "@/lib/supabase/admin"

const idSchema = z.string().uuid()

function actionFailure(error: unknown): ActionResult<void> {
  if (error instanceof AuthError) return fail(error.message)
  console.error(JSON.stringify({ event: "admin.action_failed", type: error instanceof Error ? error.name : "UnknownError" }))
  return fail("The change could not be saved. Please try again.")
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<ActionResult<void>> {
  try {
    const { user } = await requireAdmin()
    if (!idSchema.safeParse(userId).success || typeof isAdmin !== "boolean") return fail("Invalid user")
    if (user.id === userId) return fail("You cannot change your own administrator access")
    const admin = createAdminClient()
    const { error } = await admin.rpc("apply_admin_action", {
      p_actor_id: user.id, p_action: "set_admin", p_target_id: userId, p_value: String(isAdmin),
    })
    if (error) throw error
    console.info(JSON.stringify({ event: "admin.access_changed", actor: user.id, target: userId, isAdmin }))
    revalidatePath("/admin/orders")
    return ok(undefined)
  } catch (error) { return actionFailure(error) }
}

export async function reviewWithdrawal(withdrawalId: string, status: "completed" | "rejected", note?: string): Promise<ActionResult<void>> {
  try {
    const { user } = await requireAdmin()
    if (!idSchema.safeParse(withdrawalId).success || !["completed", "rejected"].includes(status)) return fail("Invalid withdrawal")
    if (typeof note !== "string" || note.trim().length < 3 || note.length > 1000) {
      return fail("Enter a transfer reference or a rejection reason (3–1,000 characters)")
    }
    // This records a manually verified transfer. It does not initiate or claim to initiate a payout.
    const admin = createAdminClient()
    const { error } = await admin.rpc("apply_admin_action", {
      p_actor_id: user.id, p_action: "review_withdrawal", p_target_id: withdrawalId,
      p_value: status, p_note: note.trim(),
    })
    if (error) throw error
    console.info(JSON.stringify({ event: "admin.withdrawal_reviewed", actor: user.id, target: withdrawalId, status }))
    revalidatePath("/admin/withdrawals")
    revalidatePath("/dashboard")
    return ok(undefined)
  } catch (error) { return actionFailure(error) }
}

export async function verifyProvider(providerId: string, verified: boolean): Promise<ActionResult<void>> {
  try {
    const { user } = await requireAdmin()
    if (!idSchema.safeParse(providerId).success || typeof verified !== "boolean") return fail("Invalid provider")
    const { error } = await createAdminClient().rpc("apply_admin_action", {
      p_actor_id: user.id, p_action: "verify_provider", p_target_id: providerId, p_value: String(verified),
    })
    if (error) throw error
    console.info(JSON.stringify({ event: "admin.provider_verified", actor: user.id, target: providerId, verified }))
    revalidatePath("/admin/providers")
    return ok(undefined)
  } catch (error) { return actionFailure(error) }
}

export async function setServiceActive(serviceId: string, active: boolean): Promise<ActionResult<void>> {
  try {
    const { user } = await requireAdmin()
    if (!idSchema.safeParse(serviceId).success || typeof active !== "boolean") return fail("Invalid service")
    const { error } = await createAdminClient().rpc("apply_admin_action", {
      p_actor_id: user.id, p_action: "set_service_active", p_target_id: serviceId, p_value: String(active),
    })
    if (error) throw error
    console.info(JSON.stringify({ event: "admin.service_reviewed", actor: user.id, target: serviceId, active }))
    revalidatePath("/admin/services")
    revalidatePath(`/services/${serviceId}`)
    return ok(undefined)
  } catch (error) { return actionFailure(error) }
}
