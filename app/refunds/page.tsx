"use client"

import { useEffect, useRef, useState } from "react"
import { RotateCcw } from "lucide-react"
import {
  cancelRefundRequest,
  getMyRefundRequests,
  getRefundEligibleOrders,
  requestOrderRefund,
  type RefundOrderCursor,
  type RefundEligibleOrder,
  type RefundRequestCursor,
  type RefundRequest,
} from "@/app/actions/refunds"
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
import { LoadErrorCard } from "@/components/load-error-card"

export default function RefundsPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [orders, setOrders] = useState<RefundEligibleOrder[]>([])
  const [refunds, setRefunds] = useState<RefundRequest[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState("")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [orderCursor,setOrderCursor]=useState<RefundOrderCursor|null>(null)
  const [orderTotal,setOrderTotal]=useState(0)
  const [refundCursor,setRefundCursor]=useState<RefundRequestCursor|null>(null)
  const [refundTotal,setRefundTotal]=useState(0)
  const [loadingMore,setLoadingMore]=useState<"orders"|"refunds"|null>(null)
  const requestId = useRef<string | null>(null)

  const load = async () => {
    setLoading(true)
    const [orderResult, refundResult] = await Promise.all([getRefundEligibleOrders(), getMyRefundRequests()])
    if (!orderResult.success || !refundResult.success) {
      const message=!orderResult.success ? orderResult.error : !refundResult.success ? refundResult.error : t("يرجى المحاولة مرة أخرى","Please try again")
      setLoadError(message)
      toast({ title: t("تعذر تحميل بيانات الاسترداد", "Could not load refund data"), description:message, variant: "destructive" })
      setLoading(false)
      return
    }
    setOrders(orderResult.data.orders);setOrderCursor(orderResult.data.nextCursor);setOrderTotal(orderResult.data.total)
    setRefunds(refundResult.data.refunds);setRefundCursor(refundResult.data.nextCursor);setRefundTotal(refundResult.data.total)
    setLoadError(null)
    const requestedOrder = new URLSearchParams(window.location.search).get("order")
    if (requestedOrder && orderResult.data.orders.some((order) => order.id === requestedOrder)) setSelectedOrderId(requestedOrder)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const selectedOrder = orders.find((order) => order.id === selectedOrderId)
  const remaining = selectedOrder ? Number(selectedOrder.available_refund_amount) : 0

  const loadMoreOrders=async()=>{
    if(!orderCursor||loadingMore)return
    setLoadingMore("orders")
    const result=await getRefundEligibleOrders(orderCursor)
    if(result.success){
      setOrders((current)=>[...current,...result.data.orders.filter((order)=>!current.some((item)=>item.id===order.id))])
      setOrderCursor(result.data.nextCursor);setOrderTotal(result.data.total);setLoadError(null)
    }else{setLoadError(result.error);toast({title:t("تعذر تحميل طلبات أقدم","Could not load older orders"),description:result.error,variant:"destructive"})}
    setLoadingMore(null)
  }

  const loadMoreRefunds=async()=>{
    if(!refundCursor||loadingMore)return
    setLoadingMore("refunds")
    const result=await getMyRefundRequests(refundCursor)
    if(result.success){
      setRefunds((current)=>[...current,...result.data.refunds.filter((refund)=>!current.some((item)=>item.id===refund.id))])
      setRefundCursor(result.data.nextCursor);setRefundTotal(result.data.total);setLoadError(null)
    }else{setLoadError(result.error);toast({title:t("تعذر تحميل طلبات استرداد أقدم","Could not load older refunds"),description:result.error,variant:"destructive"})}
    setLoadingMore(null)
  }

  const submit = async () => {
    const numericAmount = Number(amount)
    if (!requestId.current) requestId.current = crypto.randomUUID()
    setProcessing(true)
    const result = await requestOrderRefund({ orderId: selectedOrderId, clientRequestId: requestId.current, amount: numericAmount, reason })
    if (result.success) {
      setAmount("")
      setReason("")
      requestId.current = null
      toast({ title: t("تم إرسال طلب الاسترداد", "Refund request submitted") })
      await load()
    } else toast({ title: t("تعذر إرسال الطلب", "Could not submit refund"), description: result.error, variant: "destructive" })
    setProcessing(false)
  }

  const cancel = async (refundId: string) => {
    setProcessing(true)
    const result = await cancelRefundRequest(refundId)
    if (result.success) {
      toast({ title: t("تم إلغاء طلب الاسترداد", "Refund request cancelled") })
      await load()
    } else toast({ title: t("تعذر إلغاء الطلب", "Could not cancel refund"), description: result.error, variant: "destructive" })
    setProcessing(false)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-muted/30 py-10">
        <div className="container mx-auto max-w-5xl px-4 space-y-6">
          <div><h1 className="flex items-center gap-2 text-3xl font-bold"><RotateCcw className="h-7 w-7" />{t("طلبات الاسترداد", "Refund Requests")}</h1><p className="mt-2 text-muted-foreground">{t("يمكن طلب استرداد كامل أو جزئي لطلب مدفوع. موافقة الإدارة لا تعني أن التحويل الخارجي اكتمل.", "Request a full or partial refund for a paid order. Administrator approval does not mean the external refund completed.")}</p></div>

          {loading ? <div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div> : loadError&&orders.length===0&&refunds.length===0 ? <LoadErrorCard title={t("تعذر تحميل بيانات الاسترداد","Could not load refund data")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()} /> : <>
            {loadError&&<LoadErrorCard title={t("تعذر تحديث بيانات الاسترداد","Could not refresh refund data")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()} />}
            <Card className="space-y-4 p-5">
              <h2 className="text-lg font-semibold">{t("طلب جديد", "New Request")}</h2>
              <div><label className="mb-1.5 block text-sm font-medium">{t("الطلب", "Order")} <span className="text-muted-foreground">({orders.length}/{orderTotal})</span></label><Select value={selectedOrderId} onValueChange={(value) => { setSelectedOrderId(value); setAmount(""); requestId.current = null }}><SelectTrigger><SelectValue placeholder={t("اختر طلباً مدفوعاً", "Select a paid order")} /></SelectTrigger><SelectContent>{orders.map((order) => <SelectItem key={order.id} value={order.id}>{language === "ar" ? order.service_name_ar : order.service_name_en} · {order.id.slice(0, 8)}</SelectItem>)}</SelectContent></Select>{orderCursor&&orders.length<orderTotal&&<Button className="mt-2" size="sm" variant="outline" onClick={()=>void loadMoreOrders()} disabled={loadingMore!==null}>{loadingMore==="orders"?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Orders")}</Button>}</div>
              {selectedOrder && <p className="text-sm text-muted-foreground">{t("المبلغ المتاح للطلب", "Available to request")}: {remaining.toFixed(2)} {selectedOrder.currency}</p>}
              <div><label htmlFor="refund-amount" className="mb-1.5 block text-sm font-medium">{t("المبلغ", "Amount")}</label><Input id="refund-amount" type="number" min="1" max={remaining || undefined} step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); requestId.current = null }} /></div>
              <div><label htmlFor="refund-reason" className="mb-1.5 block text-sm font-medium">{t("السبب", "Reason")}</label><Textarea id="refund-reason" value={reason} maxLength={2000} rows={4} onChange={(event) => { setReason(event.target.value); requestId.current = null }} /></div>
              <Button onClick={() => void submit()} disabled={processing || !selectedOrder || !Number.isFinite(Number(amount)) || Number(amount) < 1 || Number(amount) > remaining || reason.trim().length < 3}>{processing ? t("جاري الإرسال...", "Submitting...") : t("إرسال طلب الاسترداد", "Submit Refund Request")}</Button>
            </Card>

            <div className="space-y-3"><h2 className="text-lg font-semibold">{t("سجل الطلبات", "Request History")} <span className="text-sm font-normal text-muted-foreground">({refunds.length}/{refundTotal})</span></h2>{refunds.length === 0 ? <Card className="p-8 text-center text-muted-foreground">{t("لا توجد طلبات استرداد", "No refund requests")}</Card> : refunds.map((refund) => <Card key={refund.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{language === "ar" ? refund.order?.service_name_ar : refund.order?.service_name_en}</h3><p className="mt-1 text-sm text-muted-foreground">{refund.amount} {refund.currency} · {refund.reason}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{refund.order_id}</p>{refund.review_note && <p className="mt-2 text-sm">{t("ملاحظة المراجعة", "Review note")}: {refund.review_note}</p>}</div><div className="flex items-center gap-2"><Badge variant={refund.status === "rejected" || refund.status === "failed" ? "destructive" : "secondary"}>{refund.status}</Badge>{refund.status === "requested" && <Button size="sm" variant="outline" onClick={() => void cancel(refund.id)} disabled={processing}>{t("إلغاء", "Cancel")}</Button>}</div></div></Card>)}{refundCursor&&refunds.length<refundTotal&&<div className="text-center"><Button variant="outline" onClick={()=>void loadMoreRefunds()} disabled={loadingMore!==null}>{loadingMore==="refunds"?t("جاري التحميل...","Loading..."):t("تحميل طلبات استرداد أقدم","Load Older Refunds")}</Button></div>}</div>
          </>}
        </div>
      </main>
      <Footer />
    </div>
  )
}
