"use server"

import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

export type AccountDeletionRequest = {
  id: string
  status: "requested" | "cancelled" | "processing" | "completed" | "failed"
  requested_at: string
  cancelled_at: string | null
  current_step: string | null
  last_error: string | null
}

function asDeletionRequest(value: unknown): AccountDeletionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const request = value as Record<string, unknown>
  if (typeof request.id !== "string" || typeof request.status !== "string"
      || typeof request.requested_at !== "string") return null
  return request as AccountDeletionRequest
}

function deletionFailure(error: unknown) {
  if (error instanceof AuthError) return fail(error.message)
  return fail("Account deletion request could not be processed")
}

export async function requestAccountDeletion() {
  try {
    const { user } = await requireAuth()
    const { data, error } = await createAdminClient().rpc("request_account_deletion", {
      p_actor_id: user.id,
    })
    const request = asDeletionRequest(data)
    return error || !request
      ? fail("Active orders, withdrawals, or unsettled balance prevent account deletion")
      : ok({ request })
  } catch (error) {
    return deletionFailure(error)
  }
}

export async function cancelAccountDeletionRequest() {
  try {
    const { user } = await requireAuth()
    const { data, error } = await createAdminClient().rpc("cancel_account_deletion", {
      p_actor_id: user.id,
    })
    const request = asDeletionRequest(data)
    return error || !request
      ? fail("This deletion request can no longer be cancelled")
      : ok({ request })
  } catch (error) {
    return deletionFailure(error)
  }
}

export async function getAccountDeletionStatus() {
  try {
    const { user } = await requireAuth()
    const { data, error } = await createAdminClient().rpc("get_account_deletion_status", {
      p_actor_id: user.id,
    })
    if (error) return fail("Deletion request status could not be loaded")
    return ok({ request: asDeletionRequest(data) })
  } catch (error) {
    return deletionFailure(error)
  }
}
