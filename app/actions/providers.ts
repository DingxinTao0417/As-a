"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const trimmedText = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().trim().max(max).optional()
const optionalImageUrl = z.string().trim().max(2048).refine((value) => {
  if (!value || value.startsWith("/")) return true
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}, "Invalid image URL").optional()
const providerProfileSchema = z.object({
  nameAr: trimmedText(100),
  nameEn: trimmedText(100),
  titleAr: trimmedText(160),
  titleEn: trimmedText(160),
  bioAr: optionalText(5000),
  bioEn: optionalText(5000),
  startingPrice: z.number().finite().min(0).max(10000),
  skills: z.array(trimmedText(80)).min(1).max(30),
  categories: z.array(trimmedText(80)).min(1).max(10),
  avatarUrl: optionalImageUrl,
})

export type ProviderProfileInput = z.infer<typeof providerProfileSchema>

export type CurrentProviderContext={
  role:string
  provider:{
    id:string
    tap_destination_id:string|null
    tap_account_status:string|null
    tap_onboarding_completed:boolean
  }|null
}

export async function getCurrentProviderContext(){
  try{
    const {user}=await requireAuth()
    const admin=createAdminClient()
    const [profileResult,providerResult]=await Promise.all([
      admin.from("profiles").select("role").eq("id",user.id).maybeSingle(),
      admin.from("providers")
        .select("id, tap_destination_id, tap_account_status, tap_onboarding_completed")
        .eq("user_id",user.id)
        .maybeSingle(),
    ])
    if(profileResult.error||!profileResult.data||providerResult.error){
      return fail("Provider context could not be loaded")
    }
    const provider=providerResult.data
    return ok({
      role:String(profileResult.data.role),
      provider:provider?{
        id:String(provider.id),
        tap_destination_id:provider.tap_destination_id?String(provider.tap_destination_id):null,
        tap_account_status:provider.tap_account_status?String(provider.tap_account_status):null,
        tap_onboarding_completed:Boolean(provider.tap_onboarding_completed),
      }:null,
    } satisfies CurrentProviderContext)
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Provider context could not be loaded")
  }
}

export async function registerProviderProfile(input: ProviderProfileInput) {
  try {
    const { user } = await requireAuth()
    const parsed = providerProfileSchema.safeParse(input)
    if (!parsed.success || Math.round(parsed.data.startingPrice * 100) / 100 !== parsed.data.startingPrice) {
      return fail("Provide valid profile details, categories, skills, and a price with at most two decimals")
    }

    const data = parsed.data
    const { data: providerId, error } = await createAdminClient().rpc("register_provider_profile", {
      p_actor_id: user.id,
      p_name_ar: data.nameAr,
      p_name_en: data.nameEn,
      p_title_ar: data.titleAr,
      p_title_en: data.titleEn,
      p_bio_ar: data.bioAr || "",
      p_bio_en: data.bioEn || "",
      p_starting_price: data.startingPrice,
      p_skills: data.skills,
      p_categories: data.categories,
      p_avatar_url: data.avatarUrl || null,
    })
    return error || !providerId
      ? fail("Provider profile could not be saved")
      : ok({ providerId: providerId as string })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Provider profile could not be saved")
  }
}
