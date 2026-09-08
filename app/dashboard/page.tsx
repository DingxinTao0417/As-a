"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { createConnectAccount, createAccountLink, checkAccountStatus, createPayout } from "@/app/actions/tap-connect"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Clock, DollarSign, AlertCircle, LinkIcon, CheckCircle } from "lucide-react"
import { OrdersTable, type Order } from "@/components/orders-table"
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


export default function DashboardPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [withdrawing, setWithdrawing] = useState(false)
  const [tapConnected, setTapConnected] = useState(false)
  const [tapDestinationId, setTapDestinationId] = useState<string | null>(null)
  const [connectingTap, setConnectingTap] = useState(false)
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false)
  const [stats, setStats] = useState({
    activeOrders: 0,
    completedOrders: 0,
    totalEarned: 0,
    totalWithdrawn: 0,
    pendingEarnings: 0,
  })

  const fetchData = async () => {
    setLoadError(false)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data: profiles, error: profileError } = await supabase.from("profiles").select("role").eq("id", user.id)

      if (profileError || !profiles || profiles.length === 0) {
        setAccessDenied(true)
        setLoading(false)
        return
      }

      const profile = profiles[0]

      if (profile?.role !== "provider") {
        setAccessDenied(true)
        setLoading(false)
        return
      }

      const { data: providers, error: providerError } = await supabase
        .from("providers")
        .select("id, tap_destination_id, tap_onboarding_completed")
        .eq("user_id", user.id)

      if (providerError || !providers || providers.length === 0) {
        router.push("/register/provider")
        return
      }

      const provider = providers[0]

      setTapDestinationId(provider.tap_destination_id)
      setTapConnected(false)

      if (provider.tap_destination_id) {
        const statusResult = await checkAccountStatus()
        setTapConnected(statusResult.success && statusResult.data.isComplete)
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
          amount,
          platform_fee,
          provider_amount,
          status,
          created_at,
          paid_at,
          completed_at,
          cancelled_at,
          checkout_started_at,
          tap_charge_id,
          seeker_id
        `)
        .eq("provider_id", provider.id)
        .order("created_at", { ascending: false })
      if (ordersError) throw ordersError

      if (ordersData) {        const typedOrders = ordersData as Array<Record<string, any>>
        const seekerIds = [...new Set(typedOrders.map((order) => order.seeker_id).filter(Boolean))]
        const { data: seekers } = seekerIds.length > 0
          ? await supabase.from("public_profiles").select("id, full_name").in("id", seekerIds)
          : { data: [] }
        const seekerMap = new Map((seekers || []).map((seeker: any) => [seeker.id, seeker]))

        const ordersWithSeeker = typedOrders.map((order) => ({
          ...order,
          seeker: seekerMap.get(order.seeker_id) || {
            full_name: "Unknown",
            email: "",
          },
        })) as Order[]

        setOrders(ordersWithSeeker)

        const active = ordersWithSeeker.filter(
          (o) => o.status === "paid" || o.status === "pending" || o.status === "awaiting_confirmation",
        ).length
        const completed = ordersWithSeeker.filter((o) => o.status === "completed").length
        const totalEarned =
          ordersWithSeeker
            .filter((o) => o.status === "completed")
            .reduce((sum, o) => sum + Number(o.provider_amount || 0), 0)
        const pendingEarnings =
          ordersWithSeeker
            .filter((o) => o.status === "paid" || o.status === "awaiting_confirmation")
            .reduce((sum, o) => sum + Number(o.provider_amount || 0), 0)
        const { data: withdrawals, error: withdrawalError } = await supabase
          .from("withdrawal_requests")
          .select("amount")
          .eq("provider_id", provider.id)
          .in("status", ["pending", "approved", "completed"])
        if (withdrawalError) throw withdrawalError
        const totalWithdrawn = (withdrawals || []).reduce((sum: number, withdrawal: any) => sum + Number(withdrawal.amount || 0), 0)

        setStats({
          activeOrders: active,
          completedOrders: completed,
          totalEarned,
          totalWithdrawn,
          pendingEarnings,
        })

      }

    } catch {
      setLoadError(true)
      setTapConnected(false)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    fetchData()
  }, [router])

  const handleConnectTap = async () => {
    setConnectingTap(true)

    try {
      if (!tapDestinationId) {
        const createResult = await createConnectAccount()
        if (!createResult.success) {
          toast({ title: t("خطأ", "Error"), description: createResult.error, variant: "destructive" })
          setConnectingTap(false)
          return
        }
        setTapDestinationId(createResult.data.destinationId || createResult.data.accountId)
      }

      const linkResult = await createAccountLink()
      if (!linkResult.success) {
        toast({ title: t("خطأ", "Error"), description: linkResult.error, variant: "destructive" })
        setConnectingTap(false)
        return
      }

      window.location.href = linkResult.data.url
    } catch {
      toast({ title: t("خطأ", "Error"), description: t("حدث خطأ أثناء الاتصال بـ Tap Payment", "An error occurred while connecting to Tap Payment"), variant: "destructive" })
      setConnectingTap(false)
    }
  }

  const handleWithdraw = async () => {
    if (!tapConnected) {
      toast({ title: t("تنبيه", "Notice"), description: t("يرجى ربط حساب Tap Payment أولاً", "Please connect your Tap Payment account first"), variant: "destructive" })
      return
    }

    const availableBalance = stats.totalEarned - stats.totalWithdrawn
    if (availableBalance <= 0) {
      toast({ title: t("تنبيه", "Notice"), description: t("لا توجد أرباح متاحة للسحب", "No earnings available to withdraw") })
      return
    }

    setShowWithdrawDialog(true)
  }

  const executeWithdraw = async () => {
    if (withdrawing) return
    setShowWithdrawDialog(false)
    const availableBalance = stats.totalEarned - stats.totalWithdrawn
    setWithdrawing(true)

    try {
    const result = await createPayout(availableBalance)

    if (result.success) {
      toast({
        title: t("تم بنجاح", "Success"),
        description: t(
          "تم إرسال طلب السحب وحجز المبلغ لحين المراجعة.",
          "Withdrawal request submitted. The amount is reserved while it is reviewed.",
        ),
      })
      await fetchData()
    } else {
      toast({ title: t("خطأ", "Error"), description: result.error, variant: "destructive" })
    }

    } catch {
      toast({ title: t("خطأ", "Error"), description: t("تعذر إرسال طلب السحب. يرجى المحاولة مجدداً.", "Unable to request a withdrawal. Please try again."), variant: "destructive" })
    } finally { setWithdrawing(false) }
  }

  if (loadError) {
    return <div className="min-h-screen flex flex-col"><Header /><main className="flex-1 flex flex-col items-center justify-center gap-4 p-6"><p role="alert">{t("تعذر تحميل لوحة التحكم. أعد المحاولة.", "Unable to load your dashboard. Please try again.")}</p><Button onClick={() => { setLoading(true); void fetchData() }}>{t("إعادة المحاولة", "Try again")}</Button></main><Footer /></div>
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

          {!tapConnected && (
            <Card className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="font-semibold text-amber-900 dark:text-amber-100">
                        {t("ربط حساب Tap Payment مطلوب", "Tap Payment Account Connection Required")}
                      </p>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {t(
                          "يرجى ربط حساب Tap Payment لتلقي المدفوعات",
                          "Please connect your Tap Payment account to receive payments",
                        )}
                      </p>
                    </div>
                  </div>
                  <Button onClick={handleConnectTap} disabled={connectingTap}>
                    <LinkIcon className="h-4 w-4 me-2" />
                    {connectingTap ? t("جاري الاتصال...", "Connecting...") : t("ربط Tap Payment", "Connect Tap Payment")}
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
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.pendingEarnings.toFixed(2)} SAR</div>
                <p className="text-xs text-muted-foreground">{t("بانتظار التأكيد", "Awaiting confirmation")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("إجمالي الأرباح", "Total Earned")}</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{(stats.totalEarned - stats.totalWithdrawn).toFixed(2)} SAR</div>
                <Button
                  size="sm"
                  className="w-full mt-2"
                  onClick={handleWithdraw}
                  disabled={withdrawing || stats.totalEarned - stats.totalWithdrawn <= 0 || !tapConnected}
                >
                  {withdrawing
                    ? t("جاري المعالجة...", "Processing...")
                    : !tapConnected
                      ? t("ربط Tap Payment أولاً", "Connect Tap Payment First")
                      : t("سحب الأرباح", "Withdraw")}
                </Button>
              </CardContent>
            </Card>
          </div>

          <OrdersTable orders={orders} onOrderUpdate={fetchData} />

        </div>
      </main>

      <Footer />

      <AlertDialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("تأكيد السحب", "Confirm Withdrawal")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `هل تريد سحب ${(stats.totalEarned - stats.totalWithdrawn).toFixed(2)} ر.س؟`,
                `Do you want to withdraw ${(stats.totalEarned - stats.totalWithdrawn).toFixed(2)} SAR?`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={executeWithdraw}>{t("سحب", "Withdraw")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
