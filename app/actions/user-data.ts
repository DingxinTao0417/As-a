"use server"

import { fail, ok } from "@/lib/action-result"
import { AuthError, requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import {createUserDataEnvelope,loadUserDataSnapshot} from "@/lib/user-data-export"

type PrivateFile={bucket:string;path:string;signed_url:string;expires_at:string}

export async function exportUserData() {
  try {
    const { user } = await requireAuth()
    const admin=createAdminClient()
    const {snapshot,privateFiles:references}=await loadUserDataSnapshot(user,admin)

    const expiresIn=15*60
    const expiresAt=new Date(Date.now()+expiresIn*1000).toISOString()
    const privateFiles:PrivateFile[]=[]
    const byBucket=new Map<string,string[]>()
    for(const reference of references)byBucket.set(reference.bucket,[...(byBucket.get(reference.bucket)||[]),reference.path])
    for(const [bucket,requested] of byBucket){
      const {data:signed,error:signError}=await admin.storage.from(bucket).createSignedUrls(requested,expiresIn)
      if(signError||!signed||signed.length!==requested.length)return fail("Private export files could not be prepared")
      const signedByPath=new Map(signed.map((item)=>[item.path,item]))
      for(const path of requested){
        const item=signedByPath.get(path) as {signedUrl?:string;error?:unknown}|undefined
        if(!item?.signedUrl||item.error)return fail("Private export files could not be prepared")
        privateFiles.push({bucket,path,signed_url:item.signedUrl,expires_at:expiresAt})
      }
    }

    return ok(createUserDataEnvelope(user,snapshot,{private_file_downloads:privateFiles}))
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message)
    console.error("Failed to export user data", error instanceof Error ? error.name : "UnknownError")
    return fail("Data export could not be completed")
  }
}
