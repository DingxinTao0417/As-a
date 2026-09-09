import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { reconcileTapPaymentAttempt,type ReconciliationAttempt } from "@/lib/payment-reconciliation"

function authorized(request:Request,secret:string){
  const match=request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)
  const supplied=match?.[1]||""
  const actual=Buffer.from(supplied)
  const expected=Buffer.from(secret)
  return actual.length===expected.length&&timingSafeEqual(actual,expected)
}

export async function POST(request:Request){
  const secret=process.env.RECONCILIATION_JOB_SECRET
  if(!secret||secret.length<24)return NextResponse.json({error:"Reconciliation job is not configured"},{status:503})
  if(!authorized(request,secret))return NextResponse.json({error:"Unauthorized"},{status:401})
  if(process.env.TAP_PAYMENT_RECONCILIATION_ENABLED!=="true")return NextResponse.json({error:"Payment reconciliation is disabled"},{status:503})
  const configuredAge=Number.parseInt(process.env.PAYMENT_RECONCILIATION_MIN_AGE_MINUTES||"15",10)
  const minimumAgeMinutes=Number.isInteger(configuredAge)&&configuredAge>=5&&configuredAge<=1440?configuredAge:15
  const cutoff=new Date(Date.now()-minimumAgeMinutes*60_000).toISOString()
  const {data,error}=await createAdminClient().from("payment_attempts")
    .select("id, order_id, external_charge_id, amount, currency")
    .in("status",["creating","pending","unknown"])
    .not("external_charge_id","is",null)
    .lt("updated_at",cutoff)
    .order("updated_at",{ascending:true})
    .limit(25)
  if(error)return NextResponse.json({error:"Reconciliation queue could not be loaded"},{status:500})

  let processed=0
  let needsReview=0
  let failed=0
  for(const attempt of (data||[]) as ReconciliationAttempt[]){
    try{
      const result=await reconcileTapPaymentAttempt(attempt)
      if(result.success)processed+=1
      else needsReview+=1
    }catch{failed+=1}
  }
  return NextResponse.json({scanned:data?.length||0,processed,needsReview,failed,minimumAgeMinutes})
}
