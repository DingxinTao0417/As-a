"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { createAdminClient } from "@/lib/supabase/admin"

const categories = ["all", "development", "design", "marketing", "writing", "video", "music", "business", "consulting"] as const
const sorts = ["newest", "rating", "price-low", "price-high"] as const
const catalogQuery = z.object({
  query: z.string().trim().max(100),
  category: z.enum(categories),
  sort: z.enum(sorts),
  page: z.number().int().min(1).max(100000),
  pageSize: z.number().int().min(1).max(50),
})
const providerServiceCursor=z.object({createdAt:z.string().datetime(),id:z.string().uuid()})
export type PublicProviderServiceCursor=z.infer<typeof providerServiceCursor>
export type PublicProviderService={
  id:string;name_ar:string;name_en:string;description_ar:string|null;description_en:string|null
  category:string;price:number;price_type:string;delivery_time:string|null;features:string[]
  image_urls:string[];created_at:string
}
export type PublicServiceDetail=PublicProviderService&{
  is_active:true;provider_id:string;providers:{
    id:string;name_ar:string;name_en:string;title_ar:string;title_en:string
    avatar_url:string|null;rating:number;reviews_count:number;completed_projects:number
    is_verified:boolean;bio_ar:string|null;bio_en:string|null;response_time:string|null
  }
}
export type RelatedPublicService={
  id:string;name_ar:string;name_en:string;category:string;price:number;price_type:string
  provider_id:string;created_at:string;providers:{
    name_ar:string;name_en:string;avatar_url:string|null;rating:number
  }
}
export type PublicProviderDetail={
  id:string;name_ar:string;name_en:string;title_ar:string;title_en:string
  bio_ar:string|null;bio_en:string|null;avatar_url:string|null;rating:number
  reviews_count:number;completed_projects:number;skills:string[];categories:string[]
  is_verified:boolean
}

type CatalogRow = {
  id: string
  name_ar: string
  name_en: string
  description_ar: string | null
  description_en: string | null
  category: string
  price: number
  price_type: string
  delivery_time: string | null
  features: string[]
  image_urls: string[]
  provider_id: string
  provider_name_ar: string
  provider_name_en: string
  provider_avatar_url: string | null
  provider_rating: number
  provider_reviews_count: number
  provider_is_verified: boolean
  created_at: string
  total_count: number
}

export type CatalogQuery = z.infer<typeof catalogQuery>

async function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Catalog query timed out")), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function getServiceCatalog(input: CatalogQuery) {
  const parsed = catalogQuery.safeParse(input)
  if (!parsed.success) return fail("Invalid catalog query")

  try {
    const value = parsed.data
    const { data, error } = await withTimeout(createAdminClient().rpc("search_service_catalog", {
      p_query: value.query || null,
      p_category: value.category === "all" ? null : value.category,
      p_sort: value.sort,
      p_offset: (value.page - 1) * value.pageSize,
      p_limit: value.pageSize,
    }), 8_000)
    if (error) return fail("Services could not be loaded")
    const rows = (data || []) as CatalogRow[]
    return ok({
      services: rows.map((row) => ({
        id: row.id,
        name_ar: row.name_ar,
        name_en: row.name_en,
        description_ar: row.description_ar,
        description_en: row.description_en,
        category: row.category,
        price: Number(row.price),
        price_type: row.price_type,
        delivery_time: row.delivery_time,
        features: row.features || [],
        image_urls: row.image_urls || [],
        is_active: true,
        provider_id: row.provider_id,
        providers: {
          id: row.provider_id,
          name_ar: row.provider_name_ar,
          name_en: row.provider_name_en,
          avatar_url: row.provider_avatar_url,
          rating: Number(row.provider_rating || 0),
          reviews_count: Number(row.provider_reviews_count || 0),
          is_verified: Boolean(row.provider_is_verified),
        },
      })),
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    })
  } catch {
    return fail("Services could not be loaded")
  }
}

export async function getPublicProviderServices(
  providerId:string,cursor:PublicProviderServiceCursor|null=null,pageSize=12,
){
  const parsedCursor=cursor?providerServiceCursor.safeParse(cursor):null
  if(!z.string().uuid().safeParse(providerId).success||!Number.isInteger(pageSize)||pageSize<1||pageSize>50
    ||(parsedCursor&&!parsedCursor.success))return fail("Invalid provider service page")
  try{
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await withTimeout(createAdminClient().rpc("get_public_provider_service_page",{
      p_provider_id:providerId,p_before_created_at:value?.createdAt||null,p_before_id:value?.id||null,p_limit:pageSize,
    }),8_000)
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Provider services could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.services))return fail("Provider services could not be loaded")
    const rows=snapshot.services as PublicProviderService[];const last=rows.at(-1)
    return ok({
      services:rows.map((service)=>({...service,price:Number(service.price),features:service.features||[],image_urls:service.image_urls||[]})),
      total:Number(snapshot.total||0),
      nextCursor:rows.length===pageSize&&last?{createdAt:last.created_at,id:last.id}:null,
    })
  }catch{
    return fail("Provider services could not be loaded")
  }
}

export async function getPublicServiceDetail(serviceId:string){
  if(!z.string().uuid().safeParse(serviceId).success)return fail("Invalid service")
  try{
    const {data,error}=await withTimeout(createAdminClient().rpc("get_public_service_detail",{
      p_service_id:serviceId,
    }),8_000)
    if(error)return fail("Service could not be loaded")
    if(data===null)return ok({service:null,relatedServices:[] as RelatedPublicService[]})
    if(!data||typeof data!=="object"||Array.isArray(data))return fail("Service could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!snapshot.service||typeof snapshot.service!=="object"||Array.isArray(snapshot.service)
      ||!Array.isArray(snapshot.related_services))return fail("Service could not be loaded")
    const service=snapshot.service as PublicServiceDetail
    const related=snapshot.related_services as RelatedPublicService[]
    return ok({
      service:{...service,price:Number(service.price),features:service.features||[],image_urls:service.image_urls||[],
        providers:{...service.providers,rating:Number(service.providers.rating),reviews_count:Number(service.providers.reviews_count),
          completed_projects:Number(service.providers.completed_projects)}},
      relatedServices:related.map((item)=>({...item,price:Number(item.price),providers:{...item.providers,rating:Number(item.providers.rating)}})),
    })
  }catch{
    return fail("Service could not be loaded")
  }
}

export async function getPublicProviderDetail(providerId:string){
  if(!z.string().uuid().safeParse(providerId).success)return fail("Invalid provider")
  try{
    const {data,error}=await withTimeout(createAdminClient().rpc("get_public_provider_detail",{
      p_provider_id:providerId,
    }),8_000)
    if(error)return fail("Provider could not be loaded")
    if(data===null)return ok({provider:null})
    if(!data||typeof data!=="object"||Array.isArray(data))return fail("Provider could not be loaded")
    const provider=data as PublicProviderDetail
    return ok({provider:{...provider,rating:Number(provider.rating),reviews_count:Number(provider.reviews_count),
      completed_projects:Number(provider.completed_projects),skills:provider.skills||[],categories:provider.categories||[]}})
  }catch{
    return fail("Provider could not be loaded")
  }
}
