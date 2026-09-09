"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import {
  getAdminDisputes,getDisputeEvidence,reviewDispute,
  type AdminDisputeFilter,type Dispute,type DisputeCursor,
  type DisputeEvidence,type DisputeEvidenceCursor,
} from "@/app/actions/disputes"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import { LoadErrorCard } from "@/components/load-error-card"

const filters:AdminDisputeFilter[]=["active","open","under_review","resolved","closed","all"]
const filterLabels:Record<AdminDisputeFilter,[string,string]>={
  active:["النشطة","Active"],open:["المفتوحة","Open"],under_review:["قيد المراجعة","Under Review"],
  resolved:["المحلولة","Resolved"],closed:["المغلقة","Closed"],all:["الكل","All"],
}

export default function AdminDisputesPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [selected, setSelected] = useState<Dispute | null>(null)
  const [evidence, setEvidence] = useState<Array<DisputeEvidence & { signedUrl?: string }>>([])
  const [action, setAction] = useState<"under_review" | "continue_order" | "refund" | "closed_no_action">("under_review")
  const [note, setNote] = useState("")
  const [refundAmount, setRefundAmount] = useState("")
  const [loading, setLoading] = useState(true)
  const [filter,setFilter]=useState<AdminDisputeFilter>("active")
  const [cursor,setCursor]=useState<DisputeCursor|null>(null)
  const [total,setTotal]=useState(0)
  const [openCount,setOpenCount]=useState(0)
  const [evidenceCursor,setEvidenceCursor]=useState<DisputeEvidenceCursor|null>(null)
  const [evidenceTotal,setEvidenceTotal]=useState(0)
  const [loadingMore,setLoadingMore]=useState<"disputes"|"evidence"|null>(null)
  const requestVersion=useRef(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const [evidenceReloadKey, setEvidenceReloadKey] = useState(0)
  const [processing, setProcessing] = useState(false)

  const load = async (pageCursor:DisputeCursor|null=null,append=false) => {
    const version=append?requestVersion.current:++requestVersion.current
    if(append)setLoadingMore("disputes");else setLoading(true)
    const result = await getAdminDisputes(filter,pageCursor)
    if(version!==requestVersion.current)return
    if (result.success) {
      setDisputes((current)=>append?[...current,...result.data.disputes.filter((dispute)=>!current.some((item)=>item.id===dispute.id))]:result.data.disputes)
      setCursor(result.data.nextCursor);if(!append||result.data.disputes.length>0)setTotal(result.data.total)
      setOpenCount(result.data.openCount)
      setLoadError(null)
      const requestedId = new URLSearchParams(window.location.search).get("dispute")
      if (requestedId&&!append) setSelected(result.data.disputes.find((item) => item.id===requestedId) || null)
    } else {setLoadError(result.error);toast({ title: t("تعذر تحميل النزاعات", "Could not load disputes"), description: result.error, variant: "destructive" })}
    if(append)setLoadingMore(null);else setLoading(false)
  }
  useEffect(() => { void load() }, [filter])

  const signEvidence=async(items:DisputeEvidence[])=>{
    const supabase=createClient()
    const rows=await Promise.all(items.map(async(item)=>{
      const {data,error}=await supabase.storage.from("dispute-evidence").createSignedUrl(item.storage_path,600)
      return {...item,signedUrl:data?.signedUrl,error}
    }))
    return {
      rows:rows.map((entry)=>{
        const item={...entry}
        delete (item as Partial<typeof entry>).error
        return item
      }),
      failed:rows.some((item)=>item.error),
    }
  }
  useEffect(() => {
    if (!selected) {setEvidenceError(null);setEvidenceCursor(null);setEvidenceTotal(0);return setEvidence([])}
    let active=true
    setEvidence([])
    setEvidenceError(null)
    setAction(selected.status==="open" ? "under_review" : "continue_order")
    setNote("")
    setRefundAmount("")
    void getDisputeEvidence(selected.id).then(async (result) => {
      if(!active)return
      if (!result.success) {setEvidenceError(result.error);return}
      const signed=await signEvidence(result.data.evidence)
      if(active){
        setEvidence(signed.rows);setEvidenceCursor(result.data.nextCursor);setEvidenceTotal(result.data.total)
        if(signed.failed)setEvidenceError(t("تعذر إنشاء بعض روابط الأدلة","Some evidence links could not be created"))
      }
    })
    return()=>{active=false}
  }, [selected?.id,evidenceReloadKey])

  const loadMoreEvidence=async()=>{
    if(!selected||!evidenceCursor||loadingMore)return
    setLoadingMore("evidence")
    const result=await getDisputeEvidence(selected.id,evidenceCursor)
    if(result.success){
      const additions=result.data.evidence.filter((item)=>!evidence.some((current)=>current.id===item.id))
      const signed=await signEvidence(additions)
      setEvidence((current)=>[...current,...signed.rows].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)))
      setEvidenceCursor(result.data.nextCursor);setEvidenceTotal(result.data.total)
      if(signed.failed)setEvidenceError(t("تعذر إنشاء بعض روابط الأدلة","Some evidence links could not be created"))
    }else toast({title:t("تعذر تحميل أدلة إضافية","Could not load more evidence"),description:result.error,variant:"destructive"})
    setLoadingMore(null)
  }

  const submit = async () => {
    if (!selected) return
    setProcessing(true)
    const result=await reviewDispute(selected.id,action,note,action==="refund" ? Number(refundAmount) : undefined)
    if (result.success) {
      setSelected(result.data.dispute)
      setNote("")
      toast({ title:t("تم حفظ قرار النزاع","Dispute decision saved") })
      await load()
    } else toast({ title:t("تعذر حفظ القرار","Could not save decision"),description:result.error,variant:"destructive" })
    setProcessing(false)
  }

  return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">{t("نزاعات الطلبات","Order Disputes")} {openCount>0&&<Badge variant="destructive" className="ms-2">{openCount} {t("نشط","active")}</Badge>}</h1><p className="mt-1 text-muted-foreground">{t("راجع وصف الطرف والأدلة قبل تحديد الاستمرار أو الاسترداد أو الإغلاق","Review the party's description and evidence before continuing, refunding, or closing")}</p></div><Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className={`me-2 h-4 w-4 ${loading?"animate-spin":""}`} />{t("تحديث","Refresh")}</Button></div>
  <div className="flex flex-wrap items-center gap-2">{filters.map((value)=><Button key={value} size="sm" variant={filter===value?"default":"outline"} onClick={()=>setFilter(value)}>{t(filterLabels[value][0],filterLabels[value][1])}</Button>)}<span className="ms-auto text-sm text-muted-foreground">{disputes.length} / {total}</span></div>
  {loading ? <div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div> : loadError&&disputes.length===0 ? <LoadErrorCard title={t("تعذر تحميل النزاعات","Could not load disputes")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()} /> : <div className="space-y-4">{loadError&&<LoadErrorCard title={t("تعذر تحديث النزاعات","Could not refresh disputes")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()} />}<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"><div className="space-y-2">{disputes.length===0 && <Card className="p-8 text-center text-muted-foreground">{t("لا توجد نزاعات","No disputes")}</Card>}{disputes.map((dispute)=><button key={dispute.id} className={`w-full rounded-lg border p-4 text-start ${selected?.id===dispute.id?"border-primary bg-primary/5":"bg-card"}`} onClick={()=>setSelected(dispute)}><div className="flex justify-between gap-2"><span className="font-medium">{language==="ar"?dispute.order?.service_name_ar:dispute.order?.service_name_en}</span><Badge variant={dispute.status==="closed"?"outline":"secondary"}>{dispute.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{dispute.opener?.full_name||dispute.opener?.email||dispute.opened_by}</p></button>)}{cursor&&disputes.length<total&&<Button className="w-full" variant="outline" onClick={()=>void load(cursor,true)} disabled={loadingMore!==null}>{loadingMore==="disputes"?t("جاري التحميل...","Loading..."):t("تحميل نزاعات أقدم","Load Older Disputes")}</Button>}</div><Card className="p-5">{selected?<div className="space-y-4"><div><div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-semibold">{selected.category}</h2><Badge>{selected.status}</Badge></div><p className="mt-3 whitespace-pre-wrap text-sm">{selected.description}</p><p className="mt-2 text-sm text-muted-foreground">{t("النتيجة المطلوبة","Requested outcome")}: {selected.requested_resolution}</p><p className="mt-2 text-xs text-muted-foreground">{t("الرصيد المجمد","Held provider balance")}: {selected.ledger_hold_amount} SAR</p></div><div className="space-y-2 border-y py-4"><h3 className="font-medium">{t("الأدلة الخاصة","Private Evidence")}</h3>{evidenceError&&<LoadErrorCard title={t("تعذر تحميل الأدلة","Could not load evidence")} description={evidenceError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>setEvidenceReloadKey((key)=>key+1)} />}{!evidenceError&&evidence.length===0?<p className="text-sm text-muted-foreground">{t("لا توجد أدلة","No evidence")}</p>:evidence.map((item)=>item.signedUrl?<a key={item.id} href={item.signedUrl} target="_blank" rel="noreferrer noopener" className="block rounded border p-2 text-sm text-primary hover:underline">{item.storage_path.split("/").at(-1)}{item.description&&<span className="ms-2 text-muted-foreground">{item.description}</span>}</a>:<div key={item.id} className="rounded border p-2 text-sm text-muted-foreground">{item.storage_path.split("/").at(-1)} · {t("الرابط غير متاح","Link unavailable")}</div>)}{evidenceCursor&&evidence.length<evidenceTotal&&<Button className="w-full" size="sm" variant="outline" onClick={()=>void loadMoreEvidence()} disabled={loadingMore!==null}>{loadingMore==="evidence"?t("جاري التحميل...","Loading..."):t("تحميل أدلة إضافية","Load More Evidence")}</Button>}</div>{["open","under_review"].includes(selected.status)?<div className="space-y-3"><Select value={action} onValueChange={(value)=>setAction(value as typeof action)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="under_review">under_review</SelectItem><SelectItem value="continue_order">continue_order</SelectItem><SelectItem value="refund">refund</SelectItem><SelectItem value="closed_no_action">closed_no_action</SelectItem></SelectContent></Select>{action==="refund"&&<Input type="number" min="1" step="0.01" value={refundAmount} onChange={(event)=>setRefundAmount(event.target.value)} placeholder={t("مبلغ الاسترداد","Refund amount")} />}<Textarea value={note} maxLength={2000} rows={4} onChange={(event)=>setNote(event.target.value)} placeholder={t("سبب القرار لسجل التدقيق...","Decision reason for the audit log...")} /><Button onClick={()=>void submit()} disabled={processing||note.trim().length<3||(action==="refund"&&(!Number.isFinite(Number(refundAmount))||Number(refundAmount)<1))}>{processing?t("جاري الحفظ...","Saving..."):t("حفظ القرار","Save Decision")}</Button></div>:<div className="rounded bg-muted p-3 text-sm">{selected.resolution_note||selected.resolution}</div>}</div>:<div className="flex h-56 items-center justify-center text-muted-foreground">{t("اختر نزاعاً","Select a dispute")}</div>}</Card></div></div>}
  </div>
}
