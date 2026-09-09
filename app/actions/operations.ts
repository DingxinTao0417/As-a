"use server"

import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAdmin, requireProvider } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { z } from "zod"

function pageValid(page: number, pageSize: number) {
  return Number.isInteger(page) && page>=1 && Number.isInteger(pageSize) && pageSize>=1 && pageSize<=100
}
const ledgerCursor=z.object({createdAt:z.string().datetime(),id:z.string().uuid()})
const adminProviderCursor=z.object({createdAt:z.string().datetime(),id:z.string().uuid()})
const adminProviderFilter=z.enum(["all","verified","unverified"])
const adminServiceCursor=z.object({createdAt:z.string().datetime(),id:z.string().uuid()})
const adminServiceFilter=z.enum(["all","draft","pending_review","approved","rejected","suspended"])

export type AdminProviderFilter=z.infer<typeof adminProviderFilter>
export type AdminProviderCursor=z.infer<typeof adminProviderCursor>
export type AdminProviderRow={
  id:string;name_ar:string;name_en:string;title_ar:string|null;title_en:string|null
  bio_ar:string|null;bio_en:string|null;category:string;skills:string[];rating:number
  reviews_count:number;completed_projects:number;is_verified:boolean;is_active:boolean
  avatar_url:string|null;portfolio_urls:string[];tap_account_status:string|null
  tap_charges_enabled:boolean;tap_payouts_enabled:boolean;tap_status_checked_at:string|null
  tap_status_source:string|null;created_at:string
}
export type AdminServiceFilter=z.infer<typeof adminServiceFilter>
export type AdminServiceCursor=z.infer<typeof adminServiceCursor>
export type AdminServiceRow={
  id:string;name_ar:string;name_en:string;description_ar:string|null;description_en:string|null
  category:string;price:number;price_type:string;delivery_time:string|null;is_active:boolean
  moderation_status:"draft"|"pending_review"|"approved"|"rejected"|"suspended"
  moderation_note:string|null;image_urls:string[];features:string[];created_at:string
  providers:{name_ar:string;name_en:string;avatar_url:string|null}|null
}

export async function getProviderLedgerPage(cursor:z.infer<typeof ledgerCursor>|null=null,pageSize=50){
  try{
    const {user,provider}=await requireProvider()
    const parsedCursor=cursor?ledgerCursor.safeParse(cursor):null
    if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid ledger page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_provider_ledger_page",{
      p_actor_id:user.id,p_provider_id:provider.id,p_before_created_at:value?.createdAt||null,p_before_id:value?.id||null,p_limit:pageSize,
    })
    if(error)return fail("Ledger entries could not be loaded")
    const rows=(data||[]) as Array<Record<string,unknown>>
    const last=rows.at(-1)
    return ok({
      entries:rows.map((row)=>{const entry={...row};delete entry.total_count;return entry}),
      total:rows.length?Number(rows[0].total_count):0,
      nextCursor:rows.length===pageSize&&last?{createdAt:String(last.created_at),id:String(last.id)}:null,
    })
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Ledger entries could not be loaded")
  }
}

export async function getProviderDashboardSnapshot(page=1,pageSize=50) {
  try {
    const { user,provider }=await requireProvider()
    if (!pageValid(page,pageSize)) return fail("Invalid dashboard page")
    const { data,error }=await createAdminClient().rpc("get_provider_dashboard_snapshot",{
      p_actor_id:user.id,p_provider_id:provider.id,p_offset:(page-1)*pageSize,p_limit:pageSize,
    })
    if (error||!data||typeof data!=="object") return fail("Provider dashboard could not be loaded")
    const snapshot=data as Record<string,unknown>
    if (!snapshot.stats||typeof snapshot.stats!=="object"||!Array.isArray(snapshot.orders)) return fail("Provider dashboard could not be loaded")
    const stats=snapshot.stats as Record<string,unknown>
    return ok({
      stats:{
        activeOrders:Number(stats.active_orders||0),awaitingDelivery:Number(stats.awaiting_delivery||0),
        awaitingConfirmation:Number(stats.awaiting_confirmation||0),completedOrders:Number(stats.completed_orders||0),
        pendingEarnings:Number(stats.pending_earnings||0),grossCompleted:Number(stats.gross_completed||0),
        refundedAmount:Number(stats.refunded_amount||0),openRefunds:Number(stats.open_refunds||0),
        openDisputes:Number(stats.open_disputes||0),availableBalance:Number(stats.available_balance||0),
        reservedBalance:Number(stats.reserved_balance||0),paidBalance:Number(stats.paid_balance||0),
        totalEarned:Number(stats.total_earned||0),
      },
      orders:(snapshot.orders as Array<Record<string,unknown>>).map((order)=>({
        ...order,
        seeker:{ full_name:String(order.seeker_name||"Unknown"),email:"" },
      })),
      total:Number(snapshot.total_orders||0),page,pageSize,
    })
  } catch(error) {
    if(error instanceof AuthError)return fail(error.message)
    return fail("Provider dashboard could not be loaded")
  }
}

export async function getAdminOperationsSummary() {
  try {
    const { user }=await requireAdmin()
    const { data,error }=await createAdminClient().rpc("get_admin_operations_summary",{p_actor_id:user.id})
    return error||!data||typeof data!=="object"?fail("Operations summary could not be loaded"):ok({summary:data as Record<string,number|string>})
  } catch(error) {
    if(error instanceof AuthError)return fail(error.message)
    return fail("Operations summary could not be loaded")
  }
}

