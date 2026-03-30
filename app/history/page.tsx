"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { History, Calendar, DollarSign, Star, Edit, Trash2, ExternalLink } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

interface Review {
  id: string
  order_id: string
  rating: number
  comment: string | null
}

interface OrderHistory {
  id: string
  service_id: string | null
  provider_name: string
  provider_avatar: string
  service_name_ar: string
  service_name_en: string
  service_description_ar: string
  service_description_en: string
  amount_cents: number
  status: string
  completed_at: string
  review?: Review
}

export default function HistoryPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<OrderHistory[]>([])
  const [user, setUser] = useState<any>(null)

  // Review state
  const [reviewDialog, setReviewDialog] = useState<{isOpen: boolean, order: OrderHistory | null}>({isOpen: false, order: null})
  const [rating, setRating] = useState(5)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState("")
  const [submittingReview, setSubmittingReview] = useState(false)

  const loadHistory = async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push("/auth/login")
      return
    }

    setUser(user)

    // Fetch confirmed/paid orders for this seeker
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select(`*, providers(name_ar, name_en, avatar_url)`)
      .eq("seeker_id", user.id)
      .in("status", ["completed", "paid"])
      .order("created_at", { ascending: false })

    if (ordersError) {
      console.error("[v0] Error fetching history:", ordersError)
    }

    // Fetch all reviews by this seeker
    const { data: reviewsData } = await supabase
      .from("reviews")
      .select("*")
      .eq("reviewer_id", user.id)

    const reviewMap: Record<string, Review> = {}
    reviewsData?.forEach((r: any) => {
      if (r.order_id) reviewMap[r.order_id] = r
    })

    const formattedHistory = ordersData?.map((item: any) => {
      // Supabase nested relation check
      const provider = Array.isArray(item.providers) ? item.providers[0] : item.providers

      return {
        id: item.id,
        service_id: item.service_id,
        provider_name: language === "ar" ? provider?.name_ar : provider?.name_en,
        provider_avatar: provider?.avatar_url,
        service_name_ar: item.service_name_ar,
        service_name_en: item.service_name_en,
        service_description_ar: item.service_description_ar,
        service_description_en: item.service_description_en,
        amount_cents: item.amount_cents,
        status: item.status,
        completed_at: item.completed_at || item.paid_at || item.created_at,
        review: reviewMap[item.id],
      }
    })

    setHistory(formattedHistory || [])
    setLoading(false)
  }

  useEffect(() => {
    loadHistory()
  }, [router, language])

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
    if (!confirm(t("هل أنت متأكد من حذف التقييم؟", "Are you sure you want to delete this review?"))) return
    
    const supabase = createClient()
    await supabase.from("reviews").delete().eq("id", reviewId)
    loadHistory()
  }

  const handleSaveReview = async () => {
    if (!reviewDialog.order || !user) return
    setSubmittingReview(true)
    
    const supabase = createClient()
    const order = reviewDialog.order

    if (order.review) {
      // Update
      await supabase.from("reviews").update({
        rating,
        comment,
      }).eq("id", order.review.id)
    } else {
      // Insert
      await supabase.from("reviews").insert({
        order_id: order.id,
        service_id: order.service_id,
        reviewer_id: user.id,
        rating,
        comment,
        service_name: language === "ar" ? order.service_name_ar : order.service_name_en,
      })
    }

    setSubmittingReview(false)
    setReviewDialog({ isOpen: false, order: null })
    loadHistory() // refresh
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
              {t("سجل الخدمات", "Service History")}
            </h1>
            <p className="text-muted-foreground mt-2">
              {t("عرض جميع الخدمات التي أنجزتها", "View all services you've completed")}
            </p>
          </div>

          {history.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  {t("لا يوجد سجل خدمات حتى الآن", "No service history yet")}
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
                        <AvatarFallback>{item.provider_name?.charAt(0)}</AvatarFallback>
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
                            <p className="text-sm text-muted-foreground">{item.provider_name}</p>
                          </div>
                          <Badge variant={item.status === "completed" ? "default" : "secondary"}>
                            {item.status === "completed" ? t("مكتمل", "Completed") : t("مدفوع", "Paid")}
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
                              {(item.amount_cents / 100).toFixed(2)}
                            </div>
                          </div>

                          {/* Review Actions */}
                          <div className="flex items-center gap-2">
                            {!item.review ? (
                              <Button size="sm" variant="outline" className="gap-2" onClick={() => openReviewDialog(item)}>
                                <Star className="h-4 w-4" />
                                {t("أضف تقييماً", "Write Review")}
                              </Button>
                            ) : (
                              <>
                                <div className="flex items-center bg-muted px-3 py-1.5 rounded-full text-xs font-medium mr-2">
                                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 mr-1" />
                                  {item.review.rating}/5
                                </div>
                                <Button size="sm" variant="ghost" onClick={() => openReviewDialog(item)}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteReview(item.review!.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Review Dialog */}
      <Dialog open={reviewDialog.isOpen} onOpenChange={(open) => !open && setReviewDialog({isOpen: false, order: null})}>
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
                    className="cursor-pointer p-0.5 transition-transform hover:scale-110"
                  >
                    <Star className={`h-8 w-8 ${
                      star <= (hoverRating || rating)
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
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialog({isOpen: false, order: null})}>
              {t("إلغاء", "Cancel")}
            </Button>
            <Button onClick={handleSaveReview} disabled={submittingReview}>
              {submittingReview ? t("جاري الحفظ...", "Saving...") : t("حفظ", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  )
}
