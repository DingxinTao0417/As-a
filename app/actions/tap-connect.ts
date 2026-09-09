"use server"

import { requireProvider, AuthError } from "@/lib/auth"
import { fail, ok, type ActionResult } from "@/lib/action-result"
import { createAdminClient } from "@/lib/supabase/admin"
import { z } from "zod"
import { retrieveTapDestination,tapDestinationCapabilities } from "@/lib/tap"

const withdrawalCursor=z.object({requestedAt:z.string().datetime(),id:z.string().uuid()})
export type ProviderWithdrawalCursor=z.infer<typeof withdrawalCursor>
export type ProviderWithdrawalRow={
  id:string;amount:number;status:string;requested_at:string;processed_at:string|null;notes:string|null
  payout_method:string|null;external_reference:string|null;failure_reason:string|null
  payout_attempts:Array<Record<string,unknown>>
}

async function syncTapDestinationStatus(userId:string,provider:{id:string;tap_destination_id?:string|null}){
  if(process.env.TAP_MARKETPLACE_ENABLED!=="true")return fail("Tap Marketplace status verification is not enabled")
  const destinationId=provider.tap_destination_id
  if(!destinationId||destinationId.startsWith("tap_placeholder_"))return ok({
    status:"not_connected",chargesEnabled:false,payoutsEnabled:false,
  })
  try{
    const destination=await retrieveTapDestination(destinationId)
    if(String(destination.id)!==destinationId)return fail("Tap returned a different destination")
    const capabilities=tapDestinationCapabilities(destination)
    const {data,error}=await createAdminClient().rpc("sync_provider_tap_destination_status",{
      p_actor_id:userId,p_provider_id:provider.id,p_destination_id:destinationId,
      p_external_status:capabilities.status,p_charges_enabled:capabilities.chargesEnabled,
      p_payouts_enabled:capabilities.payoutsEnabled,
    })
    return error||!data?fail("Tap account status could not be saved"):ok(capabilities)
  }catch{
    return fail("Tap account status could not be verified")
  }
}

export async function createConnectAccount(): Promise<ActionResult<{ accountId: string; destinationId: string }>> {
  try {
    await requireProvider()
    return fail("Tap provider onboarding is not configured yet")
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to initialize payment account")
  }
}

export async function createAccountLink(): Promise<ActionResult<{ url: string }>> {
  try {
    await requireProvider()
    return fail("Tap provider onboarding is not configured yet")
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to create payment setup link")
  }
}

export async function checkAccountStatus() {
  try {
    const {user,provider}=await requireProvider()
    const result=await syncTapDestinationStatus(user.id,provider)
    return result.success?ok({isComplete:result.data.payoutsEnabled,...result.data}):result
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to check payment account status")
  }
}

export async function getProviderBalance() {
  try {
    const { user, provider } = await requireProvider()
    const { data, error } = await createAdminClient().rpc("get_provider_balance", {
      p_provider_id: provider.id,
      p_actor_id: user.id,
    })
    if (error || !data || typeof data !== "object") return fail("Balance could not be loaded")
    const balance = data as Record<string, unknown>
    const available = Number(balance.available)
    const reserved = Number(balance.reserved)
    const paid = Number(balance.paid)
    const totalEarned = Number(balance.total_earned)
    if (![available, reserved, paid, totalEarned].every(Number.isFinite)) {
      return fail("Balance could not be loaded")
    }
    return ok({ available, reserved, paid, totalEarned })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Balance could not be loaded")
  }
}

export async function getProviderWithdrawals(cursor:ProviderWithdrawalCursor|null=null,limit=50) {
  try {
    const {user,provider} = await requireProvider()
    const parsedCursor=cursor?withdrawalCursor.safeParse(cursor):null
    if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid withdrawal history page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_provider_withdrawal_page",{
      p_actor_id:user.id,p_provider_id:provider.id,p_before_requested_at:value?.requestedAt||null,
      p_before_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Withdrawal history could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.withdrawals))return fail("Withdrawal history could not be loaded")
    const rows=snapshot.withdrawals as ProviderWithdrawalRow[]
    const last=rows.at(-1)
    return ok({
      withdrawals:rows.map((row)=>({...row,amount:Number(row.amount),payout_attempts:Array.isArray(row.payout_attempts)?row.payout_attempts:[]})),
      total:Number(snapshot.total||0),
      nextCursor:rows.length===limit&&last?{requestedAt:last.requested_at,id:last.id}:null,
    })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Withdrawal history could not be loaded")
  }
}

export async function createPayout(amount: number) {
  try {
    const { user, provider } = await requireProvider()

    if (!Number.isFinite(amount) || amount < 1 || Math.round(amount * 100) / 100 !== amount) {
      return fail("Invalid withdrawal amount")
    }
    const status=await syncTapDestinationStatus(user.id,provider)
    if(!status.success)return status
    if(!status.data.payoutsEnabled)return fail("Tap payouts are not enabled for this provider")
    const { data: requestId, error } = await createAdminClient().rpc("request_provider_withdrawal", {
      p_provider_id: provider.id,
      p_actor_id: user.id,
      p_amount: amount,
    })
    return error || !requestId
      ? fail("Withdrawal request could not be submitted")
      : ok({ requestId: requestId as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Failed to create payout")
  }
}