export async function getAdminProviderPage(
  query="",filter:AdminProviderFilter="unverified",cursor:AdminProviderCursor|null=null,pageSize=50,
){
  try{
    const {user}=await requireAdmin()
    const parsedCursor=cursor?adminProviderCursor.safeParse(cursor):null
    if(query.length>100||!adminProviderFilter.safeParse(filter).success
      ||!Number.isInteger(pageSize)||pageSize<1||pageSize>100||(parsedCursor&&!parsedCursor.success)){
      return fail("Invalid provider page")
    }
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_admin_provider_page",{
      p_actor_id:user.id,p_query:query.trim()||null,p_filter:filter,
      p_before_created_at:value?.createdAt||null,p_before_id:value?.id||null,p_limit:pageSize,
    })
    if(error)return fail("Admin providers could not be loaded")
    const rows=(data||[]) as Array<AdminProviderRow&{total_count:number|string}>
    const last=rows.at(-1)
    return ok({
      providers:rows.map((row)=>({
        id:row.id,name_ar:row.name_ar,name_en:row.name_en,title_ar:row.title_ar,title_en:row.title_en,
        bio_ar:row.bio_ar,bio_en:row.bio_en,category:row.category,skills:row.skills||[],
        rating:Number(row.rating),reviews_count:Number(row.reviews_count),completed_projects:Number(row.completed_projects),
        is_verified:row.is_verified,is_active:row.is_active,avatar_url:row.avatar_url,
        portfolio_urls:row.portfolio_urls||[],tap_account_status:row.tap_account_status,
        tap_charges_enabled:Boolean(row.tap_charges_enabled),tap_payouts_enabled:Boolean(row.tap_payouts_enabled),
        tap_status_checked_at:row.tap_status_checked_at,tap_status_source:row.tap_status_source,created_at:row.created_at,
      })),
      total:rows.length?Number(rows[0].total_count):0,
      nextCursor:rows.length===pageSize&&last?{createdAt:last.created_at,id:last.id}:null,
    })
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Admin providers could not be loaded")
  }
}

export async function getAdminServicePage(
  query="",filter:AdminServiceFilter="pending_review",cursor:AdminServiceCursor|null=null,pageSize=50,
){
  try{
    const {user}=await requireAdmin()
    const parsedCursor=cursor?adminServiceCursor.safeParse(cursor):null
    if(query.length>100||!adminServiceFilter.safeParse(filter).success
      ||!Number.isInteger(pageSize)||pageSize<1||pageSize>100||(parsedCursor&&!parsedCursor.success)){
      return fail("Invalid service page")
    }
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_admin_service_page",{
      p_actor_id:user.id,p_query:query.trim()||null,p_status:filter,
      p_before_created_at:value?.createdAt||null,p_before_id:value?.id||null,p_limit:pageSize,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Admin services could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.services))return fail("Admin services could not be loaded")
    const rows=snapshot.services as AdminServiceRow[];const last=rows.at(-1)
    return ok({
      services:rows.map((row)=>({...row,price:Number(row.price),image_urls:row.image_urls||[],features:row.features||[]})),
      total:Number(snapshot.total||0),pendingCount:Number(snapshot.pending_count||0),
      nextCursor:rows.length===pageSize&&last?{createdAt:last.created_at,id:last.id}:null,
    })
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Admin services could not be loaded")
  }
}

export async function getAdminOrderPage(page=1,pageSize=50,query="",status="all") {
  try {
    const { user }=await requireAdmin()
    if(!pageValid(page,pageSize)||query.length>100)return fail("Invalid order page")
    const { data,error }=await createAdminClient().rpc("get_admin_order_page",{
      p_actor_id:user.id,p_query:query.trim()||null,p_status:status==="all"?null:status,
      p_offset:(page-1)*pageSize,p_limit:pageSize,
    })
    if(error)return fail("Admin orders could not be loaded")
    const rows=(data||[]) as Array<Record<string,unknown>>
    return ok({orders:rows.map((row)=>{const value={...row};delete value.total_count;return value}),total:rows.length?Number(rows[0].total_count):0,page,pageSize})
  } catch(error) {
    if(error instanceof AuthError)return fail(error.message)
    return fail("Admin orders could not be loaded")
  }
}

export async function getAdminUserPage(page=1,pageSize=50,query="") {
  try {
    const { user }=await requireAdmin()
    if(!pageValid(page,pageSize)||query.length>100)return fail("Invalid user page")
    const { data,error }=await createAdminClient().rpc("get_admin_user_page",{
      p_actor_id:user.id,p_query:query.trim()||null,p_offset:(page-1)*pageSize,p_limit:pageSize,
    })
    if(error)return fail("Admin users could not be loaded")
    const rows=(data||[]) as Array<Record<string,unknown>>
    return ok({users:rows.map((row)=>{const value={...row};delete value.total_count;return value}),total:rows.length?Number(rows[0].total_count):0,page,pageSize})
  } catch(error) {
    if(error instanceof AuthError)return fail(error.message)
    return fail("Admin users could not be loaded")
  }
}

export async function exportAdminOrderReport(query="",status="all") {
  try {
    const { user }=await requireAdmin()
    if(query.length>100)return fail("Invalid report query")
    const { data,error }=await createAdminClient().rpc("export_admin_order_report",{
      p_actor_id:user.id,p_query:query.trim()||null,p_status:status==="all"?null:status,p_max_rows:5000,
    })
    return error||!data||typeof data!=="object"
      ?fail("Order report could not be generated or exceeds 5,000 rows")
      :ok({report:data as {generated_at:string;row_count:number;orders:Array<Record<string,unknown>>}})
  } catch(error) {
    if(error instanceof AuthError)return fail(error.message)
    return fail("Order report could not be generated")
  }
}
