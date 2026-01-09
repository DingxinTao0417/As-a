"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { completeOrder } from "@/app/actions/orders"
import { createConnectAccount, createAccountLink, checkAccountStatus, createPayout } from "@/app/actions/stripe-connect"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Briefcase, CheckCircle, Clock, DollarSign, AlertCircle, LinkIcon } from "lucide-react"

interface Order {
  id: string
  conversation_id: string
  service_name_ar: string
  service_name_en: string
  service_description_ar: string
  service_description_en: string
  amount_cents: number
  provider_amount_cents: number
  status: string
  created_at: string
  paid_at: string
  completed_at: string
  seeker_id: string
  seeker: {
    full_name: string
    email: string
  }
}

export default function DashboardPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [withdrawing, setWithdrawing] = useState(false)
  const [stripeConnected, setStripeConnected] = useState(false)
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null)
  const [connectingStripe, setConnectingStripe] = useState(false)
  const [stats, setStats] = useState({
    activeOrders: 0,
    completedOrders: 0,
    totalEarned: 0,
    pendingEarnings: 0,
  })

  useEffect(() => {
    const fetchData = async () => {
      console.log("[v0] Dashboard: Starting data fetch")

      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      console.log("[v0] Dashboard: User check", { hasUser: !!user, userId: user?.id })

      if (!user) {
        console.log("[v0] Dashboard: No user, redirecting to login")
        router.push("/auth/login")
        return
      }

      const { data: profiles, error: profileError } = await supabase.from("profiles").select("role").eq("id", user.id)

      console.log("[v0] Dashboard: Profile query", { profiles, profileError })

      if (profileError || !profiles || profiles.length === 0) {
        console.log("[v0] Dashboard: Profile error or not found", profileError)
        setAccessDenied(true)
        setLoading(false)
        return
      }

      const profile = profiles[0]

      if (profile?.role !== "provider") {
        console.log("[v0] Dashboard: User is not a provider, role:", profile?.role)
        setAccessDenied(true)
        setLoading(false)
        return
      }

      const { data: providers, error: providerError } = await supabase
        .from("providers")
        .select("id, stripe_account_id, stripe_onboarding_completed")
        .eq("user_id", user.id)

      console.log("[v0] Dashboard: Provider query", { providers, providerError })

      if (providerError || !providers || providers.length === 0) {
        console.log("[v0] Dashboard: Provider not found, redirecting to registration")
        router.push("/register/provider")
        return
      }

      const provider = providers[0]

      setStripeAccountId(provider.stripe_account_id)
      setStripeConnected(!!provider.stripe_onboarding_completed)

      if (provider.stripe_account_id) {
        const statusResult = await checkAccountStatus(provider.stripe_account_id)
        if (statusResult.success && statusResult.isComplete) {
          setStripeConnected(true)
        }
      }

      const { data: ordersData, error: ordersError } = await supabase
        .from("orders")
        .select(`
          id,
          conversation_id,
          service_name_ar,
          service_name_en,
          service_description_ar,
          service_description_en,
          amount_cents,
          provider_amount_cents,
          status,
          created_at,
          paid_at,
          completed_at,
          seeker_id
        `)
        .eq("provider_id", provider.id)
        .order("created_at", { ascending: false })

      if (ordersData) {
        console.log("[v0] Dashboard: All orders data", ordersData)

        const ordersWithSeeker = await Promise.all(
          ordersData.map(async (order) => {
            const { data: seeker } = await supabase
              .from("profiles")
              .select("full_name, email")
              .eq("id", order.seeker_id)
              .single()

            console.log("[v0] Dashboard: Order details", {
              orderId: order.id,
              status: order.status,
              amount: order.provider_amount_cents,
            })

            return {
              ...order,
              seeker: seeker || {
                full_name: "Unknown",
                email: "unknown@example.com",
              },
            }
          }),
        )

        setOrders(ordersWithSeeker)

        const active = ordersWithSeeker.filter(
          (o) => o.status === "paid" || o.status === "pending" || o.status === "awaiting_confirmation",
        ).length
        const completed = ordersWithSeeker.filter((o) => o.status === "completed").length
        const totalEarned =
          ordersWithSeeker
            .filter((o) => o.status === "completed")
            .reduce((sum, o) => sum + (o.provider_amount_cents || 0), 0) / 100
        const pendingEarnings =
          ordersWithSeeker
            .filter((o) => o.status !== "completed" && o.status !== "cancelled")
            .reduce((sum, o) => sum + (o.provider_amount_cents || 0), 0) / 100

        setStats({
          activeOrders: active,
          completedOrders: completed,
          totalEarned,
          pendingEarnings,
        })

        console.log("[v0] Dashboard: Stats calculated", { active, completed, totalEarned, pendingEarnings })
      }

      setLoading(false)
    }

    fetchData()
  }, [router])

  const handleGoToChat = (conversationId: string) => {
    router.push(`/messages?conversation=${conversationId}`)
  }

  const handleCompleteOrder = async (orderId: string) => {
    if (!confirm(t("هل أنت متأكد من إتمام هذا الطلب؟", "Are you sure you want to complete this order?"))) {
      return
    }

    const result = await completeOrder(orderId)
    if (result.success) {
      window.location.reload()
    } else {
      alert(result.error || t("فشل في إتمام الطلب", "Failed to complete order"))
    }
  }

  const handleConnectStripe = async () => {
    setConnectingStripe(true)

    try {
      if (!stripeAccountId) {
        const createResult = await createConnectAccount()
        if (!createResult.success) {
          alert(createResult.error || t("فشل في إنشاء حساب Stripe", "Failed to create Stripe account"))
          setConnectingStripe(false)
          return
        }
        setStripeAccountId(createResult.accountId!)
      }

      const linkResult = await createAccountLink(stripeAccountId!)
      if (!linkResult.success) {
        alert(linkResult.error || t("فشل في إنشاء رابط التسجيل", "Failed to create onboarding link"))
        setConnectingStripe(false)
        return
      }

      window.location.href = linkResult.url!
    } catch (error) {
      console.error("[v0] Error connecting Stripe:", error)
      alert(t("حدث خطأ أثناء الاتصال بـ Stripe", "An error occurred while connecting to Stripe"))
      setConnectingStripe(false)
    }
  }

  const handleWithdraw = async () => {
    if (!stripeConnected) {
      alert(t("يرجى ربط حساب Stripe أولاً", "Please connect your Stripe account first"))
      return
    }

    if (stats.totalEarned <= 0) {
      alert(t("لا توجد أرباح متاحة للسحب", "No earnings available to withdraw"))
      return
    }

    if (
      !confirm(
        t(`هل تريد سحب $${stats.totalEarned.toFixed(2)}؟`, `Do you want to withdraw $${stats.totalEarned.toFixed(2)}?`),
      )
    ) {
      return
    }

    setWithdrawing(true)

    const result = await createPayout(stats.totalEarned)

    if (result.success) {
      alert(
        t(
          "تم إرسال طلب السحب بنجاح! سيتم معالجته خلال 1-3 أيام عمل",
          "Withdrawal request submitted! It will be processed within 1-3 business days",
        ),
      )
      window.location.reload()
    } else {
      alert(result.error || t("فشل في معالجة السحب", "Failed to process withdrawal"))
    }

    setWithdrawing(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center bg-muted/30">
          <Card className="max-w-md mx-4">
            <CardHeader>
              <div className="flex items-center gap-2 text-destructive mb-2">
                <AlertCircle className="h-6 w-6" />
                <CardTitle>{t("الوصول محظور", "Access Denied")}</CardTitle>
              </div>
              <CardDescription>
                {t("هذه الصفحة متاحة فقط لمقدمي الخدمات", "This page is only accessible to service providers")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t(
                  "حسابك الحالي مسجل كباحث عن خدمات. إذا كنت ترغب في تقديم الخدمات، يمكنك التسجيل كمزود خدمة.",
                  "Your current account is registered as a service seeker. If you wish to provide services, you can register as a provider.",
                )}
              </p>
              <div className="flex gap-2">
                <Button onClick={() => router.push("/register/provider")} className="flex-1">
                  {t("التسجيل كمزود خدمة", "Register as Provider")}
                </Button>
                <Button onClick={() => router.push("/")} variant="outline" className="flex-1">
                  {t("العودة للرئيسية", "Go Home")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 bg-muted/30 py-8">
        <div className="container mx-auto px-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">{t("لوحة التحكم", "Provider Dashboard")}</h1>
            <p className="text-muted-foreground">{t("إدارة طلباتك وأرباحك", "Manage your orders and earnings")}</p>
          </div>

          {!stripeConnected && (
            <Card className="mb-6 border-yellow-200 bg-yellow-50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-yellow-600" />
                    <div>
                      <p className="font-semibold text-yellow-900">
                        {t("ربط حساب Stripe مطلوب", "Stripe Account Connection Required")}
                      </p>
                      <p className="text-sm text-yellow-700">
                        {t(
                          "يرجى ربط حساب Stripe لتلقي المدفوعات",
                          "Please connect your Stripe account to receive payments",
                        )}
                      </p>
                    </div>
                  </div>
                  <Button onClick={handleConnectStripe} disabled={connectingStripe}>
                    <LinkIcon className="h-4 w-4 mr-2" />
                    {connectingStripe ? t("جاري الاتصال...", "Connecting...") : t("ربط Stripe", "Connect Stripe")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("الطلبات النشطة", "Active Orders")}</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.activeOrders}</div>
                <p className="text-xs text-muted-foreground">{t("بانتظار الإنجاز", "Awaiting completion")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("الطلبات المكتملة", "Completed Orders")}</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.completedOrders}</div>
                <p className="text-xs text-muted-foreground">{t("بنجاح", "Successfully")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("أرباح معلقة", "Pending Earnings")}</CardTitle>
                <Clock className="h-4 w-4 text-yellow-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">${stats.pendingEarnings.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">{t("بانتظار التأكيد", "Awaiting confirmation")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("إجمالي الأرباح", "Total Earned")}</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">${stats.totalEarned.toFixed(2)}</div>
                <Button
                  size="sm"
                  className="w-full mt-2"
                  onClick={handleWithdraw}
                  disabled={withdrawing || stats.totalEarned <= 0 || !stripeConnected}
                >
                  {withdrawing
                    ? t("جاري المعالجة...", "Processing...")
                    : !stripeConnected
                      ? t("ربط Stripe أولاً", "Connect Stripe First")
                      : t("سحب الأرباح", "Withdraw")}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("طلباتي", "My Orders")}</CardTitle>
              <CardDescription>{t("عرض وإدارة جميع الطلبات", "View and manage all orders")}</CardDescription>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Briefcase className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t("لا توجد طلبات حتى الآن", "No orders yet")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <Card key={order.id}>
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold">
                                {language === "ar" ? order.service_name_ar : order.service_name_en}
                              </h3>
                              <Badge
                                variant={
                                  order.status === "paid"
                                    ? "default"
                                    : order.status === "completed"
                                      ? "secondary"
                                      : "outline"
                                }
                              >
                                {order.status === "paid"
                                  ? t("مدفوع", "Paid")
                                  : order.status === "completed"
                                    ? t("مكتمل", "Completed")
                                    : order.status === "pending"
                                      ? t("معلق", "Pending")
                                      : order.status === "awaiting_confirmation"
                                        ? t("بانتظار تأكيد العميل", "Awaiting client confirmation")
                                        : order.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">
                              {language === "ar" ? order.service_description_ar : order.service_description_en}
                            </p>
                            <div className="flex items-center gap-4 text-sm mb-3">
                              <span className="text-muted-foreground">
                                {t("العميل:", "Client:")} {order.seeker.full_name}
                              </span>
                              <span className="font-semibold text-green-600">
                                {t("ربحك:", "Your earning:")} ${(order.provider_amount_cents / 100).toFixed(2)}
                              </span>
                            </div>
                            {order.completed_at && (
                              <p className="text-xs text-muted-foreground">
                                {t("اكتمل في:", "Completed at:")}{" "}
                                {new Date(order.completed_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleGoToChat(order.conversation_id)}>
                              {t("المحادثة", "Chat")}
                            </Button>
                            {(order.status === "paid" || order.status === "pending") && (
                              <Button size="sm" onClick={() => handleCompleteOrder(order.id)}>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                {t("تسليم العمل", "Deliver Work")}
                              </Button>
                            )}
                            {order.status === "awaiting_confirmation" && (
                              <Badge variant="outline" className="text-yellow-600">
                                {t("بانتظار تأكيد العميل", "Awaiting client confirmation")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  )
}
