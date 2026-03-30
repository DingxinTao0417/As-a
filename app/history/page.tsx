"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { History, Calendar, DollarSign, Clock, CheckCircle, CreditCard, Loader2, MessageCircle } from "lucide-react"
import Link from "next/link"

interface Order {
  id: string
  provider_id: string
  seeker_id: string
  conversation_id: string
  service_name_ar: string
  service_name_en: string
  service_description_ar: string | null
  service_description_en: string | null
  amount_cents: number
  status: string
  created_at: string
  paid_at: string | null
  completed_at: string | null
  provider?: {
    name_ar: string
    name_en: string
    avatar_url: string | null
  }
}

const getStatusConfig = (status: string, t: (ar: string, en: string) => string) => {
  switch (status) {
    case "pending":
      return {
        label: t("في انتظار الدفع", "Waiting for Payment"),
        variant: "outline" as const,
        icon: CreditCard,
        color: "text-yellow-600",
        bgColor: "bg-yellow-50 border-yellow-200",
      }
    case "paid":
      return {
        label: t("قيد التنفيذ", "In Progress"),
        variant: "secondary" as const,
        icon: Loader2,
        color: "text-blue-600",
        bgColor: "bg-blue-50 border-blue-200",
      }
    case "awaiting_confirmation":
      return {
        label: t("في انتظار التأكيد", "Awaiting Confirmation"),
        variant: "default" as const,
        icon: Clock,
        color: "text-purple-600",
        bgColor: "bg-purple-50 border-purple-200",
      }
    case "completed":
      return {
        label: t("مكتمل", "Completed"),
        variant: "default" as const,
        icon: CheckCircle,
        color: "text-green-600",
        bgColor: "bg-green-50 border-green-200",
      }
    case "cancelled":
      return {
        label: t("ملغي", "Cancelled"),
        variant: "destructive" as const,
        icon: Clock,
        color: "text-red-600",
        bgColor: "bg-red-50 border-red-200",
      }
    default:
      return {
        label: status,
        variant: "outline" as const,
        icon: Clock,
        color: "text-muted-foreground",
        bgColor: "bg-muted/50",
      }
  }
}

export default function HistoryPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<Order[]>([])
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    const loadOrders = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      setUser(user)

      // Get user profile to determine role
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()

      setUserRole(profile?.role || null)

      // Fetch orders based on role
      let query = supabase
        .from("orders")
        .select(`
          *,
          provider:provider_id (
            name_ar,
            name_en,
            avatar_url
          )
        `)
        .order("created_at", { ascending: false })

      // For seekers, show their orders
      // For providers, we need to get their provider IDs first
      if (profile?.role === "provider") {
        const { data: providerProfiles } = await supabase
          .from("providers")
          .select("id")
          .eq("user_id", user.id)

        if (providerProfiles && providerProfiles.length > 0) {
          const providerIds = providerProfiles.map(p => p.id)
          query = query.in("provider_id", providerIds)
        }
      } else {
        query = query.eq("seeker_id", user.id)
      }

      const { data, error } = await query

      if (error) {
        console.error("[v0] Error fetching orders:", error)
      } else {
        setOrders(data || [])
      }

      setLoading(false)
    }

    loadOrders()
  }, [router, language])

  const formatAmount = (amountCents: number) => {
    return (amountCents / 100).toFixed(2)
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
              {t("سجل الطلبات", "Order History")}
            </h1>
            <p className="text-muted-foreground mt-2">
              {userRole === "provider"
                ? t("عرض جميع الطلبات المستلمة", "View all orders you've received")
                : t("عرض جميع الطلبات والخدمات", "View all your orders and services")}
            </p>
          </div>

          {orders.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  {t("لا يوجد طلبات حتى الآن", "No orders yet")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const statusConfig = getStatusConfig(order.status, t)
                const StatusIcon = statusConfig.icon

                return (
                  <Card key={order.id} className={`border ${statusConfig.bgColor}`}>
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={order.provider?.avatar_url || "/placeholder.svg"} />
                          <AvatarFallback>
                            {(language === "ar" ? order.provider?.name_ar : order.provider?.name_en)?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h3 className="font-semibold text-lg">
                                {language === "ar" ? order.service_name_ar : order.service_name_en}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {language === "ar" ? order.provider?.name_ar : order.provider?.name_en}
                              </p>
                            </div>
                            <Badge 
                              variant={statusConfig.variant}
                              className={`flex items-center gap-1 ${statusConfig.color}`}
                            >
                              <StatusIcon className={`h-3 w-3 ${order.status === "paid" ? "animate-spin" : ""}`} />
                              {statusConfig.label}
                            </Badge>
                          </div>
                          
                          {(order.service_description_ar || order.service_description_en) && (
                            <p className="text-sm text-muted-foreground mb-3">
                              {language === "ar" ? order.service_description_ar : order.service_description_en}
                            </p>
                          )}
                          
                          <div className="flex flex-wrap items-center gap-4 text-sm">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              {new Date(order.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                            </div>
                            <div className="flex items-center gap-1 font-semibold">
                              <DollarSign className="h-4 w-4" />
                              {formatAmount(order.amount_cents)} {t("ريال", "SAR")}
                            </div>
                            {order.paid_at && (
                              <div className="flex items-center gap-1 text-green-600">
                                <CheckCircle className="h-4 w-4" />
                                {t("تم الدفع", "Paid")} {new Date(order.paid_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                              </div>
                            )}
                            {order.completed_at && (
                              <div className="flex items-center gap-1 text-green-600">
                                <CheckCircle className="h-4 w-4" />
                                {t("اكتمل", "Completed")} {new Date(order.completed_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                              </div>
                            )}
                          </div>

                          {/* Action button to go to conversation */}
                          <div className="mt-4">
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/messages?conversation=${order.conversation_id}`}>
                                <MessageCircle className="h-4 w-4 mr-2" />
                                {t("عرض المحادثة", "View Conversation")}
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
