"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireProvider } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const categories = ["development", "design", "marketing", "writing", "video", "music", "business", "consulting"] as const
const priceTypes = ["fixed", "hourly", "starting_from"] as const
const imageUrl = z.string().trim().min(1).max(2048).refine((value) => {
  if (value.startsWith("/")) return true
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://invalid.local")
    const parsed = new URL(value)
    const localHttp = configured.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)
    return (configured.protocol === "https:" || localHttp)
      && parsed.origin === configured.origin
      && parsed.pathname.startsWith("/storage/v1/object/public/service-images/")
  } catch {
    return false
  }
})
const serviceInput = z.object({
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  descriptionAr: z.string().trim().max(5000).optional(),
  descriptionEn: z.string().trim().max(5000).optional(),
  category: z.enum(categories),
  price: z.number().finite().min(1).max(1000000),
  priceType: z.enum(priceTypes),
  deliveryTime: z.string().trim().max(160).optional(),
  features: z.array(z.string().trim().min(1).max(200)).max(30),
  imageUrls: z.array(imageUrl).max(10).optional(),
})
const cleanupInput=z.object({
  serviceId:z.string().uuid(),
  paths:z.array(z.string().min(1).max(500)).min(1).max(20),
})
const serviceSort=z.enum(["created_at","price","name"])
const serviceDirection=z.enum(["asc","desc"])
const serviceLanguage=z.enum(["ar","en"])
const serviceCursor=z.discriminatedUnion("sort",[
  z.object({sort:z.literal("created_at"),direction:serviceDirection,language:serviceLanguage,id:z.string().uuid(),createdAt:z.string().datetime()}),
  z.object({sort:z.literal("price"),direction:serviceDirection,language:serviceLanguage,id:z.string().uuid(),price:z.number().finite()}),
  z.object({sort:z.literal("name"),direction:serviceDirection,language:serviceLanguage,id:z.string().uuid(),name:z.string()}),
])

export type ServiceInput = z.infer<typeof serviceInput>
export type ProviderServiceSort=z.infer<typeof serviceSort>
export type ProviderServiceDirection=z.infer<typeof serviceDirection>
export type ProviderServiceLanguage=z.infer<typeof serviceLanguage>
export type ProviderServiceCursor=z.infer<typeof serviceCursor>
export type ProviderServiceRow={
  id:string;name_ar:string;name_en:string;description_ar:string|null;description_en:string|null
  category:string;price:number;price_type:string;delivery_time:string|null;features:string[];image_urls:string[]
  is_active:boolean;moderation_status:"draft"|"pending_review"|"approved"|"rejected"|"suspended"
  moderation_note:string|null;provider_publish_intent:boolean;created_at:string
}
export type ServiceImageCleanupItem={id:string;service_id:string;storage_path:string;attempt_count:number;created_at:string}

function validInput(input: ServiceInput) {
  const parsed = serviceInput.safeParse(input)
  if (!parsed.success || Math.round(parsed.data.price * 100) / 100 !== parsed.data.price) return null
  return parsed.data
}

function rpcPayload(input: ServiceInput) {
  return {
    p_name_ar: input.nameAr,
    p_name_en: input.nameEn,
    p_description_ar: input.descriptionAr || "",
    p_description_en: input.descriptionEn || "",
    p_category: input.category,
    p_price: input.price,
    p_price_type: input.priceType,
    p_delivery_time: input.deliveryTime || "",
    p_features: input.features,
  }
}

export async function getProviderServicePage(
  query="",sort:ProviderServiceSort="created_at",direction:ProviderServiceDirection="desc",
  language:ProviderServiceLanguage="en",cursor:ProviderServiceCursor|null=null,limit=12,
){
  try{
    const {user,provider}=await requireProvider()
    const parsedCursor=cursor?serviceCursor.safeParse(cursor):null
    if(query.length>100||!serviceSort.safeParse(sort).success||!serviceDirection.safeParse(direction).success
      ||!serviceLanguage.safeParse(language).success||!Number.isInteger(limit)||limit<1||limit>100
      ||(parsedCursor&&!parsedCursor.success)
      ||(parsedCursor?.success&&(parsedCursor.data.sort!==sort||parsedCursor.data.direction!==direction||parsedCursor.data.language!==language))){
      return fail("Invalid provider service page")
    }
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_provider_service_page",{
      p_actor_id:user.id,p_provider_id:provider.id,p_query:query.trim()||null,p_sort:sort,
      p_direction:direction,p_language:language,
      p_cursor_created_at:value?.sort==="created_at"?value.createdAt:null,
      p_cursor_price:value?.sort==="price"?value.price:null,
      p_cursor_name:value?.sort==="name"?value.name:null,p_cursor_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Services could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.services))return fail("Services could not be loaded")
    const rows=snapshot.services as Array<ProviderServiceRow&{sort_name?:string}>
    const last=rows.at(-1)
    const services=rows.map((row)=>{const item={...row};delete item.sort_name;return{
      ...item,price:Number(item.price),features:item.features||[],image_urls:item.image_urls||[],
    }})
    let nextCursor:ProviderServiceCursor|null=null
    if(rows.length===limit&&last){
      if(sort==="created_at")nextCursor={sort,direction,language,id:last.id,createdAt:last.created_at}
      else if(sort==="price")nextCursor={sort,direction,language,id:last.id,price:Number(last.price)}
      else nextCursor={sort,direction,language,id:last.id,name:String(last.sort_name||"")}
    }
    return ok({services,total:Number(snapshot.total||0),nextCursor})
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Services could not be loaded")
  }
}

