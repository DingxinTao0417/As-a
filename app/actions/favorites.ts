"use server"

import { z } from "zod"
import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

const favoriteCursor=z.object({createdAt:z.string().datetime(),id:z.string().uuid()})
export type FavoriteCursor=z.infer<typeof favoriteCursor>
export type FavoriteProvider={
  id:string;provider_id:string;created_at:string;provider:{
    name_ar:string;name_en:string;title_ar:string|null;title_en:string|null;avatar_url:string|null
    rating:number;starting_price:number|null;is_verified:boolean;is_available:boolean
  }
}

export async function getFavoriteProviders(cursor:FavoriteCursor|null=null,limit=50){
  try{
    const {user}=await requireAuth()
    const parsedCursor=cursor?favoriteCursor.safeParse(cursor):null
    if(!Number.isInteger(limit)||limit<1||limit>100||(parsedCursor&&!parsedCursor.success))return fail("Invalid favorites page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_favorite_provider_page",{
      p_actor_id:user.id,p_before_created_at:value?.createdAt||null,p_before_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Favorites could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.favorites))return fail("Favorites could not be loaded")
    const rows=snapshot.favorites as FavoriteProvider[];const last=rows.at(-1)
    return ok({
      favorites:rows.map((favorite)=>({...favorite,provider:{...favorite.provider,
        rating:Number(favorite.provider.rating),starting_price:favorite.provider.starting_price==null?null:Number(favorite.provider.starting_price),
      }})),
      total:Number(snapshot.total||0),
      nextCursor:rows.length===limit&&last?{createdAt:last.created_at,id:last.id}:null,
    })
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Favorites could not be loaded")
  }
}

export async function setProviderFavorite(providerId: string,favorite: boolean) {
  try {
    const { user } = await requireAuth()
    if (!z.string().uuid().safeParse(providerId).success || typeof favorite !== "boolean") {
      return fail("Invalid favorite")
    }
    const { data, error } = await createAdminClient().rpc("set_provider_favorite", {
      p_actor_id: user.id,
      p_provider_id: providerId,
      p_favorite: favorite,
    })
    return error ? fail("Favorite could not be saved") : ok({ favorite: Boolean(data) })
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    return fail("Favorite could not be saved")
  }
}

export async function getProviderFavoriteStatus(providerId:string){
  try{
    const {user}=await requireAuth()
    if(!z.string().uuid().safeParse(providerId).success)return fail("Invalid favorite")
    const {data,error}=await createAdminClient()
      .from("favorites")
      .select("id")
      .eq("user_id",user.id)
      .eq("provider_id",providerId)
      .maybeSingle()
    return error?fail("Favorite status could not be loaded"):ok({favorite:Boolean(data)})
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Favorite status could not be loaded")
  }
}
