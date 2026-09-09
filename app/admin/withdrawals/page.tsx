"use client"

import { useEffect, useRef, useState } from "react"
import { useLanguage } from "@/components/language-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { CheckCircle, XCircle, Clock, DollarSign } from "lucide-react"
import {
  beginPayoutTracking,
  getAdminWithdrawalPage,
  recordPayoutTrackingResult,
  reviewWithdrawal,
  type AdminWithdrawalCursor,
  type AdminWithdrawalFilter,
  type AdminWithdrawalRow,
} from "@/app/actions/admin"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"
import { formatCurrency } from "@/lib/tap"

const filterOptions:AdminWithdrawalFilter[] = ["all", "pending", "approved", "processing", "unknown", "paid", "failed", "completed", "rejected"]

const statusConfig: Record<string, { label: [string, string]; className: string }> = {
  pending: { label: ["معلق", "Pending"], className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  approved: { label: ["مقبول", "Approved"], className: "bg-blue-100 text-blue-700 border-blue-200" },
  completed: { label: ["مكتمل", "Completed"], className: "bg-green-100 text-green-700 border-green-200" },
  processing: { label: ["قيد التتبع", "Tracking"], className: "bg-blue-100 text-blue-700 border-blue-200" },
  unknown: { label: ["نتيجة غير معروفة", "Unknown Result"], className: "bg-orange-100 text-orange-700 border-orange-200" },
  paid: { label: ["تم الدفع", "Paid Out"], className: "bg-green-100 text-green-700 border-green-200" },
  failed: { label: ["فشل", "Failed"], className: "bg-red-100 text-red-700 border-red-200" },
  rejected: { label: ["مرفوض", "Rejected"], className: "bg-red-100 text-red-700 border-red-200" },
}

export default function AdminWithdrawalsPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore,setLoadingMore]=useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<AdminWithdrawalFilter>("pending")
  const [cursor,setCursor]=useState<AdminWithdrawalCursor|null>(null)
  const [total,setTotal]=useState(0)
  const [pendingCount,setPendingCount]=useState(0)
  const requestVersion=useRef(0)
  const [actionDialog, setActionDialog] = useState<{ row: AdminWithdrawalRow; type: "approve" | "reject" } | null>(null)
  const [notes, setNotes] = useState("")
  const [processing, setProcessing] = useState(false)
  const [payoutDialog, setPayoutDialog] = useState<{ row: AdminWithdrawalRow; mode: "begin" | "result" } | null>(null)
  const [payoutMethod, setPayoutMethod] = useState<"tap_auto" | "tap_dashboard">("tap_dashboard")
  const [externalReference, setExternalReference] = useState("")
  const [payoutResult, setPayoutResult] = useState<"paid" | "failed" | "unknown">("unknown")
  const [evidenceReference, setEvidenceReference] = useState("")
  const [payoutNote, setPayoutNote] = useState("")

  async function fetchWithdrawals(pageCursor:AdminWithdrawalCursor|null=null,append=false){
    const version=append?requestVersion.current:++requestVersion.current
    if(append)setLoadingMore(true);else{setLoading(true);setLoadingMore(false);setLoadError(null)}
    const result=await getAdminWithdrawalPage(filter,pageCursor)
    if(version!==requestVersion.current)return
    if(!result.success){
      if(!append)setLoadError(result.error)
      toast({title:t("تعذر تحميل طلبات السحب","Could not load withdrawals"),description:result.error,variant:"destructive"})
    }else{
      setWithdrawals((current)=>append?[...current,...result.data.withdrawals.filter((row)=>!current.some((item)=>item.id===row.id))]:result.data.withdrawals)
      setCursor(result.data.nextCursor)
      if(!append||result.data.withdrawals.length>0)setTotal(result.data.total)
      setPendingCount(result.data.pendingCount)
      setLoadError(null)
    }
    if(append)setLoadingMore(false);else setLoading(false)
  }

  useEffect(()=>{void fetchWithdrawals()},[filter])

  const handleAction = async () => {
    if (!actionDialog) return
    setProcessing(true)
    const newStatus = actionDialog.type === "approve" ? "approved" : "rejected"
    try {
      const result = await reviewWithdrawal(actionDialog.row.id, newStatus, notes)
      if (!result.success) {
        toast({ title: t("فشل الحفظ", "Save failed"), description: result.error, variant: "destructive" })
        return
      }
      setActionDialog(null)
      setNotes("")
      toast({ title: t("تم حفظ قرار السحب", "Withdrawal decision saved") })
      await fetchWithdrawals()
    } finally {
      setProcessing(false)
    }
  }

  const handlePayoutTracking = async () => {
    if (!payoutDialog) return
    setProcessing(true)
    if (payoutDialog.mode === "begin") {
      const result = await beginPayoutTracking(payoutDialog.row.id, payoutMethod, externalReference, payoutNote)
      if (result.success) {
        toast({ title: t("تم بدء تتبع الدفعة", "Payout tracking started") })
        setPayoutDialog(null)
        await fetchWithdrawals()
      } else toast({ title: t("تعذر بدء التتبع", "Could not start tracking"), description: result.error, variant: "destructive" })
    } else {
      const attempt = payoutDialog.row.payout_attempts?.find((item) => ["awaiting_external", "processing", "unknown"].includes(item.status))
      if (!attempt) toast({ title: t("لا توجد محاولة نشطة", "No active payout attempt"), variant: "destructive" })
      else {
        const result = await recordPayoutTrackingResult(attempt.id, payoutResult, evidenceReference, payoutNote)
        if (result.success) {
          toast({ title: t("تم حفظ نتيجة الدفعة", "Payout result saved") })
          setPayoutDialog(null)
          await fetchWithdrawals()
        } else toast({ title: t("تعذر حفظ النتيجة", "Could not save result"), description: result.error, variant: "destructive" })
      }
    }
    setProcessing(false)
  }

  const filterLabels: Record<AdminWithdrawalFilter, [string, string]> = {
    all: ["الكل", "All"],
    pending: ["معلق", "Pending"],
    approved: ["مقبول", "Approved"],
    processing: ["قيد التتبع", "Tracking"],
    unknown: ["نتيجة غير معروفة", "Unknown"],
    paid: ["تم الدفع", "Paid Out"],
    failed: ["فشل", "Failed"],
    completed: ["مكتمل", "Completed"],
    rejected: ["مرفوض", "Rejected"],
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
      </div>
    )
  }

  if(loadError){return <LoadErrorCard title={t("تعذر تحميل طلبات السحب","Could not load withdrawals")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void fetchWithdrawals()} />}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("طلبات السحب", "Withdrawal Requests")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("مراجعة وإدارة طلبات سحب الأرباح", "Review and manage earnings withdrawal requests")}
          {pendingCount > 0 && (
            <Badge variant="destructive" className="ms-2">{pendingCount} {t("معلق", "pending")}</Badge>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {filterOptions.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {t(filterLabels[f][0], filterLabels[f][1])}
            {f === "pending" && pendingCount > 0 && (
              <span className="ms-1.5 bg-white/20 text-xs rounded-full px-1.5">{pendingCount}</span>
            )}
          </Button>
        ))}
        <span className="ms-auto text-sm text-muted-foreground">{withdrawals.length} / {total}</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-start px-4 py-3 font-medium">{t("مقدم الخدمة", "Provider")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("المبلغ", "Amount")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("تاريخ الطلب", "Requested")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("تاريخ المعالجة", "Processed")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الملاحظات", "Notes")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الحالة", "Status")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("إجراء", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {t("لا توجد طلبات", "No requests found")}
                  </td>
                </tr>
              ) : withdrawals.map((row) => {
                const providerName = row.providers
                  ? language === "ar" ? row.providers.name_ar : row.providers.name_en
                  : "—"
                const cfg = statusConfig[row.status]
                return (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{providerName}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 font-semibold text-primary">
                        <DollarSign className="h-3.5 w-3.5" />
                        {Number(row.amount || 0).toFixed(2)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(row.requested_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.processed_at
                        ? new Date(row.processed_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[180px]">
                      <span className="line-clamp-1">{row.notes || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={cfg.className}>
                        {t(cfg.label[0], cfg.label[1])}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {row.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => { setActionDialog({ row, type: "approve" }); setNotes("") }}
                          >
                            <CheckCircle className="h-3.5 w-3.5 me-1" />
                            {t("قبول", "Approve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => { setActionDialog({ row, type: "reject" }); setNotes("") }}
                          >
                            <XCircle className="h-3.5 w-3.5 me-1" />
                            {t("رفض", "Reject")}
                          </Button>
                        </div>
                      ) : row.status === "approved" ? (
                        <Button size="sm" onClick={() => { setPayoutDialog({ row, mode: "begin" }); setExternalReference(""); setPayoutNote("") }}>
                          {t("بدء تتبع الدفع", "Track Payout")}
                        </Button>
                      ) : ["processing", "unknown"].includes(row.status) ? (
                        <Button size="sm" variant="outline" onClick={() => { setPayoutDialog({ row, mode: "result" }); setEvidenceReference(""); setPayoutNote(""); setPayoutResult("unknown") }}>
                          {t("تسجيل النتيجة", "Record Result")}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {t("تمت المعالجة", "Processed")}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {cursor&&withdrawals.length<total&&<div className="text-center"><Button variant="outline" onClick={()=>void fetchWithdrawals(cursor,true)} disabled={loadingMore}>{loadingMore?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Requests")}</Button></div>}

      {/* Confirm Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        {actionDialog && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {actionDialog.type === "approve"
                  ? t("تأكيد قبول الطلب", "Confirm Approval")
                  : t("تأكيد رفض الطلب", "Confirm Rejection")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("مقدم الخدمة", "Provider")}</span>
                  <span className="font-medium">
                    {actionDialog.row.providers
                      ? language === "ar" ? actionDialog.row.providers.name_ar : actionDialog.row.providers.name_en
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("المبلغ", "Amount")}</span>
                  <span className="font-bold text-primary">
                    {formatCurrency(Number(actionDialog.row.amount||0),language)}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {t("ملاحظات (اختياري)", "Notes (optional)")}
                </label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("أضف ملاحظة...", "Add a note...")}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setActionDialog(null)}>
                {t("إلغاء", "Cancel")}
              </Button>
              <Button
                variant={actionDialog.type === "approve" ? "default" : "destructive"}
                onClick={handleAction}
                disabled={processing}
              >
                {actionDialog.type === "approve" ? t("تأكيد القبول", "Confirm Approval") : t("تأكيد الرفض", "Confirm Rejection")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!payoutDialog} onOpenChange={(open) => !open && !processing && setPayoutDialog(null)}>
        {payoutDialog && <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{payoutDialog.mode === "begin" ? t("بدء تتبع الدفعة الخارجية", "Start External Payout Tracking") : t("تسجيل نتيجة الدفعة", "Record Payout Result")}</DialogTitle></DialogHeader><div className="space-y-3">{payoutDialog.mode === "begin" ? <><div><label className="mb-1 block text-sm font-medium">{t("طريقة الدفع", "Payout Method")}</label><select className="w-full rounded-md border bg-background p-2" value={payoutMethod} onChange={(event) => setPayoutMethod(event.target.value as typeof payoutMethod)}><option value="tap_dashboard">Tap dashboard</option><option value="tap_auto">Tap automatic payout</option></select></div><div><label className="mb-1 block text-sm font-medium">{t("مرجع Tap الخارجي", "External Tap Reference")}</label><Textarea value={externalReference} onChange={(event) => setExternalReference(event.target.value)} rows={2} /></div></> : <><div><label className="mb-1 block text-sm font-medium">{t("النتيجة", "Result")}</label><select className="w-full rounded-md border bg-background p-2" value={payoutResult} onChange={(event) => setPayoutResult(event.target.value as typeof payoutResult)}><option value="unknown">UNKNOWN</option><option value="paid">PAID_OUT</option><option value="failed">FAILED</option></select></div><div><label className="mb-1 block text-sm font-medium">{t("مرجع دليل المصالحة", "Reconciliation Evidence Reference")}</label><Textarea value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} rows={2} /></div></>}<div><label className="mb-1 block text-sm font-medium">{t("ملاحظة التدقيق", "Audit Note")}</label><Textarea value={payoutNote} onChange={(event) => setPayoutNote(event.target.value)} rows={3} /></div></div><DialogFooter><Button variant="outline" onClick={() => setPayoutDialog(null)} disabled={processing}>{t("إلغاء", "Cancel")}</Button><Button onClick={() => void handlePayoutTracking()} disabled={processing || payoutNote.trim().length < 3 || (payoutDialog.mode === "begin" ? externalReference.trim().length < 3 : evidenceReference.trim().length < 3)}>{processing ? t("جاري الحفظ...", "Saving...") : t("حفظ", "Save")}</Button></DialogFooter></DialogContent>}
      </Dialog>
    </div>
  )
}
