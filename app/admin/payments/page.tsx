"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleAlert, RefreshCw } from "lucide-react"
import {
  getPaymentExceptions,
  getPaymentReconciliationPage,
  recoverPaymentAttemptCharge,
  reconcilePaymentAttempt,
  relinkPaymentEvent,
  retryPaymentEvent,
  type PaymentException,
  type PaymentExceptionCursor,
  type PaymentExceptionFilter,
  type PaymentReconciliationItem,
} from "@/app/actions/admin"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"
import { formatCurrency } from "@/lib/tap"
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export default function AdminPaymentsPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [events, setEvents] = useState<PaymentException[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [eventFilter,setEventFilter]=useState<PaymentExceptionFilter>("all")
  const [eventCursor,setEventCursor]=useState<PaymentExceptionCursor|null>(null)
  const [eventTotal,setEventTotal]=useState(0)
  const [pendingEventCount,setPendingEventCount]=useState(0)
  const [quarantinedEventCount,setQuarantinedEventCount]=useState(0)
  const [loadingMoreEvents,setLoadingMoreEvents]=useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [attempts,setAttempts]=useState<PaymentReconciliationItem[]>([])
  const [attemptCursor,setAttemptCursor]=useState<{updatedAt:string;id:string}|null>(null)
  const [attemptTotal,setAttemptTotal]=useState(0)
  const [attemptLoadError,setAttemptLoadError]=useState<string|null>(null)
  const [loadingMoreAttempts,setLoadingMoreAttempts]=useState(false)
  const [reconciling,setReconciling]=useState<string|null>(null)
  const [relinkingEvent,setRelinkingEvent]=useState<PaymentException|null>(null)
  const [relinkOrderId,setRelinkOrderId]=useState("")
  const [relinkAttemptId,setRelinkAttemptId]=useState("")
  const [relinkReason,setRelinkReason]=useState("")
  const [savingRelink,setSavingRelink]=useState(false)
  const [recoveringAttempt,setRecoveringAttempt]=useState<PaymentReconciliationItem|null>(null)
  const [recoveryChargeId,setRecoveryChargeId]=useState("")
  const [recoveryReason,setRecoveryReason]=useState("")
  const [savingRecovery,setSavingRecovery]=useState(false)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    const [result,attemptResult] = await Promise.all([getPaymentExceptions(eventFilter),getPaymentReconciliationPage()])
    if (result.success) {
      setEvents(result.data.events);setEventCursor(result.data.nextCursor);setEventTotal(result.data.total)
      setPendingEventCount(result.data.pendingCount);setQuarantinedEventCount(result.data.quarantinedCount)
      setLoadError(null)
    } else {
      setLoadError(result.error)
      toast({
        title: t("تعذر تحميل استثناءات الدفع", "Could not load payment exceptions"),
        description: result.error,
        variant: "destructive",
      })
    }
    if(attemptResult.success){
      setAttempts(attemptResult.data.attempts);setAttemptTotal(attemptResult.data.total)
      setAttemptCursor(attemptResult.data.nextCursor);setAttemptLoadError(null)
    }else{
      setAttemptLoadError(attemptResult.error)
      toast({title:t("تعذر تحميل محاولات الدفع المفتوحة","Could not load open payment attempts"),description:attemptResult.error,variant:"destructive"})
    }
    setLoading(false)
  }, [t, toast,eventFilter])

  useEffect(() => { void loadEvents() }, [loadEvents])

  const retry = async (eventId: string) => {
    setRetrying(eventId)
    const result = await retryPaymentEvent(eventId)
    if (result.success) {
      toast({ title: t("تمت معالجة الحدث", "Payment event processed") })
      await loadEvents()
    } else {
      toast({ title: t("تعذرت المعالجة", "Processing failed"), description: result.error, variant: "destructive" })
    }
    setRetrying(null)
  }

  const loadMoreAttempts=async()=>{
    if(!attemptCursor||loadingMoreAttempts)return
    setLoadingMoreAttempts(true)
    const result=await getPaymentReconciliationPage(attemptCursor)
    if(result.success){
      setAttempts((current)=>[...current,...result.data.attempts.filter((attempt)=>!current.some((existing)=>existing.id===attempt.id))])
      setAttemptCursor(result.data.nextCursor);setAttemptTotal(result.data.total);setAttemptLoadError(null)
    }else{setAttemptLoadError(result.error);toast({title:t("تعذر تحميل محاولات أقدم","Could not load older attempts"),description:result.error,variant:"destructive"})}
    setLoadingMoreAttempts(false)
  }

  const loadMoreEvents=async()=>{
    if(!eventCursor||loadingMoreEvents)return
    setLoadingMoreEvents(true)
    const result=await getPaymentExceptions(eventFilter,eventCursor)
    if(result.success){
      setEvents((current)=>[...current,...result.data.events.filter((event)=>!current.some((item)=>item.id===event.id))])
      setEventCursor(result.data.nextCursor);setEventTotal(result.data.total)
      setPendingEventCount(result.data.pendingCount);setQuarantinedEventCount(result.data.quarantinedCount);setLoadError(null)
    }else{setLoadError(result.error);toast({title:t("تعذر تحميل أحداث أقدم","Could not load older events"),description:result.error,variant:"destructive"})}
    setLoadingMoreEvents(false)
  }

  const reconcile=async(attemptId:string)=>{
    setReconciling(attemptId)
    const result=await reconcilePaymentAttempt(attemptId)
    if(result.success){toast({title:t("تم تحديث محاولة الدفع","Payment attempt updated"),description:result.data.externalStatus});await loadEvents()}
    else toast({title:t("تعذرت المصالحة","Reconciliation failed"),description:result.error,variant:"destructive"})
    setReconciling(null)
  }

  const openRelink=(event:PaymentException)=>{
    setRelinkingEvent(event)
    setRelinkOrderId(event.linked_order_id||event.claimed_order_id||"")
    setRelinkAttemptId(event.linked_payment_attempt_id||event.claimed_payment_attempt_id||"")
    setRelinkReason("")
  }

  const saveRelink=async()=>{
    if(!relinkingEvent)return
    setSavingRelink(true)
    const result=await relinkPaymentEvent(relinkingEvent.id,relinkOrderId,relinkAttemptId,relinkReason)
    if(result.success){setRelinkingEvent(null);toast({title:t("تمت إعادة معالجة الحدث","Payment event relinked and processed")});await loadEvents()}
    else toast({title:t("تعذر ربط الحدث بأمان","Could not safely relink the event"),description:result.error,variant:"destructive"})
    setSavingRelink(false)
  }

  const openRecovery=(attempt:PaymentReconciliationItem)=>{
    setRecoveringAttempt(attempt);setRecoveryChargeId("");setRecoveryReason("")
  }
  const saveRecovery=async()=>{
    if(!recoveringAttempt)return
    setSavingRecovery(true)
    const result=await recoverPaymentAttemptCharge(recoveringAttempt.id,recoveryChargeId.trim(),recoveryReason)
    if(result.success){
      setRecoveringAttempt(null)
      toast({title:t("تم استرداد محاولة الدفع","Payment attempt recovered"),description:result.data.externalStatus})
      await loadEvents()
    }else toast({title:t("تعذر استرداد محاولة الدفع","Payment recovery failed"),description:result.error,variant:"destructive"})
    setSavingRecovery(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("استثناءات الدفع", "Payment Exceptions")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("أحداث الدفع المعلقة أو التي تحتاج إلى تسوية يدوية", "Payment events that are pending or require manual reconciliation")}
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadEvents()} disabled={loading}>
          <RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("تحديث", "Refresh")}
        </Button>
      </div>

      <section className="space-y-3" aria-labelledby="open-payment-attempts">
        <div><h2 id="open-payment-attempts" className="text-lg font-semibold">{t("محاولات دفع تنتظر نتيجة","Payment Attempts Awaiting a Result")}</h2><p className="text-sm text-muted-foreground">{t("تعرض جميع المحاولات المفتوحة من الأقدم. المصالحة تستعلم عن Charge المسجل ولا تنشئ دفعة جديدة.","Shows every open attempt, oldest first. Reconciliation retrieves the recorded Charge and never creates a new payment.")}</p></div>
        {loading?<div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div>:attemptLoadError&&attempts.length===0?<LoadErrorCard title={t("تعذر تحميل محاولات الدفع","Could not load payment attempts")} description={attemptLoadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadEvents()} />:attempts.length===0?<Card className="p-8 text-center text-muted-foreground">{t("لا توجد محاولات دفع مفتوحة","No open payment attempts")}</Card>:<><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/50"><th className="px-4 py-3 text-start">{t("آخر تحديث","Updated")}</th><th className="px-4 py-3 text-start">{t("الطلب","Order")}</th><th className="px-4 py-3 text-start">Charge</th><th className="px-4 py-3 text-start">{t("المبلغ","Amount")}</th><th className="px-4 py-3 text-start">{t("الحالة","Status")}</th><th className="px-4 py-3 text-start">{t("آخر حدث","Latest Event")}</th><th className="px-4 py-3 text-start">{t("إجراء","Action")}</th></tr></thead><tbody>{attempts.map((attempt)=><tr key={attempt.id} className="border-b last:border-0"><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(attempt.updated_at).toLocaleString(language==="ar"?"ar-SA":"en-US")}</td><td className="px-4 py-3"><div>{language==="ar"?attempt.service_name_ar:attempt.service_name_en}</div><div className="font-mono text-xs text-muted-foreground">{attempt.order_id}</div></td><td className="px-4 py-3 font-mono text-xs">{attempt.external_charge_id||"—"}</td><td className="whitespace-nowrap px-4 py-3">{formatCurrency(Number(attempt.amount),language)}</td><td className="px-4 py-3"><Badge variant={attempt.status==="unknown"?"destructive":"secondary"}>{attempt.status}</Badge></td><td className="max-w-xs px-4 py-3 text-muted-foreground">{attempt.last_event_result||attempt.last_event_status||t("لا يوجد حدث","No event")}</td><td className="px-4 py-3"><Button size="sm" onClick={()=>attempt.external_charge_id?void reconcile(attempt.id):openRecovery(attempt)} disabled={reconciling===attempt.id}>{reconciling===attempt.id?t("جاري الفحص...","Checking..."):attempt.external_charge_id?t("مصالحـة","Reconcile"):t("استرداد Charge","Recover Charge")}</Button></td></tr>)}</tbody></table></div></Card>{attemptLoadError&&<LoadErrorCard title={t("تعذر تحديث المحاولات","Could not refresh attempts")} description={attemptLoadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadEvents()} />}{attemptCursor&&attempts.length<attemptTotal&&<div className="text-center"><Button variant="outline" onClick={()=>void loadMoreAttempts()} disabled={loadingMoreAttempts}>{loadingMoreAttempts?t("جاري التحميل...","Loading..."):t("تحميل محاولات أقدم","Load Older Attempts")}</Button></div>}</>}
      </section>

      <section className="space-y-3" aria-labelledby="payment-events">
        <h2 id="payment-events" className="text-lg font-semibold">{t("أحداث الدفع الاستثنائية","Exceptional Payment Events")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={eventFilter==="all"?"default":"outline"} onClick={()=>setEventFilter("all")}>{t("الكل","All")} ({pendingEventCount+quarantinedEventCount})</Button>
          <Button size="sm" variant={eventFilter==="pending"?"default":"outline"} onClick={()=>setEventFilter("pending")}>{t("بانتظار المعالجة","Pending")} ({pendingEventCount})</Button>
          <Button size="sm" variant={eventFilter==="quarantined"?"default":"outline"} onClick={()=>setEventFilter("quarantined")}>{t("معزولة","Quarantined")} ({quarantinedEventCount})</Button>
          <span className="ms-auto text-sm text-muted-foreground">{events.length} / {eventTotal}</span>
        </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
        </div>
      ) : loadError&&events.length===0 ? (
        <LoadErrorCard title={t("تعذر تحميل استثناءات الدفع","Could not load payment exceptions")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadEvents()} />
      ) : events.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {t("لا توجد استثناءات دفع مفتوحة", "No open payment exceptions")}
        </Card>
      ) : (
        <>{loadError&&<LoadErrorCard title={t("تعذر تحديث استثناءات الدفع","Could not refresh payment exceptions")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadEvents()} />}<Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-start font-medium">{t("الوقت", "Received")}</th>
                  <th className="px-4 py-3 text-start font-medium">Charge</th>
                  <th className="px-4 py-3 text-start font-medium">{t("الطلب", "Order")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("المبلغ", "Amount")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("الحالة", "Status")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("النتيجة", "Result")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("إجراء", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {new Date(event.received_at).toLocaleString(language === "ar" ? "ar-SA" : "en-US")}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{event.external_charge_id}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {event.linked_order_id || event.claimed_order_id || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {event.amount==null?"—":event.currency==="SAR"?formatCurrency(Number(event.amount),language):`${Number(event.amount).toLocaleString(language==="ar"?"ar-SA":"en-US")} ${event.currency||""}`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={event.processing_status === "quarantined" ? "destructive" : "secondary"}>
                          {event.processing_status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{event.external_status}</span>
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-muted-foreground">
                      {event.processing_result || t("بانتظار المعالجة", "Awaiting processing")}
                    </td>
                    <td className="px-4 py-3">
                      {event.processing_status === "pending" ? (
                        <Button size="sm" onClick={() => void retry(event.id)} disabled={retrying === event.id}>
                          <RefreshCw className={`me-1.5 h-3.5 w-3.5 ${retrying === event.id ? "animate-spin" : ""}`} />
                          {t("إعادة المحاولة", "Retry")}
                        </Button>
                      ) : <Button size="sm" variant="outline" onClick={()=>openRelink(event)}><CircleAlert className="me-1.5 h-3.5 w-3.5" />{t("ربط آمن", "Safe Relink")}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>{eventCursor&&events.length<eventTotal&&<div className="text-center"><Button variant="outline" onClick={()=>void loadMoreEvents()} disabled={loadingMoreEvents}>{loadingMoreEvents?t("جاري التحميل...","Loading..."):t("تحميل أحداث أقدم","Load Older Events")}</Button></div>}</>
      )}
      </section>
      <Dialog open={!!recoveringAttempt} onOpenChange={(open)=>!open&&!savingRecovery&&setRecoveringAttempt(null)}>
        {recoveringAttempt&&<DialogContent><DialogHeader><DialogTitle>{t("استرداد Charge مفقود","Recover Missing Charge")}</DialogTitle><DialogDescription>{t("أدخل Charge ID الموجود في Tap فقط. سيقرأ الخادم Charge ويتحقق من الطلب والمحاولة والمبلغ والعملة وmetadata قبل الربط.","Enter only a Charge ID found in Tap. The server retrieves it and verifies the order, attempt, amount, currency, and metadata before linking.")}</DialogDescription></DialogHeader><div className="space-y-4"><div><label htmlFor="payment-recovery-charge" className="mb-1 block text-sm font-medium">Charge ID</label><Input id="payment-recovery-charge" placeholder="chg_..." value={recoveryChargeId} onChange={(event)=>setRecoveryChargeId(event.target.value.trim())} /></div><div><label htmlFor="payment-recovery-reason" className="mb-1 block text-sm font-medium">{t("سبب الاسترداد وسند المراجعة","Recovery reason and review evidence")}</label><Textarea id="payment-recovery-reason" value={recoveryReason} maxLength={1000} rows={4} onChange={(event)=>setRecoveryReason(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={()=>setRecoveringAttempt(null)} disabled={savingRecovery}>{t("إلغاء","Cancel")}</Button><Button onClick={()=>void saveRecovery()} disabled={savingRecovery||!/^chg_[A-Za-z0-9_-]+$/.test(recoveryChargeId)||recoveryReason.trim().length<3}>{savingRecovery?t("جاري التحقق...","Verifying..."):t("تحقق واسترد","Verify and Recover")}</Button></DialogFooter></DialogContent>}
      </Dialog>
      <Dialog open={!!relinkingEvent} onOpenChange={(open)=>!open&&!savingRelink&&setRelinkingEvent(null)}>
        {relinkingEvent&&<DialogContent><DialogHeader><DialogTitle>{t("إعادة ربط حدث الدفع","Relink Payment Event")}</DialogTitle><DialogDescription>{t("لن يُقبل الربط إلا إذا تطابق Charge والمبلغ والعملة مع الطلب والمحاولة. لا يغير هذا النموذج أي مبلغ.","Relinking succeeds only when Charge, amount, and currency match the order and attempt. This form cannot change any amount.")}</DialogDescription></DialogHeader><div className="space-y-4"><div><label htmlFor="payment-relink-order" className="mb-1 block text-sm font-medium">{t("رقم الطلب","Order ID")}</label><Input id="payment-relink-order" value={relinkOrderId} onChange={(event)=>setRelinkOrderId(event.target.value.trim())} /></div><div><label htmlFor="payment-relink-attempt" className="mb-1 block text-sm font-medium">{t("رقم محاولة الدفع","Payment Attempt ID")}</label><Input id="payment-relink-attempt" value={relinkAttemptId} onChange={(event)=>setRelinkAttemptId(event.target.value.trim())} /></div><div><label htmlFor="payment-relink-reason" className="mb-1 block text-sm font-medium">{t("سبب الربط وسند المراجعة","Reason and review evidence")}</label><Textarea id="payment-relink-reason" value={relinkReason} maxLength={1000} rows={4} onChange={(event)=>setRelinkReason(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={()=>setRelinkingEvent(null)} disabled={savingRelink}>{t("إلغاء","Cancel")}</Button><Button onClick={()=>void saveRelink()} disabled={savingRelink||!relinkOrderId||!relinkAttemptId||relinkReason.trim().length<3}>{savingRelink?t("جاري المعالجة...","Processing..."):t("تحقق وأعد المعالجة","Validate and Reprocess")}</Button></DialogFooter></DialogContent>}
      </Dialog>
    </div>
  )
}
