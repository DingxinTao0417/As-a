"use server"

import {revalidatePath} from "next/cache"
import {z} from "zod"
import {fail,ok} from "@/lib/action-result"
import {AuthError,requireAdmin} from "@/lib/auth"
import {createAdminClient} from "@/lib/supabase/admin"

const uuid=z.string().uuid()
const cursorSchema=z.object({createdAt:z.string().datetime(),id:uuid})
const publishSchema=z.object({
  clientRequestId:uuid,
  articleKey:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
  titleAr:z.string().trim().min(1).max(300),
  titleEn:z.string().trim().min(1).max(300),
  bodyAr:z.string().trim().min(1).max(5000),
  bodyEn:z.string().trim().min(1).max(5000),
  changeNote:z.string().trim().min(3).max(1000),
})

export type AIKnowledgeCursor=z.infer<typeof cursorSchema>
export type AIKnowledgeArticle={
  id:string;article_key:string;version:number;title_ar:string;title_en:string
  body_ar:string;body_en:string;is_active:boolean;created_at:string
  created_by:string|null;published_by:string|null;published_at:string|null
  client_request_id:string|null;change_note:string|null
  creator_email:string|null;publisher_email:string|null
}

export async function getAdminAIKnowledgePage(
  query="",cursor:AIKnowledgeCursor|null=null,limit=50,
){
  try{
    const {user}=await requireAdmin()
    const parsedCursor=cursor?cursorSchema.safeParse(cursor):null
    if(query.length>100||!Number.isInteger(limit)||limit<1||limit>100
      ||(parsedCursor&&!parsedCursor.success))return fail("Invalid knowledge page")
    const value=parsedCursor?.success?parsedCursor.data:null
    const {data,error}=await createAdminClient().rpc("get_admin_ai_knowledge_page",{
      p_actor_id:user.id,p_query:query.trim()||null,p_before_created_at:value?.createdAt||null,
      p_before_id:value?.id||null,p_limit:limit,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Knowledge versions could not be loaded")
    const snapshot=data as Record<string,unknown>
    if(!Array.isArray(snapshot.articles))return fail("Knowledge versions could not be loaded")
    const rows=snapshot.articles as AIKnowledgeArticle[];const last=rows.at(-1)
    return ok({
      articles:rows.map((article)=>({...article,version:Number(article.version)})),
      total:Number(snapshot.total||0),
      nextCursor:rows.length===limit&&last?{createdAt:last.created_at,id:last.id}:null,
    })
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Knowledge versions could not be loaded")
  }
}

export async function publishAIKnowledgeVersion(input:z.infer<typeof publishSchema>){
  try{
    const {user}=await requireAdmin()
    const parsed=publishSchema.safeParse(input)
    if(!parsed.success)return fail("Enter a valid key, bilingual titles and bodies, and change reason")
    const value=parsed.data
    const {data,error}=await createAdminClient().rpc("publish_ai_knowledge_version",{
      p_actor_id:user.id,p_client_request_id:value.clientRequestId,p_article_key:value.articleKey,
      p_title_ar:value.titleAr,p_title_en:value.titleEn,p_body_ar:value.bodyAr,p_body_en:value.bodyEn,
      p_change_note:value.changeNote,
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Knowledge version could not be published")
    revalidatePath("/admin/knowledge")
    return ok({article:data as AIKnowledgeArticle})
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Knowledge version could not be published")
  }
}

export async function setAIKnowledgeVersionActive(articleId:string,active:boolean,changeNote:string){
  try{
    const {user}=await requireAdmin()
    if(!uuid.safeParse(articleId).success||typeof active!=="boolean"
      ||changeNote.trim().length<3||changeNote.trim().length>1000)return fail("Enter a valid version and change reason")
    const {data,error}=await createAdminClient().rpc("set_ai_knowledge_version_active",{
      p_actor_id:user.id,p_article_id:articleId,p_active:active,p_change_note:changeNote.trim(),
    })
    if(error||!data||typeof data!=="object"||Array.isArray(data))return fail("Knowledge version status could not be saved")
    revalidatePath("/admin/knowledge")
    return ok({article:data as AIKnowledgeArticle})
  }catch(error){
    if(error instanceof AuthError)return fail(error.message)
    return fail("Knowledge version status could not be saved")
  }
}
