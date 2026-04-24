"use client"

import { useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { completeOrder } from "@/app/actions/orders"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Briefcase,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  CalendarDays,
  X,
  MessageCircle,
  ReceiptText,
} from "lucide-react"

export interface Order {
  id: string
  conversation_id: string
  service_name_ar: string
  service_name_en: string
  service_description_ar: string
  service_description_en: string
  amount: number
  platform_fee: number
  provider_amount: number
  status: string
  created_at: string
  paid_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  seeker_id: string
  seeker: {
    full_name: string
    email: string
  }
}

type SortField = "created_at" | "amount" | "status" | "service_name"
type SortDir = "asc" | "desc"

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50]
const DEFAULT_PAGE_SIZE = 10

function statusLabel(status: string, t: (ar: string, en: string) => string) {
  switch (status) {
    case "paid":               return t("مدفوع", "Paid")
    case "completed":          return t("مكتمل", "Completed")
    case "pending":            return t("معلق", "Pending")
    case "awaiting_confirmation": return t("بانتظار تأكيد", "Awaiting Confirmation")
    case "cancelled":          return t("ملغي", "Cancelled")
    case "refunded":           return t("مسترد", "Refunded")
    default:                   return status
  }
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "paid":               return "default"
    case "completed":          return "secondary"
    case "cancelled":          return "destructive"
    default:                   return "outline"
  }
}

function formatDate(
  iso: string | null | undefined,
  fallback: string
) {
  if (!iso) return fallback
  const d = new Date(iso)
  const date = d.toISOString().slice(0, 10)
  const time = d.toISOString().slice(11, 16)
  return `${date} ${time}`
}

// ─── Order detail drawer ────────────────────────────────────────────────────

