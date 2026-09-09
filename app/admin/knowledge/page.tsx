"use client"

import {useEffect,useRef,useState} from "react"
import {BookOpen,RefreshCw} from "lucide-react"
import {
  getAdminAIKnowledgePage,publishAIKnowledgeVersion,setAIKnowledgeVersionActive,
  type AIKnowledgeArticle,type AIKnowledgeCursor,
} from "@/app/actions/ai-knowledge"
import {useLanguage} from "@/components/language-provider"
import {LoadErrorCard} from "@/components/load-error-card"
import {Badge} from "@/components/ui/badge"
import {Button} from "@/components/ui/button"
import {Card} from "@/components/ui/card"
import {Dialog,DialogContent,DialogFooter,DialogHeader,DialogTitle} from "@/components/ui/dialog"
import {Input} from "@/components/ui/input"
import {Textarea} from "@/components/ui/textarea"
import {useToast} from "@/hooks/use-toast"

const emptyForm={articleKey:"",titleAr:"",titleEn:"",bodyAr:"",bodyEn:"",changeNote:""}

export default function AdminKnowledgePage(){
  const {t,language}=useLanguage();const {toast}=useToast()
  const [articles,setArticles]=useState<AIKnowledgeArticle[]>([])
  const [search,setSearch]=useState("");const [loading,setLoading]=useState(true)
  const [loadError,setLoadError]=useState<string|null>(null)
  const [cursor,setCursor]=useState<AIKnowledgeCursor|null>(null);const [total,setTotal]=useState(0)
  const [loadingMore,setLoadingMore]=useState(false);const [publishing,setPublishing]=useState(false)
  const [form,setForm]=useState(emptyForm);const requestId=useRef<string|null>(null)
  const listRequestVersion=useRef(0)
  const [statusChange,setStatusChange]=useState<{article:AIKnowledgeArticle;active:boolean}|null>(null)
  const [statusReason,setStatusReason]=useState("");const [savingStatus,setSavingStatus]=useState(false)

  const load=async(pageCursor:AIKnowledgeCursor|null=null,append=false)=>{
    const version=append?listRequestVersion.current:++listRequestVersion.current
    if(append)setLoadingMore(true);else{setLoading(true);setLoadingMore(false)}
    const result=await getAdminAIKnowledgePage(search,pageCursor)
    if(version!==listRequestVersion.current)return
    if(result.success){
      setArticles((current)=>append?[...current,...result.data.articles.filter((article)=>!current.some((item)=>item.id===article.id))]:result.data.articles)
      setCursor(result.data.nextCursor);if(!append||result.data.articles.length>0)setTotal(result.data.total);setLoadError(null)
    }else{
      setLoadError(result.error)
      toast({title:t("تعذر تحميل قاعدة المعرفة","Could not load knowledge base"),description:result.error,variant:"destructive"})
    }
    if(append)setLoadingMore(false);else setLoading(false)
  }
  useEffect(()=>{const timeout=window.setTimeout(()=>{void load()},300);return()=>window.clearTimeout(timeout)},[search])

  const updateForm=(patch:Partial<typeof form>)=>{requestId.current=null;setForm((current)=>({...current,...patch}))}
  const publish=async()=>{
    if(publishing)return
    if(!requestId.current)requestId.current=crypto.randomUUID()
    setPublishing(true)
    const result=await publishAIKnowledgeVersion({clientRequestId:requestId.current,...form})
    if(result.success){
      requestId.current=null;setForm(emptyForm)
      toast({title:t("تم نشر نسخة المعرفة","Knowledge version published")});await load()
    }else toast({title:t("تعذر نشر النسخة","Could not publish version"),description:result.error,variant:"destructive"})
    setPublishing(false)
  }
  const saveStatus=async()=>{
    if(!statusChange)return
    setSavingStatus(true)
    const result=await setAIKnowledgeVersionActive(statusChange.article.id,statusChange.active,statusReason)
    if(result.success){
      setStatusChange(null);setStatusReason("")
      toast({title:statusChange.active?t("تم تفعيل النسخة","Version activated"):t("تم إيقاف النسخة","Version deactivated")})
      await load()
    }else toast({title:t("تعذر حفظ حالة النسخة","Could not save version status"),description:result.error,variant:"destructive"})
    setSavingStatus(false)
  }
  const editFrom=(article:AIKnowledgeArticle)=>{
    setForm({articleKey:article.article_key,titleAr:article.title_ar,titleEn:article.title_en,
      bodyAr:article.body_ar,bodyEn:article.body_en,changeNote:""})
    requestId.current=null;window.scrollTo({top:0,behavior:"smooth"})
  }
  const valid=form.articleKey.trim().length>0&&form.titleAr.trim().length>0&&form.titleEn.trim().length>0
    &&form.bodyAr.trim().length>0&&form.bodyEn.trim().length>0&&form.changeNote.trim().length>=3

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><BookOpen className="h-6 w-6"/>{t("قاعدة معرفة المساعد","Assistant Knowledge Base")}</h1><p className="mt-1 text-muted-foreground">{t("انشر نسخاً ثنائية اللغة مع سبب تدقيق. نسخة واحدة فقط من كل مفتاح تكون نشطة.","Publish bilingual versions with an audit reason. Only one version per key can be active.")}</p></div><Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className={`me-2 h-4 w-4 ${loading?"animate-spin":""}`}/>{t("تحديث","Refresh")}</Button></div>

    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">{t("نشر نسخة جديدة","Publish New Version")}</h2>
      <div><label htmlFor="knowledge-key" className="mb-1 block text-sm font-medium">{t("المفتاح","Article Key")}</label><Input id="knowledge-key" value={form.articleKey} maxLength={100} placeholder="payments" onChange={(event)=>updateForm({articleKey:event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g,"")})}/></div>
      <div className="grid gap-4 md:grid-cols-2"><div><label htmlFor="knowledge-title-ar" className="mb-1 block text-sm font-medium">{t("العنوان العربي","Arabic Title")}</label><Input id="knowledge-title-ar" value={form.titleAr} maxLength={300} onChange={(event)=>updateForm({titleAr:event.target.value})}/></div><div><label htmlFor="knowledge-title-en" className="mb-1 block text-sm font-medium">{t("العنوان الإنجليزي","English Title")}</label><Input id="knowledge-title-en" value={form.titleEn} maxLength={300} onChange={(event)=>updateForm({titleEn:event.target.value})}/></div></div>
      <div className="grid gap-4 md:grid-cols-2"><div><label htmlFor="knowledge-body-ar" className="mb-1 block text-sm font-medium">{t("المحتوى العربي","Arabic Body")}</label><Textarea id="knowledge-body-ar" value={form.bodyAr} maxLength={5000} rows={8} onChange={(event)=>updateForm({bodyAr:event.target.value})}/></div><div><label htmlFor="knowledge-body-en" className="mb-1 block text-sm font-medium">{t("المحتوى الإنجليزي","English Body")}</label><Textarea id="knowledge-body-en" value={form.bodyEn} maxLength={5000} rows={8} onChange={(event)=>updateForm({bodyEn:event.target.value})}/></div></div>
      <div><label htmlFor="knowledge-note" className="mb-1 block text-sm font-medium">{t("سبب التغيير","Change Reason")}</label><Textarea id="knowledge-note" value={form.changeNote} maxLength={1000} rows={3} onChange={(event)=>updateForm({changeNote:event.target.value})}/></div>
      <Button onClick={()=>void publish()} disabled={!valid||publishing}>{publishing?t("جاري النشر...","Publishing..."):t("نشر وتفعيل","Publish and Activate")}</Button>
    </Card>

    <div className="flex items-center gap-3"><Input value={search} maxLength={100} placeholder={t("بحث بالمفتاح أو العنوان...","Search by key or title...")} onChange={(event)=>setSearch(event.target.value)} /><span className="whitespace-nowrap text-sm text-muted-foreground">{articles.length} / {total}</span></div>
    {loading?<div className="flex h-48 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent"/></div>:loadError&&articles.length===0?<LoadErrorCard title={t("تعذر تحميل المعرفة","Could not load knowledge")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()}/>:<div className="space-y-3">{loadError&&<LoadErrorCard title={t("تعذر تحديث المعرفة","Could not refresh knowledge")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()}/>}{
      articles.length===0?<Card className="p-8 text-center text-muted-foreground">{t("لا توجد نسخ مطابقة","No matching versions")}</Card>:articles.map((article)=><Card key={article.id} className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{article.article_key} · v{article.version}</h3>{article.is_active?<Badge>{t("نشطة","Active")}</Badge>:<Badge variant="outline">{t("غير نشطة","Inactive")}</Badge>}</div><p className="text-sm text-muted-foreground">{language==="ar"?article.title_ar:article.title_en}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>editFrom(article)}>{t("نسخة جديدة","New Version")}</Button><Button size="sm" variant={article.is_active?"destructive":"default"} onClick={()=>{setStatusChange({article,active:!article.is_active});setStatusReason("")}}>{article.is_active?t("إيقاف","Deactivate"):t("تفعيل","Activate")}</Button></div></div><p className="line-clamp-3 whitespace-pre-wrap text-sm">{language==="ar"?article.body_ar:article.body_en}</p><div className="text-xs text-muted-foreground">{new Date(article.created_at).toLocaleString(language==="ar"?"ar-SA":"en-US")} · {article.publisher_email||article.creator_email||t("ترحيل أولي","Initial migration")}{article.change_note&&` · ${article.change_note}`}</div></Card>)
    }{cursor&&articles.length<total&&<div className="text-center"><Button variant="outline" onClick={()=>void load(cursor,true)} disabled={loadingMore}>{loadingMore?t("جاري التحميل...","Loading..."):t("تحميل نسخ أقدم","Load Older Versions")}</Button></div>}</div>}

    <Dialog open={!!statusChange} onOpenChange={(open)=>!open&&!savingStatus&&setStatusChange(null)}>{statusChange&&<DialogContent><DialogHeader><DialogTitle>{statusChange.active?t("تفعيل نسخة المعرفة","Activate Knowledge Version"):t("إيقاف نسخة المعرفة","Deactivate Knowledge Version")}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{statusChange.article.article_key} · v{statusChange.article.version}</p><div><label htmlFor="knowledge-status-reason" className="mb-1 block text-sm font-medium">{t("سبب التغيير","Change Reason")}</label><Textarea id="knowledge-status-reason" value={statusReason} maxLength={1000} rows={4} onChange={(event)=>setStatusReason(event.target.value)}/></div><DialogFooter><Button variant="outline" onClick={()=>setStatusChange(null)} disabled={savingStatus}>{t("إلغاء","Cancel")}</Button><Button variant={statusChange.active?"default":"destructive"} onClick={()=>void saveStatus()} disabled={savingStatus||statusReason.trim().length<3}>{savingStatus?t("جاري الحفظ...","Saving..."):t("حفظ","Save")}</Button></DialogFooter></DialogContent>}</Dialog>
  </div>
}
