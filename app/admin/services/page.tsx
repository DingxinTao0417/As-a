"use client"

import { useEffect, useRef, useState } from "react"
import { useLanguage } from "@/components/language-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Search, CheckCircle, XCircle, Eye, DollarSign, Clock } from "lucide-react"
import { reviewService } from "@/app/actions/admin"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"
import {
  getAdminServicePage,
  type AdminServiceCursor,
  type AdminServiceFilter,
  type AdminServiceRow,
} from "@/app/actions/operations"

const filterOptions:AdminServiceFilter[] = ["pending_review", "approved", "rejected", "suspended", "draft", "all"]

export default function AdminServicesPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [services, setServices] = useState<AdminServiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore,setLoadingMore]=useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<AdminServiceFilter>("pending_review")
  const [search, setSearch] = useState("")
  const [cursor,setCursor]=useState<AdminServiceCursor|null>(null)
  const [total,setTotal]=useState(0)
  const [pendingCount,setPendingCount]=useState(0)
  const requestVersion=useRef(0)
  const [preview, setPreview] = useState<AdminServiceRow | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState("")

  const moderationStatus = (service: AdminServiceRow) => service.moderation_status || (service.is_active ? "approved" : "draft")

  async function fetchServices(pageCursor:AdminServiceCursor|null=null,append=false) {
    const version=append?requestVersion.current:++requestVersion.current
    if(append)setLoadingMore(true);else{setLoading(true);setLoadingMore(false);setLoadError(null)}
    const result=await getAdminServicePage(search,filter,pageCursor)
    if(version!==requestVersion.current)return
    if (!result.success) {
      if(!append)setLoadError(result.error)
      toast({title:t("تعذر تحميل الخدمات","Could not load services"),description:result.error,variant:"destructive"})
    }else{
      setServices((current)=>append?[...current,...result.data.services.filter((service)=>!current.some((item)=>item.id===service.id))]:result.data.services)
      setCursor(result.data.nextCursor);if(!append||result.data.services.length>0)setTotal(result.data.total)
      setPendingCount(result.data.pendingCount);setLoadError(null)
    }
    if(append)setLoadingMore(false);else setLoading(false)
  }

  useEffect(()=>{
    const timeout=window.setTimeout(()=>{void fetchServices()},300)
    return()=>window.clearTimeout(timeout)
  },[search,filter])

  const handleReview = async (
    service: AdminServiceRow,
    decision: "approved" | "rejected" | "suspended",
    note?: string,
  ) => {
    setToggling(service.id)
    try {
      const result = await reviewService(service.id, decision, note)
      if (!result.success) {
        toast({ title: t("فشل الحفظ", "Save failed"), description: result.error, variant: "destructive" })
        return false
      }
      const isActive = decision === "approved"
      setPreview((current) => current?.id === service.id
        ? { ...current, is_active: isActive, moderation_status: decision, moderation_note: note?.trim() || null }
        : current)
      toast({ title: t("تم حفظ قرار المراجعة", "Review decision saved") })
      await fetchServices()
      return true
    } finally {
      setToggling(null)
    }
  }

  const filterLabels: Record<AdminServiceFilter, [string, string]> = {
    all: ["الكل", "All"],
    pending_review: ["بانتظار المراجعة", "Pending Review"],
    approved: ["مقبول", "Approved"],
    rejected: ["مرفوض", "Rejected"],
    suspended: ["موقوف", "Suspended"],
    draft: ["مسودة", "Draft"],
  }

  const statusClass: Record<AdminServiceRow["moderation_status"], string> = {
    draft: "bg-muted text-muted-foreground",
    pending_review: "bg-yellow-100 text-yellow-700 border-yellow-200",
    approved: "bg-green-100 text-green-700 border-green-200",
    rejected: "bg-red-100 text-red-700 border-red-200",
    suspended: "bg-orange-100 text-orange-700 border-orange-200",
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
      </div>
    )
  }

  if(loadError){return <LoadErrorCard title={t("تعذر تحميل الخدمات","Could not load services")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void fetchServices()} />}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("مراجعة الخدمات", "Services Review")} {pendingCount>0&&<Badge variant="destructive" className="ms-2">{pendingCount} {t("بانتظار المراجعة","pending")}</Badge>}</h1>
        <p className="text-muted-foreground mt-1">
          {t("إدارة وتفعيل خدمات مقدمي الخدمة", "Manage and activate provider services")}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          {filterOptions.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {t(filterLabels[f][0], filterLabels[f][1])}
            </Button>
          ))}
        </div>
        <div className="relative ms-auto">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="ps-9 w-56"
            placeholder={t("بحث...", "Search...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground">{services.length} / {total}</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-start px-4 py-3 font-medium">{t("الخدمة", "Service")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("مقدم الخدمة", "Provider")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الفئة", "Category")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("السعر", "Price")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("تاريخ الإنشاء", "Created")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الحالة", "Status")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("إجراء", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {t("لا توجد خدمات", "No services found")}
                  </td>
                </tr>
              ) : services.map((service) => {
                const name = language === "ar" ? service.name_ar : service.name_en
                const providerName = service.providers
                  ? language === "ar" ? service.providers.name_ar : service.providers.name_en
                  : "—"
                return (
                  <tr key={service.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {service.image_urls?.[0] && (
                          <img
                            src={service.image_urls[0]}
                            alt={name}
                            className="w-10 h-10 rounded object-cover shrink-0"
                          />
                        )}
                        <span className="font-medium line-clamp-1">{name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{providerName}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{service.category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-3.5 w-3.5 text-primary" />
                        <span className="font-medium">{service.price}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(service.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={statusClass[moderationStatus(service)]}>
                        {service.is_active ? <CheckCircle className="h-3 w-3 me-1" /> : <XCircle className="h-3 w-3 me-1" />}
                        {t(...filterLabels[moderationStatus(service)])}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setPreview(service); setReviewNote("") }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {(moderationStatus(service) === "pending_review" || moderationStatus(service) === "suspended" || service.is_active) && (
                          <Button
                            size="sm"
                            variant={service.is_active ? "destructive" : "default"}
                            onClick={() => handleReview(service, service.is_active ? "suspended" : "approved")}
                            disabled={toggling === service.id}
                          >
                            {service.is_active ? t("إيقاف", "Suspend") : t("قبول", "Approve")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {cursor&&services.length<total&&<div className="text-center"><Button variant="outline" onClick={()=>void fetchServices(cursor,true)} disabled={loadingMore}>{loadingMore?t("جاري التحميل...","Loading..."):t("تحميل خدمات أقدم","Load Older Services")}</Button></div>}

      {/* Preview Dialog */}
      <Dialog open={!!preview} onOpenChange={() => { setPreview(null); setReviewNote("") }}>
        {preview && (
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {language === "ar" ? preview.name_ar : preview.name_en}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Images */}
              {preview.image_urls?.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {preview.image_urls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`image-${i}`}
                      className="w-32 h-32 rounded object-cover"
                    />
                  ))}
                </div>
              )}
              {/* Details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">{t("الفئة", "Category")}</div>
                  <div className="font-medium">{preview.category}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("السعر", "Price")}</div>
                  <div className="font-medium flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5 text-primary" />
                    {preview.price} ({preview.price_type})
                  </div>
                </div>
                {preview.delivery_time && (
                  <div>
                    <div className="text-muted-foreground">{t("وقت التسليم", "Delivery")}</div>
                    <div className="font-medium flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {preview.delivery_time}
                    </div>
                  </div>
                )}
              </div>
              {/* Description */}
              {(language === "ar" ? preview.description_ar : preview.description_en) && (
                <div>
                  <div className="text-muted-foreground text-sm mb-1">{t("الوصف", "Description")}</div>
                  <p className="text-sm leading-relaxed">
                    {language === "ar" ? preview.description_ar : preview.description_en}
                  </p>
                </div>
              )}
              {/* Features */}
              {preview.features?.length > 0 && (
                <div>
                  <div className="text-muted-foreground text-sm mb-2">{t("المميزات", "Features")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.features.map((f, i) => (
                      <Badge key={i} variant="outline">{f}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {preview.moderation_note && (
                <div className="rounded-md bg-muted p-3 text-sm">
                  <div className="font-medium mb-1">{t("ملاحظة المراجعة", "Review note")}</div>
                  <p className="text-muted-foreground">{preview.moderation_note}</p>
                </div>
              )}
              {/* Action */}
              <div className="pt-3 border-t space-y-3">
                {moderationStatus(preview) === "pending_review" && (
                  <Textarea
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    maxLength={1000}
                    placeholder={t("سبب الرفض أو ملاحظة المراجعة", "Rejection reason or review note")}
                  />
                )}
                <div className="flex justify-end gap-2">
                  {moderationStatus(preview) === "pending_review" && (
                    <Button
                      variant="destructive"
                      disabled={toggling === preview.id || reviewNote.trim().length < 3}
                      onClick={async () => {
                        if (await handleReview(preview, "rejected", reviewNote)) {
                          setPreview(null); setReviewNote("")
                        }
                      }}
                    >
                      {t("رفض مع السبب", "Reject with reason")}
                    </Button>
                  )}
                  {(moderationStatus(preview) === "pending_review" || moderationStatus(preview) === "suspended") && (
                    <Button
                      disabled={toggling === preview.id}
                      onClick={async () => {
                        if (await handleReview(preview, "approved", reviewNote)) {
                          setPreview(null); setReviewNote("")
                        }
                      }}
                    >
                      {t("قبول الخدمة", "Approve Service")}
                    </Button>
                  )}
                  {preview.is_active && (
                    <Button
                      variant="destructive"
                      disabled={toggling === preview.id}
                      onClick={async () => {
                        if (await handleReview(preview, "suspended", reviewNote)) {
                          setPreview(null); setReviewNote("")
                        }
                      }}
                    >
                      {t("إيقاف الخدمة", "Suspend Service")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
