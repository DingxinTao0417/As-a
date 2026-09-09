import type {User} from "@supabase/supabase-js"
import {createAdminClient} from "@/lib/supabase/admin"

export type PrivateFileReference={bucket:string;path:string}
type JsonRecord=Record<string,unknown>
type AdminClient=ReturnType<typeof createAdminClient>

function records(value:unknown):JsonRecord[]{
  return Array.isArray(value)
    ?value.filter((item):item is JsonRecord=>!!item&&typeof item==="object"&&!Array.isArray(item))
    :[]
}
function pathOf(value:unknown){return typeof value==="string"&&value.length>0?value:null}

export function collectPrivateFileReferences(snapshot:JsonRecord):PrivateFileReference[]{
  const byBucket=new Map<string,Set<string>>([
    ["order-deliveries",new Set()],
    ["dispute-evidence",new Set()],
    ["provider-verification",new Set()],
  ])
  for(const delivery of records(snapshot.order_deliveries)){
    for(const file of records(delivery.files)){const path=pathOf(file.path);if(path)byBucket.get("order-deliveries")!.add(path)}
  }
  for(const evidence of records(snapshot.dispute_evidence)){const path=pathOf(evidence.storage_path);if(path)byBucket.get("dispute-evidence")!.add(path)}
  for(const document of records(snapshot.provider_verification_documents)){const path=pathOf(document.storage_path);if(path)byBucket.get("provider-verification")!.add(path)}
  return [...byBucket].flatMap(([bucket,paths])=>[...paths].map((path)=>({bucket,path})))
}

export async function loadUserDataSnapshot(user:User,admin:AdminClient){
  const {data,error}=await admin.rpc("export_user_data_snapshot_v10",{p_actor_id:user.id})
  if(error||!data||typeof data!=="object"||Array.isArray(data))throw new Error("Data export could not be completed")
  return {snapshot:data as JsonRecord,privateFiles:collectPrivateFileReferences(data as JsonRecord)}
}

export function createUserDataEnvelope(
  user:User,snapshot:JsonRecord,extra:Record<string,unknown>={},
){
  return {
    format:"asaa-user-data",
    format_version:11,
    account:{
      id:user.id,email:user.email,phone:user.phone,created_at:user.created_at,
      last_sign_in_at:user.last_sign_in_at,user_metadata:user.user_metadata,app_metadata:user.app_metadata,
    },
    data:snapshot,
    ...extra,
    exported_at:new Date().toISOString(),
  }
}
