"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import {
  executeRefundRequest,getAdminRefundRequests,reviewRefundRequest,
  type AdminRefundFilter,type RefundRequest,type RefundRequestCursor,
} from "@/app/actions/refunds"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"

const filters:AdminRefundFilter[]=["active","requested","approved","processing","unknown","succeeded","failed","rejected","cancelled","all"]
const filterLabels:Record<AdminRefundFilter,[string,string]>={
  active:["المفتوحة","Active"],requested:["المطلوبة","Requested"],approved:["المعتمدة","Approved"],
  processing:["قيد التنفيذ","Processing"],unknown:["غير المعروفة","Unknown"],succeeded:["المكتملة","Succeeded"],
  failed:["الفاشلة","Failed"],rejected:["المرفوضة","Rejected"],cancelled:["الملغاة","Cancelled"],all:["الكل","All"],
}

export default function AdminRefundsPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [refunds, setRefunds] = useState<RefundRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter,setFilter]=useState<AdminRefundFilter>("active")
  const [cursor,setCursor]=useState<RefundRequestCursor|null>(null)
  const [total,setTotal]=useState(0)
  const [openCount,setOpenCount]=useState(0)
  const [loadingMore,setLoadingMore]=useState(false)
  const requestVersion=useRef(0)
  const [reviewing, setReviewing] = useState<{ refund: RefundRequest; decision: "approved" | "rejected" } | null>(null)
  const [note, setNote] = useState("")
  const [processing, setProcessing] = useState(false)
  const [executingId, setExecutingId] = useState<string | null>(null)

  const load = async (pageCursor:RefundRequestCursor|null=null,append=false) => {
    const version=append?requestVersion.current:++requestVersion.current
    if(append)setLoadingMore(true);else{setLoading(true);setLoadingMore(false)}
    const result = await getAdminRefundRequests(filter,pageCursor)
    if(version!==requestVersion.current)return
    if (result.success) {
      setRefunds((current)=>append?[...current,...result.data.refunds.filter((refund)=>!current.some((item)=>item.id===refund.id))]:result.data.refunds)
      setCursor(result.data.nextCursor);if(!append||result.data.refunds.length>0)setTotal(result.data.total)
      setOpenCount(result.data.openCount);setLoadError(null)
    } else {
      if(!append)setLoadError(result.error)
      toast({ title: t("تعذر تحميل طلبات الاسترداد", "Could not load refund queue"), description: result.error, variant: "destructive" })
    }
    if(append)setLoadingMore(false);else setLoading(false)
  }
  useEffect(() => { void load() }, [filter])

  const review = async () => {
    if (!reviewing) return
    setProcessing(true)
    const result = await reviewRefundRequest(reviewing.refund.id, reviewing.decision, note)
    if (result.success) {
      setReviewing(null)
      setNote("")
      toast({ title: t("تم حفظ قرار الاسترداد", "Refund decision saved") })
      await load()
    } else toast({ title: t("تعذر حفظ القرار", "Could not save decision"), description: result.error, variant: "destructive" })
    setProcessing(false)
  }

  const execute = async (refundId: string) => {
    setExecutingId(refundId)
    const result = await executeRefundRequest(refundId)
    if (result.success) {
      toast({ title: t("تم تحديث نتيجة الاسترداد", "Refund result updated"), description: result.data.status })
      await load()
    } else toast({ title: t("تعذر تنفيذ الاسترداد", "Could not execute refund"), description: result.error, variant: "destructive" })
    setExecutingId(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">{t("طلبات الاسترداد", "Refund Requests")} {openCount>0&&<Badge variant="destructive" className="ms-2">{openCount} {t("مفتوح","open")}</Badge>}</h1><p className="mt-1 text-muted-foreground">{t("مراجعة المبلغ والسبب قبل إدخاله في قائمة التنفيذ", "Review amount and reason before placing a refund in the execution queue")}</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{t("تحديث", "Refresh")}</Button></div>
      <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">{t("الموافقة تحجز المبلغ فقط. زر التنفيذ يستدعي Tap حصراً عندما يكون TAP_REFUNDS_ENABLED=true؛ حالات PENDING وACCEPTED وUNKNOWN وTIMED_OUT تبقى مجمدة حتى المصالحة، ولا تعرض approved كاسترداد مكتمل.", "Approval only reserves the amount. Execute calls Tap only when TAP_REFUNDS_ENABLED=true; PENDING, ACCEPTED, UNKNOWN, and TIMED_OUT remain reserved until reconciliation, and approved is never shown as completed.")}</Card>
      <div className="flex flex-wrap items-center gap-2">{filters.map((value)=><Button key={value} size="sm" variant={filter===value?"default":"outline"} onClick={()=>setFilter(value)}>{t(filterLabels[value][0],filterLabels[value][1])}</Button>)}<span className="ms-auto text-sm text-muted-foreground">{refunds.length} / {total}</span></div>
      {loading ? <div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div> : loadError&&refunds.length===0 ? <LoadErrorCard title={t("تعذر تحميل طلبات الاسترداد","Could not load refund queue")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()} /> : refunds.length === 0 ? <Card className="p-10 text-center text-muted-foreground">{t("لا توجد طلبات", "No refund requests")}</Card> : <div className="space-y-3">{loadError&&<LoadErrorCard title={t("تعذر تحديث طلبات الاسترداد","Could not refresh refund queue")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()} />}{refunds.map((refund) => <Card key={refund.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-1"><h2 className="font-semibold">{language === "ar" ? refund.order?.service_name_ar : refund.order?.service_name_en}</h2><p className="text-sm">{refund.amount} {refund.currency} <span className="text-muted-foreground">({refund.provider_amount} provider / {refund.platform_amount} platform)</span></p><p className="text-sm text-muted-foreground">{refund.reason}</p><p className="font-mono text-xs text-muted-foreground">Order {refund.order_id} · Charge {refund.charge_id}</p><p className="text-xs text-muted-foreground">{refund.requester?.full_name || refund.requester?.email || refund.requester_id}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant={refund.status === "rejected" || refund.status === "failed" ? "destructive" : "secondary"}>{refund.status}</Badge>{refund.status === "requested" && <><Button size="sm" onClick={() => { setReviewing({ refund, decision: "approved" }); setNote("") }}>{t("موافقة", "Approve")}</Button><Button size="sm" variant="destructive" onClick={() => { setReviewing({ refund, decision: "rejected" }); setNote("") }}>{t("رفض", "Reject")}</Button></>}{["approved", "processing", "unknown"].includes(refund.status) && <Button size="sm" onClick={() => void execute(refund.id)} disabled={executingId === refund.id}>{executingId === refund.id ? t("جاري الفحص...", "Checking...") : refund.status === "approved" ? t("تنفيذ", "Execute") : t("مصالحـة", "Reconcile")}</Button>}</div></div></Card>)}</div>}
      {cursor&&refunds.length<total&&<div className="text-center"><Button variant="outline" onClick={()=>void load(cursor,true)} disabled={loadingMore}>{loadingMore?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Requests")}</Button></div>}

      <Dialog open={!!reviewing} onOpenChange={(open) => !open && !processing && setReviewing(null)}>{reviewing && <DialogContent><DialogHeader><DialogTitle>{reviewing.decision === "approved" ? t("الموافقة على الاسترداد", "Approve Refund") : t("رفض الاسترداد", "Reject Refund")}</DialogTitle></DialogHeader><div><label htmlFor="refund-review-note" className="mb-1.5 block text-sm font-medium">{t("ملاحظة المراجعة", "Review Note")}</label><Textarea id="refund-review-note" value={note} maxLength={1000} rows={4} onChange={(event) => setNote(event.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setReviewing(null)} disabled={processing}>{t("إلغاء", "Cancel")}</Button><Button variant={reviewing.decision === "approved" ? "default" : "destructive"} onClick={() => void review()} disabled={processing || note.trim().length < 3}>{processing ? t("جاري الحفظ...", "Saving...") : t("حفظ القرار", "Save Decision")}</Button></DialogFooter></DialogContent>}</Dialog>
    </div>
  )
}
