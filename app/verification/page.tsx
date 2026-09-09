"use client"

import { useEffect,useRef,useState } from "react"
import { FileText,Paperclip,ShieldCheck,X } from "lucide-react"
import {
  cancelProviderVerification,
  getMyProviderVerificationRequests,
  submitProviderVerification,
  type VerificationCursor,
  type VerificationDocument,
  type VerificationRequest,
} from "@/app/actions/verification"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { LoadErrorCard } from "@/components/load-error-card"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"

const allowed:Record<string,string>={"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png","image/webp":"webp"}

export default function VerificationPage(){
  const {t,language}=useLanguage();const {toast}=useToast()
  const [providerId,setProviderId]=useState("")
  const [requests,setRequests]=useState<VerificationRequest[]>([])
  const [loading,setLoading]=useState(true);const [loadError,setLoadError]=useState<string|null>(null)
  const [nextCursor,setNextCursor]=useState<VerificationCursor|null>(null);const [total,setTotal]=useState(0);const [loadingMore,setLoadingMore]=useState(false)
  const [files,setFiles]=useState<File[]>([]);const [note,setNote]=useState("");const [processing,setProcessing]=useState(false)
  const [signedUrls,setSignedUrls]=useState<Record<string,string>>({});const [recoveryPending,setRecoveryPending]=useState(false)
  const requestId=useRef<string|null>(null);const input=useRef<HTMLInputElement>(null)

  const load=async(cursor:VerificationCursor|null=null,append=false)=>{
    if(append)setLoadingMore(true);else setLoading(true)
    const result=await getMyProviderVerificationRequests(cursor)
    if(result.success){
      setRequests((current)=>append?[...current,...result.data.requests.filter((request)=>!current.some((item)=>item.id===request.id))]:result.data.requests)
      setProviderId(result.data.providerId||"");setNextCursor(result.data.nextCursor);setTotal(result.data.total);setLoadError(null)
    }else{
      if(!append)setLoadError(result.error)
      toast({title:t("تعذر تحميل طلبات التوثيق","Could not load verification requests"),description:result.error,variant:"destructive"})
    }
    if(append)setLoadingMore(false);else setLoading(false)
  }
  useEffect(()=>{void load()},[])
  useEffect(()=>{
    let active=true;const documents=requests.flatMap((request)=>request.documents||[])
    void Promise.all(documents.map(async(document)=>{
      const {data}=await createClient().storage.from("provider-verification").createSignedUrl(document.path,600)
      return [document.path,data?.signedUrl||""] as const
    })).then((pairs)=>{if(active)setSignedUrls(Object.fromEntries(pairs.filter((pair)=>pair[1])))})
    return()=>{active=false}
  },[requests])

  const chooseFiles=(selected:File[])=>{
    if(recoveryPending)return
    const next=[...files]
    for(const file of selected){
      if(next.length>=5){toast({title:t("الحد الأقصى خمسة ملفات","Maximum five files"),variant:"destructive"});break}
      if(!allowed[file.type]||file.size<1||file.size>10*1024*1024){toast({title:t("ملف غير صالح","Invalid file"),description:t("استخدم PDF أو JPG أو PNG أو WebP حتى 10MB","Use PDF, JPG, PNG, or WebP up to 10MB"),variant:"destructive"});continue}
      if(!next.some((item)=>item.name===file.name&&item.size===file.size&&item.lastModified===file.lastModified))next.push(file)
    }
    setFiles(next);requestId.current=null;if(input.current)input.current.value=""
  }

  const submit=async()=>{
    if(!providerId||files.length===0||processing)return
    if(!requestId.current)requestId.current=crypto.randomUUID()
    const stableId=requestId.current;setProcessing(true)
    const supabase=createClient();const uploaded:string[]=[]
    try{
      const {data:{user},error:authError}=await supabase.auth.getUser()
      if(authError||!user)throw new Error(t("تعذر التحقق من الجلسة","Could not verify your session"))
      const documents:VerificationDocument[]=[]
      for(let index=0;index<files.length;index+=1){
        const file=files[index];const path=`${providerId}/${user.id}/${stableId}-${index}.${allowed[file.type]}`;const name=path.split("/").at(-1)!
        const {data:existing,error:listError}=await supabase.storage.from("provider-verification").list(`${providerId}/${user.id}`,{search:name,limit:10})
        if(listError)throw new Error(t("تعذر التحقق من الملفات","Could not check uploaded files"))
        if(!existing?.some((item)=>item.name===name)){
          const {error}=await supabase.storage.from("provider-verification").upload(path,file,{contentType:file.type,upsert:false})
          if(error)throw new Error(t("تعذر رفع أحد الملفات","A document could not be uploaded"))
        }
        uploaded.push(path);documents.push({path,name:file.name,mime:file.type as VerificationDocument["mime"],size:file.size})
      }
      const result=await submitProviderVerification({clientRequestId:stableId,note,documents})
      if(!result.success)throw new Error(result.error)
      requestId.current=null;setFiles([]);setNote("");setRecoveryPending(false);toast({title:t("تم إرسال طلب التوثيق","Verification request submitted")});await load()
    }catch(error){
      if(uploaded.length){
        await supabase.storage.from("provider-verification").remove(uploaded)
        setRecoveryPending(true)
      }
      toast({title:t("تعذر إرسال طلب التوثيق","Could not submit verification request"),description:uploaded.length?t("أعد المحاولة دون تغيير الملفات للتحقق من النتيجة","Retry without changing the files to recover the result"):error instanceof Error?error.message:t("يرجى المحاولة مرة أخرى","Please try again"),variant:"destructive"})
    }finally{setProcessing(false)}
  }

  const cancel=async(id:string)=>{setProcessing(true);const result=await cancelProviderVerification(id);if(result.success){toast({title:t("تم إلغاء الطلب","Verification request cancelled")});await load()}else toast({title:t("تعذر إلغاء الطلب","Could not cancel request"),description:result.error,variant:"destructive"});setProcessing(false)}
  const hasPending=requests.some((request)=>request.status==="pending")

  return <div className="min-h-screen flex flex-col"><Header/><main className="flex-1 bg-muted/30 py-10"><div className="container mx-auto max-w-4xl space-y-6 px-4"><div><h1 className="flex items-center gap-2 text-3xl font-bold"><ShieldCheck className="h-7 w-7"/>{t("توثيق مقدم الخدمة","Provider Verification")}</h1><p className="mt-2 text-muted-foreground">{t("أرسل مستندات داعمة للمراجعة اليدوية. نوع المستند المطلوب قد يختلف حسب الخدمة ولا توجد موافقة تلقائية.","Submit supporting documents for manual review. Required evidence may vary by service and approval is never automatic.")}</p></div>{loading?<div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent"/></div>:loadError?<LoadErrorCard title={t("تعذر تحميل التوثيق","Could not load verification")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()}/>:<><Card className="space-y-4 p-5"><h2 className="font-semibold">{t("طلب جديد","New Request")}</h2>{hasPending?<p className="text-sm text-muted-foreground">{t("لديك طلب قيد المراجعة. ألغِه قبل إرسال طلب آخر.","You already have a request under review. Cancel it before submitting another.")}</p>:<><Textarea value={note} onChange={(event)=>{if(!recoveryPending){setNote(event.target.value);requestId.current=null}}} disabled={processing||recoveryPending} maxLength={2000} rows={4} placeholder={t("صف نوع الخدمة وما الذي تثبته المستندات...","Describe your service and what the documents support...")}/><input ref={input} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event)=>chooseFiles(Array.from(event.target.files||[]))}/><Button variant="outline" onClick={()=>input.current?.click()} disabled={processing||recoveryPending||files.length>=5}><Paperclip className="me-2 h-4 w-4"/>{t("إضافة مستندات","Add Documents")}</Button>{files.length>0&&<ul className="space-y-1">{files.map((file,index)=><li key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between rounded border p-2 text-sm"><span className="truncate">{file.name}</span><Button size="icon" variant="ghost" aria-label={t("إزالة المستند","Remove document")} disabled={processing||recoveryPending} onClick={()=>{setFiles((current)=>current.filter((_,position)=>position!==index));requestId.current=null}}><X className="h-4 w-4"/></Button></li>)}</ul>}{recoveryPending&&<p className="text-sm text-destructive" role="alert">{t("احتفظ بالبيانات واضغط إرسال مرة أخرى لاستعادة النتيجة","Keep the form unchanged and submit again to recover the result")}</p>}<Button onClick={()=>void submit()} disabled={processing||files.length===0}>{processing?t("جاري الإرسال...","Submitting..."):t("إرسال للمراجعة","Submit for Review")}</Button></>}</Card><div className="space-y-3"><h2 className="font-semibold">{t("سجل الطلبات","Request History")}</h2>{requests.length===0?<Card className="p-8 text-center text-muted-foreground">{t("لا توجد طلبات توثيق","No verification requests")}</Card>:requests.map((request)=><Card key={request.id} className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-medium">{language==="ar"?request.provider_name_ar:request.provider_name_en}</span><p className="text-xs text-muted-foreground">{new Date(request.created_at).toLocaleString(language==="ar"?"ar-SA":"en-US")}</p></div><Badge variant={request.status==="rejected"?"destructive":"secondary"}>{request.status}</Badge></div>{request.note&&<p className="text-sm">{request.note}</p>}{request.review_note&&<p className="rounded bg-muted p-2 text-sm">{t("ملاحظة المراجعة","Review note")}: {request.review_note}</p>}<div className="flex flex-wrap gap-2">{request.documents.map((document)=><a key={document.path} href={signedUrls[document.path]||undefined} aria-disabled={!signedUrls[document.path]} target="_blank" rel="noreferrer noopener" className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-sm ${signedUrls[document.path]?"text-primary hover:underline":"pointer-events-none text-muted-foreground"}`}><FileText className="h-4 w-4"/>{document.name}</a>)}</div>{request.status==="pending"&&<Button size="sm" variant="outline" onClick={()=>void cancel(request.id)} disabled={processing}>{t("إلغاء الطلب","Cancel Request")}</Button>}</Card>)}{nextCursor&&requests.length<total&&<div className="text-center"><Button variant="outline" onClick={()=>void load(nextCursor,true)} disabled={loadingMore}>{loadingMore?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Requests")}</Button></div>}</div></>}</div></main><Footer/></div>
}
