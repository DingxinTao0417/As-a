"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
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
import { reviewWithdrawal } from "@/app/actions/admin"

type WithdrawalRow = {
  id: string
  amount: number
  status: "pending" | "approved" | "completed" | "rejected"
  requested_at: string
  processed_at: string | null
  notes: string | null
  providers: {
    name_ar: string
    name_en: string
    avatar_url: string | null
  } | null
}

const filterOptions = ["all", "pending", "approved", "completed", "rejected"] as const
type Filter = typeof filterOptions[number]

const statusConfig: Record<string, { label: [string, string]; className: string }> = {
  pending: { label: ["معلق", "Pending"], className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  approved: { label: ["مقبول", "Approved"], className: "bg-blue-100 text-blue-700 border-blue-200" },
  completed: { label: ["مكتمل", "Completed"], className: "bg-green-100 text-green-700 border-green-200" },
  rejected: { label: ["مرفوض", "Rejected"], className: "bg-red-100 text-red-700 border-red-200" },
}

export default function AdminWithdrawalsPage() {
  const { t, language } = useLanguage()
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>("pending")
  const [actionDialog, setActionDialog] = useState<{ row: WithdrawalRow; type: "approve" | "reject" } | null>(null)
  const [notes, setNotes] = useState("")
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchWithdrawals() {
    try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("withdrawal_requests")
      .select("*, providers(name_ar, name_en, avatar_url)")
      .order("requested_at", { ascending: false })
    if (error) throw error
    setWithdrawals((data as WithdrawalRow[]) || [])
    } catch { setError("Unable to load withdrawals. Please refresh and try again.") }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchWithdrawals() }, [])

  const filtered = withdrawals.filter((w) =>
    filter === "all" ? true : w.status === filter
  )

  const handleAction = async () => {
    if (!actionDialog || processing) return
    setProcessing(true)
    setError(null)
    try {
    const newStatus = actionDialog.type === "approve" ? "completed" : "rejected"
    const result = await reviewWithdrawal(actionDialog.row.id, newStatus, notes.trim())
    if (!result.success) throw new Error(result.error)
    setWithdrawals((prev) =>
      prev.map((w) =>
        w.id === actionDialog.row.id
          ? { ...w, status: newStatus as WithdrawalRow["status"], notes: notes || null, processed_at: new Date().toISOString() }
          : w
      )
    )
    setActionDialog(null)
    setNotes("")
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to review withdrawal.") }
    finally { setProcessing(false) }
  }

  const filterLabels: Record<Filter, [string, string]> = {
    all: ["الكل", "All"],
    pending: ["معلق", "Pending"],
    approved: ["مقبول", "Approved"],
    completed: ["مكتمل", "Completed"],
    rejected: ["مرفوض", "Rejected"],
  }

  const pendingCount = withdrawals.filter((w) => w.status === "pending").length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
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
      <div className="flex flex-wrap gap-2">
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {t("لا توجد طلبات", "No requests found")}
                  </td>
                </tr>
              ) : filtered.map((row) => {
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
                      {row.status === "pending" || row.status === "approved" ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => { setActionDialog({ row, type: "approve" }); setNotes("") }}
                          >
                            <CheckCircle className="h-3.5 w-3.5 me-1" />
                            {t("تأكيد التحويل", "Record transfer")}
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

      {/* Confirm Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(open) => { if (!open && !processing) setActionDialog(null) }}>
        {actionDialog && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {actionDialog.type === "approve"
                  ? t("تأكيد إتمام التحويل البنكي", "Confirm completed bank transfer")
                  : t("تأكيد رفض الطلب", "Confirm Rejection")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              {actionDialog.type === "approve" && <p className="text-sm text-muted-foreground">{t("سجّل الطلب كمكتمل فقط بعد التحقق من تحويل المبلغ إلى مقدم الخدمة. هذه الخطوة لا ترسل الأموال.", "Mark this request completed only after verifying that the provider received the transfer. This action records the transfer and does not send funds.")}</p>}
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
                    {Number(actionDialog.row.amount || 0).toFixed(2)} SAR
                  </span>
                </div>
              </div>
              <div>
                <label htmlFor="withdrawal-notes" className="text-sm font-medium mb-1.5 block">
                  {actionDialog.type === "approve" ? t("مرجع التحويل", "Transfer reference") : t("سبب الرفض", "Reason for rejection")}
                </label>
                <Textarea
                  id="withdrawal-notes"
                  maxLength={1000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("أضف ملاحظة...", "Add a note...")}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" disabled={processing} onClick={() => setActionDialog(null)}>
                {t("إلغاء", "Cancel")}
              </Button>
              <Button
                variant={actionDialog.type === "approve" ? "default" : "destructive"}
                onClick={handleAction}
                disabled={processing || notes.trim().length < 3}
              >
                {actionDialog.type === "approve" ? t("تم التحويل", "Record as paid") : t("تأكيد الرفض", "Confirm Rejection")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
