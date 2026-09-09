"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { History, Calendar, DollarSign, Star, Edit, Trash2, ExternalLink, Undo2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
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
import { deleteOrderReview, saveOrderReview } from "@/app/actions/reviews"
import { getMyOrders } from "@/app/actions/history"

interface Review {
  id: string
  order_id: string
  rating: number
  comment: string | null
}

interface OrderHistory {
  id: string
  service_id: string | null
  provider_name_ar: string
  provider_name_en: string
  provider_avatar: string
  service_name_ar: string
  service_name_en: string
  service_description_ar: string
  service_description_en: string
  amount: number
  status: string
  completed_at: string
  review?: Review
}

export default function HistoryPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<OrderHistory[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Review state
  const [reviewDialog, setReviewDialog] = useState<{ isOpen: boolean, order: OrderHistory | null }>({ isOpen: false, order: null })
  const [rating, setRating] = useState(5)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState("")
  const [submittingReview, setSubmittingReview] = useState(false)
  const [deleteReviewId, setDeleteReviewId] = useState<string | null>(null)
  const { toast } = useToast()

  const loadHistory = async (reset = true) => {
    const nextPage = reset ? 1 : historyPage + 1
    if (reset) setLoading(true)
    else setLoadingMore(true)
    try {
      const result = await getMyOrders(nextPage)
      if (!result.success) {
        if (reset) setLoadError(result.error)
        toast({ title: t("تعذر تحميل الطلبات", "Could not load orders"), description: result.error, variant: "destructive" })
        return
      }
      const orders = result.data.orders as OrderHistory[]
      setHistory((current) => reset ? orders : [...current, ...orders])
      setHistoryPage(nextPage)
      setHistoryTotal(result.data.total)
      if (reset) setLoadError(null)
    } catch {
      const message=t("يرجى المحاولة مرة أخرى", "Please try again")
      if (reset) setLoadError(message)
      toast({ title: t("تعذر تحميل الطلبات", "Could not load orders"), description:message, variant: "destructive" })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [router])

  const openReviewDialog = (order: OrderHistory) => {
    if (order.review) {
      setRating(order.review.rating)
      setComment(order.review.comment || "")
    } else {
      setRating(5)
      setComment("")
    }
    setReviewDialog({ isOpen: true, order })
  }

  const handleDeleteReview = async (reviewId: string) => {
    setDeleteReviewId(reviewId)
  }

  const executeDeleteReview = async () => {
    if (!deleteReviewId) return
    try {
      const result = await deleteOrderReview(deleteReviewId)
      if (!result.success) {
        toast({ title: t("فشل حذف التقييم", "Review deletion failed"), description: result.error, variant: "destructive" })
        return
      }
      setDeleteReviewId(null)
      await loadHistory()
    } catch {
      toast({ title: t("فشل حذف التقييم", "Review deletion failed"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
    }
  }

  const handleSaveReview = async () => {
    if (!reviewDialog.order) return
    setSubmittingReview(true)

    const order = reviewDialog.order
    try {
      const result = await saveOrderReview(order.id, rating, comment)
      if (!result.success) {
        toast({ title: t("فشل في حفظ التقييم", "Failed to save review"), description: result.error, variant: "destructive" })
        return
      }
      setReviewDialog({ isOpen: false, order: null })
      await loadHistory()
    } catch {
      toast({ title: t("فشل في حفظ التقييم", "Failed to save review"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
    } finally {
      setSubmittingReview(false)
    }
  }

  const orderStatus = (status: string) => {
    switch (status) {
      case "pending": return t("بانتظار الدفع", "Pending Payment")
      case "paid": return t("قيد التنفيذ", "In Progress")
      case "awaiting_confirmation": return t("بانتظار تأكيد الاستلام", "Awaiting Approval")
      case "revision_requested": return t("تعديل مطلوب", "Revision Requested")
      case "completed": return t("مكتمل", "Completed")
      case "cancelled": return t("ملغي", "Cancelled")
      case "refunded": return t("مسترد", "Refunded")
      default: return status
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 bg-muted/30 py-8">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="mb-6">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <History className="h-8 w-8" />
              {t("طلباتي", "My Orders")}
            </h1>
            <p className="text-muted-foreground mt-2">
              {t("تابع جميع طلباتك من الدفع حتى التقييم", "Track every order from payment through review")}
            </p>
          </div>

          {loadError ? (
            <Card>
              <CardContent className="py-12 text-center" role="alert">
                <History className="h-12 w-12 mx-auto text-destructive mb-4" />
                <p className="text-lg font-medium">{t("تعذر تحميل الطلبات", "Could not load orders")}</p>
                <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
                <Button variant="outline" className="mt-4" onClick={() => void loadHistory()}>
                  {t("إعادة المحاولة", "Retry")}
                </Button>
              </CardContent>
            </Card>
          ) : history.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  {t("لا توجد طلبات حتى الآن", "No orders yet")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {history.map((item) => (
                <Card key={item.id}>
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row gap-4 items-start">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={item.provider_avatar || "/placeholder.svg"} />
                        <AvatarFallback>{(language === "ar" ? item.provider_name_ar : item.provider_name_en)?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 w-full">
                        <div className="flex flex-col md:flex-row md:items-start justify-between mb-2 gap-2">
                          <div>
                            <h3
                              className={`font-semibold text-lg ${item.service_id ? 'cursor-pointer hover:text-primary transition-colors flex items-center gap-2' : ''}`}
                              onClick={() => item.service_id && router.push(`/services/${item.service_id}`)}
                            >
                              {language === "ar" ? item.service_name_ar : item.service_name_en}
                              {item.service_id && <ExternalLink className="h-4 w-4 text-muted-foreground" />}
                            </h3>
                            <p className="text-sm text-muted-foreground">{language === "ar" ? item.provider_name_ar : item.provider_name_en}</p>
                          </div>
                          <Badge variant={item.status === "completed" ? "default" : "secondary"}>
                            {orderStatus(item.status)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">
                          {language === "ar" ? item.service_description_ar : item.service_description_en}
                        </p>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t pt-4">
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              {new Date(item.completed_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                            </div>
                            <div className="flex items-center gap-1 font-semibold text-primary">
                              <DollarSign className="h-4 w-4" />
                              {Number(item.amount || 0).toFixed(2)}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {["paid", "revision_requested", "awaiting_confirmation", "completed"].includes(item.status) && (
                              <Button size="sm" variant="outline" className="gap-2" onClick={() => router.push(`/refunds?order=${item.id}`)}>
                                <Undo2 className="h-4 w-4" />
                                {t("طلب استرداد", "Request Refund")}
                              </Button>
                            )}
                            {item.status === "completed" && (
                              !item.review ? (
                                <Button size="sm" variant="outline" className="gap-2" onClick={() => openReviewDialog(item)}>
                                  <Star className="h-4 w-4" />
                                  {t("أضف تقييماً", "Write Review")}
                                </Button>
                              ) : (
                                <>
                                  <div className="flex items-center bg-muted px-3 py-1.5 rounded-full text-xs font-medium me-2">
                                    <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 me-1" />
                                    {item.review.rating}/5
                                  </div>
                                  <Button size="sm" variant="ghost" onClick={() => openReviewDialog(item)}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteReview(item.review!.id)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )
                            )}
                          </div>
                        </div>

                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {history.length < historyTotal && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" onClick={() => loadHistory(false)} disabled={loadingMore}>
                    {loadingMore ? t("جاري التحميل...", "Loading...") : t("تحميل طلبات أقدم", "Load Older Orders")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Review Dialog */}
      <Dialog open={reviewDialog.isOpen} onOpenChange={(open) => !open && setReviewDialog({ isOpen: false, order: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewDialog.order?.review ? t("تعديل التقييم", "Edit Review") : t("إضافة تقييم", "Write Review")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">{t("التقييم", "Rating")}</label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    aria-label={`${t("تقييم", "Rate")} ${star} ${t("نجوم", "stars")}`}
                    className="cursor-pointer p-0.5 transition-transform hover:scale-110"
                  >
                    <Star className={`h-8 w-8 ${star <= (hoverRating || rating)
                        ? "fill-yellow-400 text-yellow-400"
                        : "fill-muted text-muted"
                      }`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">{t("التعليق (اختياري)", "Comment (optional)")}</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                rows={4}
                maxLength={5000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialog({ isOpen: false, order: null })}>
              {t("إلغاء", "Cancel")}
            </Button>
            <Button onClick={handleSaveReview} disabled={submittingReview}>
              {submittingReview ? t("جاري الحفظ...", "Saving...") : t("حفظ", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteReviewId} onOpenChange={(open) => !open && setDeleteReviewId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("حذف التقييم", "Delete Review")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("هل أنت متأكد من حذف التقييم؟", "Are you sure you want to delete this review?")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={executeDeleteReview} className="bg-destructive text-destructive-foreground">
              {t("حذف", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  )
}