export async function createServiceDraft(input: ServiceInput) {
  try {
    const { user } = await requireProvider()
    const parsed = validInput(input)
    if (!parsed) return fail("Provide valid service details and a price with at most two decimal places")
    const { data: serviceId, error } = await createAdminClient().rpc("create_service_draft", {
      p_actor_id: user.id,
      ...rpcPayload(parsed),
    })
    return error || !serviceId
      ? fail("Service draft could not be created")
      : ok({ serviceId: serviceId as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Service draft could not be created")
  }
}

export async function updateServiceDraft(serviceId: string,input: ServiceInput) {
  try {
    const { user } = await requireProvider()
    const parsed = validInput(input)
    if (!z.string().uuid().safeParse(serviceId).success || !parsed) {
      return fail("Provide valid service details and images")
    }
    const { error } = await createAdminClient().rpc("update_service_draft", {
      p_actor_id: user.id,
      p_service_id: serviceId,
      ...rpcPayload(parsed),
      p_image_urls: parsed.imageUrls || [],
    })
    return error ? fail("Service draft could not be saved") : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Service draft could not be saved")
  }
}

export async function submitServiceForReview(serviceId: string) {
  try {
    const { user } = await requireProvider()
    if (!z.string().uuid().safeParse(serviceId).success) return fail("Invalid service")
    const { error } = await createAdminClient().rpc("submit_service_for_review", {
      p_actor_id: user.id,
      p_service_id: serviceId,
    })
    return error ? fail("Service could not be submitted for review") : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Service could not be submitted for review")
  }
}

export async function setServicePublishIntent(serviceId: string,publish: boolean) {
  try {
    const { user } = await requireProvider()
    if (!z.string().uuid().safeParse(serviceId).success) return fail("Invalid service")
    const { error } = await createAdminClient().rpc("set_service_publish_intent", {
      p_actor_id: user.id,
      p_service_id: serviceId,
      p_publish: publish,
    })
    return error ? fail("Service publication status could not be saved") : ok(undefined)
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Service publication status could not be saved")
  }
}

export async function deleteService(serviceId: string) {
  try {
    const { user } = await requireProvider()
    if (!z.string().uuid().safeParse(serviceId).success) return fail("Invalid service")
    const { data: imageUrls, error } = await createAdminClient().rpc("delete_service", {
      p_actor_id: user.id,
      p_service_id: serviceId,
    })
    return error
      ? fail("Services with existing orders cannot be deleted")
      : ok({ imageUrls: (imageUrls || []) as string[] })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Service could not be deleted")
  }
}

function validCleanupPaths(providerId:string,serviceId:string,paths:string[]){
  const prefix=`${providerId}/${serviceId}/`
  return paths.length===new Set(paths).size&&paths.every((path)=>{
    const parts=path.split("/")
    return parts.length===3&&path.startsWith(prefix)&&!path.includes("..")&&/^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(parts[2])
  })
}

export async function queueServiceImageCleanup(serviceId:string,paths:string[]){
  try{
    const {user,provider}=await requireProvider()
    const parsed=cleanupInput.safeParse({serviceId,paths})
    if(!parsed.success||!validCleanupPaths(provider.id,serviceId,parsed.data.paths))return fail("Invalid image cleanup request")
    const {data,error}=await createAdminClient().rpc("queue_service_image_cleanup",{
      p_actor_id:user.id,p_provider_id:provider.id,p_service_id:serviceId,p_paths:parsed.data.paths,
    })
    return error||typeof data!=="number"?fail("Image cleanup could not be queued"):ok({queued:data})
  }catch(error){if(error instanceof AuthError)return fail(error.message);return fail("Image cleanup could not be queued")}
}

export async function getServiceImageCleanupJobs(limit=100){
  try{
    const {user}=await requireProvider()
    if(!Number.isInteger(limit)||limit<1||limit>100)return fail("Invalid cleanup page")
    const {data,error}=await createAdminClient().rpc("get_service_image_cleanup_page",{p_actor_id:user.id,p_limit:limit})
    if(error)return fail("Image cleanup queue could not be loaded")
    const rows=(data||[]) as Array<ServiceImageCleanupItem&{total_count:number|string}>
    return ok({
      jobs:rows.map((row)=>({id:row.id,service_id:row.service_id,storage_path:row.storage_path,attempt_count:Number(row.attempt_count),created_at:row.created_at})),
      total:rows.length?Number(rows[0].total_count):0,
    })
  }catch(error){if(error instanceof AuthError)return fail(error.message);return fail("Image cleanup queue could not be loaded")}
}

export async function retryServiceImageCleanupJobs(){
  try{
    const {user}=await requireProvider()
    const admin=createAdminClient()
    const {data,error}=await admin.rpc("get_service_image_cleanup_page",{p_actor_id:user.id,p_limit:100})
    if(error)return fail("Image cleanup queue could not be loaded")
    const rows=(data||[]) as Array<ServiceImageCleanupItem&{total_count:number|string}>
    if(rows.length===0)return ok({completed:0,remaining:0})
    const jobIds=rows.map((row)=>row.id)
    const {error:removeError}=await admin.storage.from("service-images").remove(rows.map((row)=>row.storage_path))
    if(removeError){
      await admin.rpc("record_service_image_cleanup_result",{
        p_actor_id:user.id,p_job_ids:jobIds,p_succeeded:false,p_error:"Storage deletion failed",
      })
      return fail("Some image files could not be cleaned up")
    }
    const {error:recordError}=await admin.rpc("record_service_image_cleanup_result",{
      p_actor_id:user.id,p_job_ids:jobIds,p_succeeded:true,p_error:null,
    })
    if(recordError)return fail("Image cleanup result could not be saved")
    return ok({completed:rows.length,remaining:Math.max(0,Number(rows[0].total_count)-rows.length)})
  }catch(error){if(error instanceof AuthError)return fail(error.message);return fail("Some image files could not be cleaned up")}
}
