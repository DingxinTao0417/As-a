"use client"

import { useEffect, useRef, useState } from "react"
import { FileUp, Scale } from "lucide-react"
import {
  addDisputeEvidence,
  createOrderDispute,
  getDisputeEligibleOrders,
  getDisputeEvidence,
  getMyDisputes,
  type DisputeCursor,
  type Dispute,
  type DisputeEligibleOrder,
  type DisputeEvidenceCursor,
  type DisputeEvidence,
  type DisputeOrderCursor,
} from "@/app/actions/disputes"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"

export default function DisputesPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [orders, setOrders] = useState<DisputeEligibleOrder[]>([])
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [selected, setSelected] = useState<Dispute | null>(null)
  const [evidence, setEvidence] = useState<DisputeEvidence[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [orderId, setOrderId] = useState("")
  const [category, setCategory] = useState<"delivery" | "quality" | "payment" | "conduct" | "other">("delivery")
  const [description, setDescription] = useState("")
  const [requestedResolution, setRequestedResolution] = useState("")
  const [evidenceDescription, setEvidenceDescription] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [evidenceLoadError, setEvidenceLoadError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [orderCursor,setOrderCursor]=useState<DisputeOrderCursor|null>(null)
  const [orderTotal,setOrderTotal]=useState(0)
  const [disputeCursor,setDisputeCursor]=useState<DisputeCursor|null>(null)
  const [disputeTotal,setDisputeTotal]=useState(0)
  const [evidenceCursor,setEvidenceCursor]=useState<DisputeEvidenceCursor|null>(null)
  const [evidenceTotal,setEvidenceTotal]=useState(0)
  const [loadingMore,setLoadingMore]=useState<"orders"|"disputes"|"evidence"|null>(null)
  const requestId = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    const [orderResult, disputeResult] = await Promise.all([getDisputeEligibleOrders(), getMyDisputes()])
    if (!orderResult.success || !disputeResult.success) {
      const message=!orderResult.success ? orderResult.error : !disputeResult.success ? disputeResult.error : t("يرجى المحاولة مرة أخرى","Please try again")
      setLoadError(message)
      toast({ title: t("تعذر تحميل النزاعات", "Could not load disputes"), description:message, variant: "destructive" })
      setLoading(false)
      return
    }
    setOrders(orderResult.data.orders);setOrderCursor(orderResult.data.nextCursor);setOrderTotal(orderResult.data.total)
    setDisputes(disputeResult.data.disputes);setDisputeCursor(disputeResult.data.nextCursor);setDisputeTotal(disputeResult.data.total)
    const requestedId = new URLSearchParams(window.location.search).get("dispute")
    if (requestedId) setSelected(disputeResult.data.disputes.find((item) => item.id === requestedId) || null)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const signEvidence=async(items:DisputeEvidence[])=>{
    const supabase=createClient()
    const pairs=await Promise.all(items.map(async(item)=>{
      const {data,error}=await supabase.storage.from("dispute-evidence").createSignedUrl(item.storage_path,600)
      return [item.id,data?.signedUrl||"",error] as const
    }))
    return {
      urls:Object.fromEntries(pairs.filter((pair)=>pair[1]).map(([id,url])=>[id,url])),
      failed:pairs.some((pair)=>pair[2]),
    }
  }

  useEffect(() => {
    let active=true
    setEvidence([])
    setSignedUrls({})
    setEvidenceCursor(null)
    setEvidenceTotal(0)
    setEvidenceLoadError(null)
    if (!selected) return () => { active=false }
    void getDisputeEvidence(selected.id).then(async (result) => {
      if(!active)return
      if (!result.success) {
        setEvidenceLoadError(result.error)
        return toast({ title: t("تعذر تحميل الأدلة", "Could not load evidence"), description: result.error, variant: "destructive" })
      }
      setEvidence(result.data.evidence);setEvidenceCursor(result.data.nextCursor);setEvidenceTotal(result.data.total)
      const signed=await signEvidence(result.data.evidence)
      if(active){
        setSignedUrls(signed.urls)
        if(signed.failed)setEvidenceLoadError(t("تعذر إنشاء بعض روابط الأدلة","Some evidence links could not be created"))
      }
    })
    return () => { active=false }
  }, [selected?.id])

  const loadMoreOrders=async()=>{
    if(!orderCursor||loadingMore)return
    setLoadingMore("orders");const result=await getDisputeEligibleOrders(orderCursor)
    if(result.success){setOrders((current)=>[...current,...result.data.orders.filter((order)=>!current.some((item)=>item.id===order.id))]);setOrderCursor(result.data.nextCursor);setOrderTotal(result.data.total)}
    else toast({title:t("تعذر تحميل طلبات أقدم","Could not load older orders"),description:result.error,variant:"destructive"})
    setLoadingMore(null)
  }
  const loadMoreDisputes=async()=>{
    if(!disputeCursor||loadingMore)return
    setLoadingMore("disputes");const result=await getMyDisputes(disputeCursor)
    if(result.success){setDisputes((current)=>[...current,...result.data.disputes.filter((dispute)=>!current.some((item)=>item.id===dispute.id))]);setDisputeCursor(result.data.nextCursor);setDisputeTotal(result.data.total)}
    else toast({title:t("تعذر تحميل نزاعات أقدم","Could not load older disputes"),description:result.error,variant:"destructive"})
    setLoadingMore(null)
  }
  const loadMoreEvidence=async()=>{
    if(!selected||!evidenceCursor||loadingMore)return
    setLoadingMore("evidence");const result=await getDisputeEvidence(selected.id,evidenceCursor)
    if(result.success){
      const additions=result.data.evidence.filter((item)=>!evidence.some((current)=>current.id===item.id))
      const signed=await signEvidence(additions)
      setEvidence((current)=>[...current,...additions].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)))
      setSignedUrls((current)=>({...current,...signed.urls}))
      if(signed.failed)setEvidenceLoadError(t("تعذر إنشاء بعض روابط الأدلة","Some evidence links could not be created"))
      setEvidenceCursor(result.data.nextCursor);setEvidenceTotal(result.data.total)
    }else toast({title:t("تعذر تحميل أدلة إضافية","Could not load more evidence"),description:result.error,variant:"destructive"})
    setLoadingMore(null)
  }

  const create = async () => {
    if (!requestId.current) requestId.current = crypto.randomUUID()
    setProcessing(true)
    const result = await createOrderDispute({ orderId, clientRequestId: requestId.current, category, description, requestedResolution })
    if (result.success) {
      setDescription("")
      setRequestedResolution("")
      requestId.current = null
      await load()
      setSelected(result.data.dispute)
      toast({ title: t("تم فتح النزاع", "Dispute opened") })
    } else toast({ title: t("تعذر فتح النزاع", "Could not open dispute"), description: result.error, variant: "destructive" })
    setProcessing(false)
  }

  const uploadEvidence = async (file: File) => {
    if (!selected) return
    const allowed: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }
    if (!allowed[file.type] || file.size > 10 * 1024 * 1024) return toast({ title: t("ملف غير صالح", "Invalid file"), description: t("استخدم صورة أو PDF بحجم لا يتجاوز 10MB", "Use an image or PDF up to 10MB"), variant: "destructive" })
    setProcessing(true)
    const supabase = createClient()
    const { data: { user },error:authError } = await supabase.auth.getUser()
    if (authError || !user) {
      toast({ title:t("انتهت الجلسة","Session expired"),description:t("سجل الدخول ثم حاول مرة أخرى","Sign in and try again"),variant:"destructive" })
      setProcessing(false);return
    }
    const path = `${selected.id}/${user.id}/${crypto.randomUUID()}.${allowed[file.type]}`
    const { error: uploadError } = await supabase.storage.from("dispute-evidence").upload(path, file, { contentType: file.type, upsert: false })
    if (uploadError) {
      toast({ title: t("تعذر رفع الدليل", "Could not upload evidence"), variant: "destructive" })
      setProcessing(false)
      return
    }
    const result = await addDisputeEvidence(selected.id, path, evidenceDescription)
    if (!result.success) {
      const { error:cleanupError }=await supabase.storage.from("dispute-evidence").remove([path])
      toast({ title: t("تعذر تسجيل الدليل", "Could not record evidence"), description:cleanupError?t("تعذر تنظيف الملف المرفوع؛ يلزم فحص التخزين","The uploaded file could not be cleaned up; storage review is required"):result.error, variant: "destructive" })
    } else {
      setEvidenceDescription("")
      setEvidence((current) => [...current, result.data.evidence])
      setEvidenceTotal((current)=>current+1)
      const { data,error:signedUrlError } = await supabase.storage.from("dispute-evidence").createSignedUrl(path, 600)
      if (data?.signedUrl) setSignedUrls((current) => ({ ...current, [result.data.evidence.id]: data.signedUrl }))
      if(signedUrlError){
        setEvidenceLoadError(t("تم حفظ الدليل لكن تعذر إنشاء رابط العرض","Evidence was saved, but its viewing link could not be created"))
        toast({ title:t("تعذر إنشاء رابط الدليل","Could not create evidence link"),variant:"destructive" })
      }
      toast({ title: t("تمت إضافة الدليل", "Evidence added") })
    }
    if (fileInput.current) fileInput.current.value = ""
    setProcessing(false)
  }

  return <div className="min-h-screen flex flex-col"><Header /><main className="flex-1 bg-muted/30 py-10"><div className="container mx-auto max-w-6xl px-4 space-y-6">
    <div><h1 className="flex items-center gap-2 text-3xl font-bold"><Scale className="h-7 w-7" />{t("نزاعات الطلبات", "Order Disputes")}</h1><p className="mt-2 text-muted-foreground">{t("يفتح النزاع مراجعة يدوية ويجمّد الرصيد المرتبط عند توفره. لا يؤدي فتح النزاع وحده إلى استرداد أو دفع.", "A dispute opens manual review and freezes related available funds when present. Opening a dispute alone does not refund or pay funds.")}</p></div>
    {loading ? <div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div> : loadError ? <Card className="p-8 text-center" role="alert"><p className="font-medium text-destructive">{t("تعذر تحميل النزاعات","Could not load disputes")}</p><p className="mt-2 text-sm text-muted-foreground">{loadError}</p><Button variant="outline" className="mt-4" onClick={()=>void load()}>{t("إعادة المحاولة","Retry")}</Button></Card> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-5"><Card className="space-y-4 p-5"><h2 className="font-semibold">{t("فتح نزاع", "Open Dispute")}</h2><Select value={orderId} onValueChange={(value) => { setOrderId(value); requestId.current=null }}><SelectTrigger><SelectValue placeholder={t("اختر طلباً", "Select an order")} /></SelectTrigger><SelectContent>{orders.map((order) => <SelectItem key={order.id} value={order.id}>{language === "ar" ? order.service_name_ar : order.service_name_en} · {order.status}</SelectItem>)}</SelectContent></Select><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{orders.length} / {orderTotal}</span>{orderCursor&&orders.length<orderTotal&&<Button size="sm" variant="outline" onClick={()=>void loadMoreOrders()} disabled={loadingMore!==null}>{loadingMore==="orders"?t("جاري التحميل...","Loading..."):t("طلبات أقدم","Older Orders")}</Button>}</div><Select value={category} onValueChange={(value) => { setCategory(value as typeof category); requestId.current=null }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["delivery","quality","payment","conduct","other"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Textarea value={description} rows={5} maxLength={5000} placeholder={t("اشرح المشكلة بالتفصيل...", "Describe the issue in detail...")} onChange={(event) => { setDescription(event.target.value); requestId.current=null }} /><Textarea value={requestedResolution} maxLength={1000} placeholder={t("ما النتيجة التي تطلبها؟", "What outcome are you requesting?")} onChange={(event) => { setRequestedResolution(event.target.value); requestId.current=null }} /><Button onClick={() => void create()} disabled={processing || !orderId || description.trim().length<10 || requestedResolution.trim().length<3}>{t("فتح النزاع", "Open Dispute")}</Button></Card>
      <div className="space-y-2"><div className="text-xs text-muted-foreground">{disputes.length} / {disputeTotal}</div>{disputes.map((dispute) => <button key={dispute.id} className={`w-full rounded-lg border p-4 text-start ${selected?.id===dispute.id ? "border-primary bg-primary/5" : "bg-card"}`} onClick={() => setSelected(dispute)}><div className="flex justify-between gap-2"><span className="font-medium">{language === "ar" ? dispute.order?.service_name_ar : dispute.order?.service_name_en}</span><Badge variant={dispute.status==="closed" ? "outline" : "secondary"}>{dispute.status}</Badge></div><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{dispute.description}</p></button>)}{disputeCursor&&disputes.length<disputeTotal&&<Button className="w-full" variant="outline" onClick={()=>void loadMoreDisputes()} disabled={loadingMore!==null}>{loadingMore==="disputes"?t("جاري التحميل...","Loading..."):t("تحميل نزاعات أقدم","Load Older Disputes")}</Button>}</div></div>
      <Card className="p-5">{selected ? <div className="space-y-4"><div><div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-semibold">{selected.category}</h2><Badge>{selected.status}</Badge></div><p className="mt-3 whitespace-pre-wrap text-sm">{selected.description}</p><p className="mt-2 text-sm text-muted-foreground">{t("النتيجة المطلوبة", "Requested outcome")}: {selected.requested_resolution}</p>{selected.resolution_note && <p className="mt-2 rounded-lg bg-muted p-3 text-sm">{t("قرار الإدارة", "Administrator decision")}: {selected.resolution_note}</p>}</div><div className="border-t pt-4"><h3 className="mb-3 font-medium">{t("الأدلة الخاصة", "Private Evidence")}</h3>{evidenceLoadError&&<p className="mb-3 rounded border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive" role="alert">{evidenceLoadError}</p>}<div className="space-y-2">{!evidenceLoadError&&evidence.length===0 ? <p className="text-sm text-muted-foreground">{t("لا توجد أدلة مرفوعة", "No evidence uploaded")}</p> : evidence.map((item) => <div key={item.id} className="rounded border p-3 text-sm">{signedUrls[item.id]?<a href={signedUrls[item.id]} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{item.storage_path.split("/").at(-1)}</a>:<span className="text-muted-foreground">{item.storage_path.split("/").at(-1)} · {t("الرابط غير متاح","Link unavailable")}</span>}{item.description && <p className="mt-1 text-muted-foreground">{item.description}</p>}</div>)}{evidenceCursor&&evidence.length<evidenceTotal&&<Button className="w-full" size="sm" variant="outline" onClick={()=>void loadMoreEvidence()} disabled={loadingMore!==null}>{loadingMore==="evidence"?t("جاري التحميل...","Loading..."):t("تحميل أدلة إضافية","Load More Evidence")}</Button>}</div></div>{["open","under_review"].includes(selected.status) && <div className="space-y-3 border-t pt-4"><Input value={evidenceDescription} maxLength={1000} placeholder={t("وصف الدليل (اختياري)", "Evidence description (optional)")} onChange={(event) => setEvidenceDescription(event.target.value)} /><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(event) => event.target.files?.[0] && void uploadEvidence(event.target.files[0])} /><Button variant="outline" onClick={() => fileInput.current?.click()} disabled={processing}><FileUp className="me-2 h-4 w-4" />{t("رفع صورة أو PDF", "Upload Image or PDF")}</Button></div>}</div> : <div className="flex h-56 items-center justify-center text-muted-foreground">{t("اختر نزاعاً", "Select a dispute")}</div>}</Card>
    </div>}
  </div></main><Footer /></div>
}