function OrderDetailDialog({
  order,
  open,
  onClose,
  onComplete,
  onChat,
}: {
  order: Order | null
  open: boolean
  onClose: () => void
  onComplete: (id: string) => void
  onChat: (convId: string) => void
}) {
  const { t, language } = useLanguage()
  const fallback = t("—", "—")

  if (!order) return null

  const rows: { label: string; value: string }[] = [
    {
      label: t("رقم الطلب", "Order ID"),
      value: order.id,
    },
    {
      label: t("اسم الخدمة", "Service name"),
      value: language === "ar" ? order.service_name_ar : order.service_name_en,
    },
    {
      label: t("العميل", "Client"),
      value: `${order.seeker.full_name} (${order.seeker.email})`,
    },
    {
      label: t("إجمالي المبلغ", "Total amount"),
      value: `${Number(order.amount || 0).toFixed(2)} SAR`,
    },
    {
      label: t("رسوم المنصة", "Platform fee"),
      value: `${Number(order.platform_fee || 0).toFixed(2)} SAR`,
    },
    {
      label: t("صافي ربحك", "Your earnings"),
      value: `${Number(order.provider_amount || 0).toFixed(2)} SAR`,
    },
    {
      label: t("تاريخ الإنشاء", "Created at"),
      value: formatDate(order.created_at, fallback),
    },
    {
      label: t("تاريخ دفع العميل", "Client paid at"),
      value: formatDate(order.paid_at, fallback),
    },
    {
      label: t("تاريخ إتمام التسليم", "Delivered at"),
      value: formatDate(order.completed_at, fallback),
    },
    {
      label: t("تاريخ الإلغاء", "Cancelled at"),
      value: formatDate(order.cancelled_at, fallback),
    },
    {
      label: t("الحالة", "Status"),
      value: statusLabel(order.status, t),
    },
  ]

  const canDeliver = order.status === "paid"
  const waitingForPayment = order.status === "pending"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-primary" />
            {t("تفاصيل الطلب", "Order Details")}
          </DialogTitle>
        </DialogHeader>

        {/* description */}
        {(order.service_description_ar || order.service_description_en) && (
          <p className="text-sm text-muted-foreground leading-relaxed border-b border-border pb-4">
            {language === "ar" ? order.service_description_ar : order.service_description_en}
          </p>
        )}

        {/* data grid */}
        <dl className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4 py-2.5 text-sm">
              <dt className="text-muted-foreground shrink-0">{row.label}</dt>
              <dd className="font-medium text-foreground text-end break-all">{row.value}</dd>
            </div>
          ))}
        </dl>

        {/* actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => { onClose(); onChat(order.conversation_id) }}
          >
            <MessageCircle className="h-4 w-4 mr-1" />
            {t("المحادثة", "Chat")}
          </Button>
          {canDeliver && (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onComplete(order.id)}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              {t("تسليم العمل", "Deliver Work")}
            </Button>
          )}
          {waitingForPayment && (
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 cursor-not-allowed"
              disabled
              title={t("العميل لم يدفع بعد", "The client has not paid yet")}
            >
              {t("بانتظار الدفع", "Waiting for payment")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function OrdersTable({ orders: rawOrders, onOrderUpdate }: { orders: Order[]; onOrderUpdate?: () => void | Promise<void> }) {
  const { t, language } = useLanguage()
  const router = useRouter()

  // ── filter / sort state ──
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  // ── pagination state ──
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [jumpInput, setJumpInput] = useState("")

  // ── detail dialog ──
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [deliveryOrderId, setDeliveryOrderId] = useState<string | null>(null)
  const [delivering, setDelivering] = useState(false)

  // ── helpers ──
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
    setPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
    return sortDir === "asc"
      ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />
  }

  // ── filtered + sorted data ──
  const processed = useMemo(() => {
    let data = [...rawOrders]

    // search
    if (search.trim()) {
      const q = search.toLowerCase()
      data = data.filter(
        (o) =>
          o.service_name_ar.toLowerCase().includes(q) ||
          o.service_name_en.toLowerCase().includes(q) ||
          o.seeker.full_name.toLowerCase().includes(q) ||
          o.seeker.email.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q),
      )
    }

    // status filter
    if (statusFilter !== "all") {
      data = data.filter((o) => o.status === statusFilter)
    }

    // date range — only apply when value is a valid YYYY-MM-DD
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (dateFrom && dateRe.test(dateFrom)) {
      data = data.filter((o) => new Date(o.created_at) >= new Date(dateFrom))
    }
    if (dateTo && dateRe.test(dateTo)) {
      const toDate = new Date(dateTo)
      toDate.setHours(23, 59, 59, 999)
      data = data.filter((o) => new Date(o.created_at) <= toDate)
    }

    // sort
    data.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case "created_at":
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
        case "amount":
          cmp = a.amount - b.amount
          break
        case "status":
          cmp = a.status.localeCompare(b.status)
          break
        case "service_name":
          cmp = (language === "ar" ? a.service_name_ar : a.service_name_en).localeCompare(
            language === "ar" ? b.service_name_ar : b.service_name_en,
          )
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })

    return data
  }, [rawOrders, search, statusFilter, dateFrom, dateTo, sortField, sortDir, language])

  const totalPages = Math.max(1, Math.ceil(processed.length / pageSize))
  const safeCurrentPage = Math.min(page, totalPages)
  const paginated = processed.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize)

  const resetFilters = () => {
    setSearch("")
    setStatusFilter("all")
    setDateFrom("")
    setDateTo("")
    setPage(1)
  }

  const hasFilters = search || statusFilter !== "all" || dateFrom || dateTo

  // ── actions ──
  const handleGoToChat = useCallback((conversationId: string) => {
    router.push(`/messages?conversation=${conversationId}`)
  }, [router])

  const requestDeliveryConfirmation = useCallback((orderId: string) => {
    setDeliveryOrderId(orderId)
  }, [])

  const handleComplete = useCallback(async () => {
    if (!deliveryOrderId || delivering) return
    setDelivering(true)
    const result = await completeOrder(deliveryOrderId)
    if (result.success) {
      setDeliveryOrderId(null)
      setSelectedOrder(null)
      await onOrderUpdate?.()
    } else {
      alert(result.error)
    }
    setDelivering(false)
  }, [deliveryOrderId, delivering, onOrderUpdate])

  // ── page jump ──
  const handleJump = () => {
    const n = parseInt(jumpInput)
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      setPage(n)
    }
    setJumpInput("")
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("طلباتي", "My Orders")}</CardTitle>
          <CardDescription>
            {t("عرض وإدارة جميع الطلبات", "View and manage all orders")}
            {processed.length !== rawOrders.length && (
              <span className="mr-2 ml-2 text-primary font-medium">
                · {processed.length} {t("نتيجة", "results")}
              </span>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">

          {/* ── Filters bar ── */}
          <div className="flex flex-wrap gap-3">
            {/* search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t("بحث بالاسم أو العميل أو رقم الطلب...", "Search by name, client or order ID...")}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="pr-9"
              />
            </div>

            {/* status filter */}
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("الحالة", "Status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("جميع الحالات", "All statuses")}</SelectItem>
                <SelectItem value="pending">{t("معلق", "Pending")}</SelectItem>
                <SelectItem value="paid">{t("مدفوع", "Paid")}</SelectItem>
                <SelectItem value="awaiting_confirmation">{t("بانتظار تأكيد", "Awaiting Confirmation")}</SelectItem>
                <SelectItem value="completed">{t("مكتمل", "Completed")}</SelectItem>
                <SelectItem value="cancelled">{t("ملغي", "Cancelled")}</SelectItem>
                <SelectItem value="refunded">{t("مسترد", "Refunded")}</SelectItem>
              </SelectContent>
            </Select>

            {/* date from */}
            <div className="relative">
              <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={dateFrom}
                onChange={(e) => {
                  const v = e.target.value
                  setDateFrom(v)
                  if (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)) setPage(1)
                }}
                className="pr-9 w-[148px] placeholder:text-muted-foreground/50"
              />
            </div>

            {/* date to */}
            <div className="relative">
              <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={dateTo}
                onChange={(e) => {
                  const v = e.target.value
                  setDateTo(v)
                  if (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)) setPage(1)
                }}
                className="pr-9 w-[148px] placeholder:text-muted-foreground/50"
              />
            </div>

            {/* clear */}
            {hasFilters && (
              <Button variant="ghost" size="icon" onClick={resetFilters} title={t("مسح الفلاتر", "Clear filters")}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* ── Sort row ── */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-muted-foreground self-center">{t("ترتيب حسب:", "Sort by:")}</span>
            {(
              [
                ["created_at",   t("تاريخ الإنشاء", "Date")],
                ["amount", t("المبلغ", "Amount")],
                ["status",       t("الحالة", "Status")],
                ["service_name", t("اسم الخدمة", "Service")],
              ] as [SortField, string][]
            ).map(([field, label]) => (
              <Button
                key={field}
                variant={sortField === field ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => handleSort(field)}
              >
                {label}
                <SortIcon field={field} />
              </Button>
            ))}
          </div>

          {/* ── Orders list ── */}
          {rawOrders.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Briefcase className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p>{t("لا توجد طلبات حتى الآن", "No orders yet")}</p>
            </div>
          ) : processed.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>{t("لا توجد نتائج مطابقة", "No matching results")}</p>
              <Button variant="link" size="sm" onClick={resetFilters}>
                {t("مسح الفلاتر", "Clear filters")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {paginated.map((order) => {
                const canDeliver = order.status === "paid"
                const waitingForPayment = order.status === "pending"
                return (
                  <Card
                    key={order.id}
                    className="cursor-pointer hover:shadow-md transition-shadow border"
                    onClick={() => setSelectedOrder(order)}
                  >
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {/* name + badge */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="font-semibold text-sm truncate">
                              {language === "ar" ? order.service_name_ar : order.service_name_en}
                            </h3>
                            <Badge variant={statusVariant(order.status)} className="text-xs shrink-0">
                              {statusLabel(order.status, t)}
                            </Badge>
                          </div>

                          {/* description */}
                          {(order.service_description_ar || order.service_description_en) && (
                            <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
                              {language === "ar" ? order.service_description_ar : order.service_description_en}
                            </p>
                          )}

                          {/* meta row */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>{t("العميل:", "Client:")} <span className="text-foreground font-medium">{order.seeker.full_name}</span></span>
                            <span className="font-semibold text-green-600">
                              {t("ربحك:", "Earning:")} {Number(order.provider_amount || 0).toFixed(2)} SAR
                            </span>
                            <span>
                              {new Date(order.created_at).toISOString().slice(0, 10)}
                            </span>
                          </div>
                        </div>

                        {/* actions — stop propagation so card click still works */}
                        <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleGoToChat(order.conversation_id)}
                          >
                            {t("المحادثة", "Chat")}
                          </Button>
                          {canDeliver && (
                            <Button size="sm" onClick={() => requestDeliveryConfirmation(order.id)}>
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />
                              {t("تسليم", "Deliver")}
                            </Button>
                          )}
                          {waitingForPayment && (
                            <span title={t("العميل لم يدفع بعد", "The client has not paid yet")}>
                              <Button size="sm" variant="secondary" disabled className="cursor-not-allowed">
                                {t("بانتظار الدفع", "Waiting for payment")}
                              </Button>
                            </span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* ── Pagination ── */}
          {processed.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">

              {/* page size */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{t("عرض", "Show")}</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}
                >
                  <SelectTrigger className="h-8 w-[70px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>{t("لكل صفحة", "per page")}</span>
              </div>

              {/* page nav */}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>

                {/* page pills */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1)
                  .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…")
                    acc.push(p)
                    return acc
                  }, [])
                  .map((item, idx) =>
                    item === "…" ? (
                      <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground text-sm">…</span>
                    ) : (
                      <Button
                        key={item}
                        variant={safeCurrentPage === item ? "default" : "outline"}
                        size="icon"
                        className="h-8 w-8 text-xs"
                        onClick={() => setPage(item as number)}
                      >
                        {item}
                      </Button>
                    ),
                  )}

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>

              {/* jump to page */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{t("انتقل إلى", "Go to")}</span>
                <Input
                  className="h-8 w-16 text-center"
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJump()}
                  placeholder={String(safeCurrentPage)}
                />
                <Button variant="outline" size="sm" className="h-8" onClick={handleJump}>
                  {t("اذهب", "Go")}
                </Button>
                <span className="text-xs">
                  / {totalPages} {t("صفحة", "pages")}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Detail dialog ── */}
      <OrderDetailDialog
        order={selectedOrder}
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onComplete={requestDeliveryConfirmation}
        onChat={handleGoToChat}
      />

      <AlertDialog open={!!deliveryOrderId} onOpenChange={(open) => !open && !delivering && setDeliveryOrderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("تأكيد تسليم الطلب", "Confirm delivery")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "سيتم إرسال الطلب إلى العميل للتأكيد. لا تستخدم هذا الزر إلا بعد تسليم العمل فعلاً.",
                "This will send the order to the client for confirmation. Only use this after the work has actually been delivered.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delivering}>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void handleComplete() }} disabled={delivering}>
              {delivering ? t("جاري التسليم...", "Delivering...") : t("تأكيد التسليم", "Confirm delivery")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
