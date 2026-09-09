"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const avatarUrl = z.string().trim().min(1).max(2048).refine((value) => {
  try {
    const configuredOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://invalid.local").origin
    const parsed = new URL(value)
    return parsed.protocol === "https:"
      && parsed.origin === configuredOrigin
      && parsed.pathname.startsWith("/storage/v1/object/public/avatars/")
  } catch {
    return false
  }
})

export async function saveProfileAvatar(url: string) {
  try {
    const { user } = await requireAuth()
    const parsed = avatarUrl.safeParse(url)
    if (!parsed.success) return fail("Invalid avatar URL")
    const { data: oldUrls, error } = await createAdminClient().rpc("update_profile_avatar", {
      p_actor_id: user.id,
      p_avatar_url: parsed.data,
    })
    return error
      ? fail("Avatar could not be saved")
      : ok({ oldUrls: (oldUrls || []) as string[] })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Avatar could not be saved")
  }
}

const profileDetails = z.object({
  fullName:z.string().trim().min(1).max(200),
  phone:z.string().trim().max(50),
  location:z.string().trim().max(200),
  bio:z.string().trim().max(5000),
})

export async function saveProfileDetails(input:z.infer<typeof profileDetails>) {
  try {
    const { user }=await requireAuth()
    const parsed=profileDetails.safeParse(input)
    if(!parsed.success)return fail("Invalid profile details")
    const value=parsed.data
    const { data,error }=await createAdminClient().rpc("update_own_profile",{
      p_actor_id:user.id,
      p_full_name:value.fullName,
      p_phone:value.phone,
      p_location:value.location,
      p_bio:value.bio,
    })
    return error||!data||typeof data!=="object"
      ? fail("Profile could not be saved")
      : ok({ profile:data as Record<string,unknown> })
  } catch(error) {
    if(error instanceof AuthError)return fail(error.message)
    return fail("Profile could not be saved")
  }
}
