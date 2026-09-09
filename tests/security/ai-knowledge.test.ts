import {beforeEach,describe,expect,it,vi} from "vitest"

const mocks=vi.hoisted(()=>({requireAdmin:vi.fn(),rpc:vi.fn(),revalidatePath:vi.fn()}))
vi.mock("@/lib/auth",async()=>{const actual=await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");return{...actual,requireAdmin:mocks.requireAdmin}})
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}))
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidatePath}))

import {
  getAdminAIKnowledgePage,publishAIKnowledgeVersion,setAIKnowledgeVersionActive,
} from "@/app/actions/ai-knowledge"

const actorId="10000000-0000-4000-8000-000000000001"
const articleId="20000000-0000-4000-8000-000000000001"
const requestId="30000000-0000-4000-8000-000000000001"
const timestamp="2026-09-09T00:00:00.000Z"
const article={
  id:articleId,article_key:"payments",version:2,title_ar:"الدفع",title_en:"Payments",
  body_ar:"راجع حالة الطلب.",body_en:"Check the order status.",is_active:true,created_at:timestamp,
  created_by:actorId,published_by:actorId,published_at:timestamp,client_request_id:requestId,
  change_note:"Clarify payment state",creator_email:"admin@example.test",publisher_email:"admin@example.test",
}

beforeEach(()=>{
  vi.resetAllMocks();mocks.requireAdmin.mockResolvedValue({user:{id:actorId}})
  mocks.rpc.mockResolvedValue({data:article,error:null})
})

describe("AI knowledge management",()=>{
  it("loads version history with a stable administrator cursor",async()=>{
    mocks.rpc.mockResolvedValue({data:{articles:[article],total:3},error:null})
    await expect(getAdminAIKnowledgePage(" pay ",null,1)).resolves.toMatchObject({success:true,data:{
      articles:[{id:articleId,version:2}],total:3,nextCursor:{createdAt:timestamp,id:articleId},
    }})
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_ai_knowledge_page",{
      p_actor_id:actorId,p_query:"pay",p_before_created_at:null,p_before_id:null,p_limit:1,
    })
  })

  it("publishes a bilingual version with a stable request identifier and audit reason",async()=>{
    await expect(publishAIKnowledgeVersion({
      clientRequestId:requestId,articleKey:"payments",titleAr:"الدفع",titleEn:"Payments",
      bodyAr:"راجع حالة الطلب.",bodyEn:"Check the order status.",changeNote:"Clarify payment state",
    })).resolves.toMatchObject({success:true,data:{article:{id:articleId}}})
    expect(mocks.rpc).toHaveBeenCalledWith("publish_ai_knowledge_version",{
      p_actor_id:actorId,p_client_request_id:requestId,p_article_key:"payments",
      p_title_ar:"الدفع",p_title_en:"Payments",p_body_ar:"راجع حالة الطلب.",
      p_body_en:"Check the order status.",p_change_note:"Clarify payment state",
    })
  })

  it("validates publishing and activation before changing knowledge",async()=>{
    await expect(publishAIKnowledgeVersion({
      clientRequestId:requestId,articleKey:"Invalid Key",titleAr:"",titleEn:"",bodyAr:"",bodyEn:"",changeNote:"",
    })).resolves.toMatchObject({success:false})
    expect(mocks.rpc).not.toHaveBeenCalled()
    await expect(setAIKnowledgeVersionActive(articleId,false,"Outdated policy")).resolves.toMatchObject({success:true})
    expect(mocks.rpc).toHaveBeenCalledWith("set_ai_knowledge_version_active",{
      p_actor_id:actorId,p_article_id:articleId,p_active:false,p_change_note:"Outdated policy",
    })
  })
})
