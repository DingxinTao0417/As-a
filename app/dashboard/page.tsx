"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { createConnectAccount, createAccountLink, checkAccountStatus, createPayout, getProviderWithdrawals } from "@/app/actions/tap-connect"
import { getProviderDashboardSnapshot, getProviderLedgerPage } from "@/app/actions/operations"
import { formatCurrency } from "@/lib/tap"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, DollarSign, AlertCircle, LinkIcon, CheckCircle, Scale, Undo2 } from "lucide-react"
import { OrdersTable, type Order } from "@/components/orders-table"
import { useToast } from "@/hooks/use-toast"
import { getCurrentProviderContext } from "@/app/actions/providers"
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
  const { t, language } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [providerOrderTotal, setProviderOrderTotal] = useState(0)
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [tapConnected, setTapConnected] = useState(false)
  const [tapChargesEnabled,setTapChargesEnabled]=useState(false)
  const [tapStatus,setTapStatus]=useState("not_connected")
  const [tapDestinationId, setTapDestinationId] = useState<string | null>(null)
  const [connectingTap, setConnectingTap] = useState(false)
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false)
  const [balanceUnavailable, setBalanceUnavailable] = useState(false)
  const [withdrawalsUnavailable, setWithdrawalsUnavailable] = useState(false)
  const [withdrawalCursor,setWithdrawalCursor]=useState<{requestedAt:string;id:string}|null>(null)
  const [withdrawalTotal,setWithdrawalTotal]=useState(0)
  const [loadingMoreWithdrawals,setLoadingMoreWithdrawals]=useState(false)
  const [withdrawals, setWithdrawals] = useState<Array<{
    id: string
    amount: number
    status: string
    requested_at: string
    payout_method: string | null
    external_reference: string | null
    failure_reason: string | null
  }>>([])
  const [ledgerEntries,setLedgerEntries]=useState<Array<{
    id:string;entry_type:string;reference_key:string;available_delta:number;reserved_delta:number;paid_delta:number
    note:string|null;created_at:string;order_id:string|null;withdrawal_request_id:string|null
    service_name_ar:string|null;service_name_en:string|null;withdrawal_status:string|null
  }>>([])
  const [ledgerCursor,setLedgerCursor]=useState<{createdAt:string;id:string}|null>(null)
  const [ledgerTotal,setLedgerTotal]=useState(0)
  const [ledgerUnavailable,setLedgerUnavailable]=useState(false)
  const [loadingMoreLedger,setLoadingMoreLedger]=useState(false)
  const [stats, setStats] = useState({
    activeOrders: 0,
    completedOrders: 0,
    pendingEarnings: 0,
    availableBalance: 0,
    reservedBalance: 0,
    paidBalance: 0,
    openRefunds: 0,
    openDisputes: 0,
  })

  const fetchData = async () => {
    setLoading(true)
    setLoadError(null)
    setAccessDenied(false)
    try {
      const supabase = createClient()
      const {
        data: { user },
        error:authError,
      } = await supabase.auth.getUser()

      if (authError) {
        setLoadError(t("تعذر التحقق من الجلسة","Could not verify your session"))
        return
      }
      if (!user) {
        router.push("/auth/login")
        return
      }

      const contextResult=await getCurrentProviderContext()
      if(!contextResult.success){
        setLoadError(t("تعذر التحقق من نوع الحساب","Could not verify the account role"))
        return
      }
      if (contextResult.data.role !== "provider") {
        setAccessDenied(true)
        return
      }
      if (!contextResult.data.provider) {
        router.push("/register/provider")
        return
      }
      const provider = contextResult.data.provider

      setTapDestinationId(provider.tap_destination_id)
      setTapConnected(false)
      setTapChargesEnabled(false)
      setTapStatus(provider.tap_destination_id?"checking":"not_connected")

      if (provider.tap_destination_id) {
        const statusResult = await checkAccountStatus()
        if (statusResult.success) {
          setTapConnected(statusResult.data.payoutsEnabled)
          setTapChargesEnabled(statusResult.data.chargesEnabled)
          setTapStatus(statusResult.data.status)
        } else if (!statusResult.success) {
          setTapStatus("unavailable")
          toast({ title:t("تعذر تحديث حالة Tap","Could not refresh Tap status"),description:statusResult.error,variant:"destructive" })
        }
      }

      const [snapshotResult,withdrawalResult,ledgerResult]=await Promise.all([
        getProviderDashboardSnapshot(1,50),getProviderWithdrawals(),getProviderLedgerPage(),
      ])
      if (snapshotResult.success) {
        setOrders(snapshotResult.data.orders as unknown as Order[])
        setProviderOrderTotal(snapshotResult.data.total)
        setBalanceUnavailable(false)
        setStats({
          activeOrders:snapshotResult.data.stats.activeOrders,
          completedOrders:snapshotResult.data.stats.completedOrders,
          pendingEarnings:snapshotResult.data.stats.pendingEarnings,
          availableBalance:snapshotResult.data.stats.availableBalance,
          reservedBalance:snapshotResult.data.stats.reservedBalance,
          paidBalance:snapshotResult.data.stats.paidBalance,
          openRefunds:snapshotResult.data.stats.openRefunds,
          openDisputes:snapshotResult.data.stats.openDisputes,
        })
      } else {
        setBalanceUnavailable(true)
        toast({ title:t("تعذر تحميل لوحة التحكم","Could not load dashboard"),description:snapshotResult.error,variant:"destructive" })
      }
      if (withdrawalResult.success) {
        setWithdrawals(withdrawalResult.data.withdrawals as typeof withdrawals)
        setWithdrawalTotal(withdrawalResult.data.total)
        setWithdrawalCursor(withdrawalResult.data.nextCursor)
        setWithdrawalsUnavailable(false)
      } else {
        setWithdrawalsUnavailable(true)
        toast({ title: t("تعذر تحميل سجل السحب", "Could not load withdrawal history"), description: withdrawalResult.error, variant: "destructive" })
      }
      if(ledgerResult.success){
        setLedgerEntries(ledgerResult.data.entries as typeof ledgerEntries);setLedgerTotal(ledgerResult.data.total)
        setLedgerCursor(ledgerResult.data.nextCursor);setLedgerUnavailable(false)
      }else{
        setLedgerUnavailable(true)
        toast({title:t("تعذر تحميل دفتر الأستاذ","Could not load ledger entries"),description:ledgerResult.error,variant:"destructive"})
      }
    } catch {
      setLoadError(t("تعذر تحميل لوحة التحكم. يرجى المحاولة مرة أخرى","Could not load the dashboard. Please try again"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [router])

  const loadMoreOrders=async()=>{
    setLoadingMoreOrders(true)
    const nextPage=Math.floor(orders.length/50)+1
    const result=await getProviderDashboardSnapshot(nextPage,50)
    if(result.success)setOrders((current)=>[...current,...result.data.orders as unknown as Order[]])
    else toast({title:t("تعذر تحميل طلبات أقدم","Could not load older orders"),description:result.error,variant:"destructive"})
    setLoadingMoreOrders(false)
  }

  const loadMoreLedger=async()=>{
    if(!ledgerCursor||loadingMoreLedger)return
    setLoadingMoreLedger(true)
    const result=await getProviderLedgerPage(ledgerCursor)
    if(result.success){
      setLedgerEntries((current)=>[...current,...result.data.entries as typeof ledgerEntries]);setLedgerTotal(result.data.total)
      setLedgerCursor(result.data.nextCursor);setLedgerUnavailable(false)
    }else{setLedgerUnavailable(true);toast({title:t("تعذر تحميل قيود أقدم","Could not load older ledger entries"),description:result.error,variant:"destructive"})}
    setLoadingMoreLedger(false)
  }

  const loadMoreWithdrawals=async()=>{
    if(!withdrawalCursor||loadingMoreWithdrawals)return
    setLoadingMoreWithdrawals(true)
    const result=await getProviderWithdrawals(withdrawalCursor)
    if(result.success){
      setWithdrawals((current)=>[...current,...result.data.withdrawals as typeof withdrawals])
      setWithdrawalTotal(result.data.total);setWithdrawalCursor(result.data.nextCursor);setWithdrawalsUnavailable(false)
    }else{
      setWithdrawalsUnavailable(true)
      toast({title:t("تعذر تحميل طلبات سحب أقدم","Could not load older withdrawals"),description:result.error,variant:"destructive"})
    }
    setLoadingMoreWithdrawals(false)
  }

  const handleConnectTap = async () => {
    setConnectingTap(true)

    try {
      if(tapDestinationId){
        const statusResult=await checkAccountStatus()
        if(!statusResult.success){
          setTapStatus("unavailable")
          toast({title:t("تعذر تحديث حالة Tap","Could not refresh Tap status"),description:statusResult.error,variant:"destructive"})
          return
        }
        setTapStatus(statusResult.data.status)
        setTapChargesEnabled(statusResult.data.chargesEnabled)
        setTapConnected(statusResult.data.payoutsEnabled)
        toast({
          title:statusResult.data.payoutsEnabled?t("تم التحقق من حساب Tap","Tap account verified"):t("لا يزال تفعيل السحب معلقاً","Payout activation is still pending"),
        })
        return
      }
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
    } finally {
      setConnectingTap(false)
    }
  }

  const handleWithdraw = async () => {
    if (!tapConnected) {
      toast({ title: t("تنبيه", "Notice"), description: t("يرجى ربط حساب Tap Payment أولاً", "Please connect your Tap Payment account first"), variant: "destructive" })
      return
    }

    if (balanceUnavailable) {
      toast({ title: t("تعذر تحميل الرصيد", "Balance unavailable"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
      return
    }
    if (stats.availableBalance <= 0) {
      toast({ title: t("تنبيه", "Notice"), description: t("لا توجد أرباح متاحة للسحب", "No earnings available to withdraw") })
      return
    }

    setShowWithdrawDialog(true)
  }

  const executeWithdraw = async () => {
    setShowWithdrawDialog(false)
    setWithdrawing(true)

    const result = await createPayout(stats.availableBalance)

    if (result.success) {
      toast({
        title: t("تم بنجاح", "Success"),
        description: t(
          "تم إرسال طلب السحب للمراجعة. يمكنك متابعة حالته في السجل.",
          "The withdrawal request was submitted for review. You can track its status in the history.",
        ),
      })
      await fetchData()
    } else {
      toast({ title: t("خطأ", "Error"), description: result.error, variant: "destructive" })
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

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center bg-muted/30">
          <Card className="max-w-md mx-4">
            <CardHeader>
              <div className="mb-2 flex items-center gap-2 text-destructive">
                <AlertCircle className="h-6 w-6" />
                <CardTitle>{t("تعذر تحميل لوحة التحكم","Could not load dashboard")}</CardTitle>
              </div>
              <CardDescription>{loadError}</CardDescription>
            </CardHeader>
            <CardContent><Button onClick={() => void fetchData()}>{t("إعادة المحاولة","Retry")}</Button></CardContent>
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
                        {tapDestinationId
                          ?t("حساب Tap يحتاج إلى إكمال التفعيل","Tap account activation is incomplete")
                          :t("ربط حساب Tap Payment مطلوب", "Tap Payment Account Connection Required")}
                      </p>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {tapDestinationId
                          ?tapChargesEnabled
                            ?t("تم تفعيل استقبال المدفوعات، لكن السحب ما زال بانتظار موافقة Tap.","Payment collection is active, but payouts still await Tap approval.")
                            :t(`حالة Tap الحالية: ${tapStatus}. أعد التحقق أو أكمل متطلبات KYC مع Tap.`,`Current Tap status: ${tapStatus}. Refresh it or complete Tap's KYC requirements.`)
                          :t("إعداد Marketplace غير متاح حتى تزود المنصة ببيانات Tap المعتمدة.","Marketplace onboarding remains unavailable until the platform has approved Tap configuration.")}
                      </p>
                    </div>
                  </div>
                  <Button onClick={handleConnectTap} disabled={connectingTap}>
                    <LinkIcon className="h-4 w-4 me-2" />
                    {connectingTap
                      ?t("جاري التحقق...","Checking...")
                      :tapDestinationId
                        ?t("تحديث حالة Tap","Refresh Tap status")
                        :t("بدء ربط Tap","Start Tap connection")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("الطلبات النشطة", "Active Orders")}</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{balanceUnavailable ? "—" : stats.activeOrders}</div>
                <p className="text-xs text-muted-foreground">{t("بانتظار الإنجاز", "Awaiting completion")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("الطلبات المكتملة", "Completed Orders")}</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{balanceUnavailable ? "—" : stats.completedOrders}</div>
                <p className="text-xs text-muted-foreground">{t("بنجاح", "Successfully")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("أرباح معلقة", "Pending Earnings")}</CardTitle>
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{balanceUnavailable ? "—" : formatCurrency(stats.pendingEarnings,language)}</div>
                <p className="text-xs text-muted-foreground">{t("بانتظار التأكيد", "Awaiting confirmation")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("الرصيد المتاح", "Available Balance")}</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {balanceUnavailable ? "—" : formatCurrency(stats.availableBalance,language)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("محجوز", "Reserved")}: {balanceUnavailable ? "—" : formatCurrency(stats.reservedBalance,language)}
                </p>
                <Button
                  size="sm"
                  className="w-full mt-2"
                  onClick={handleWithdraw}
                  disabled={withdrawing || stats.availableBalance <= 0 || balanceUnavailable || !tapConnected}
                >
                  {withdrawing
                    ? t("جاري المعالجة...", "Processing...")
                    : !tapConnected
                      ? t("ربط Tap Payment أولاً", "Connect Tap Payment First")
                      : t("سحب الأرباح", "Withdraw")}
                </Button>
              </CardContent>
            </Card>
            <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">{t("استردادات مفتوحة","Open Refunds")}</CardTitle><Undo2 className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{balanceUnavailable ? "—" : stats.openRefunds}</div></CardContent></Card>
            <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">{t("نزاعات مفتوحة","Open Disputes")}</CardTitle><Scale className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{balanceUnavailable ? "—" : stats.openDisputes}</div><p className="text-xs text-muted-foreground">{t("مدفوع سابقاً","Paid out")}: {balanceUnavailable ? "—" : formatCurrency(stats.paidBalance,language)}</p></CardContent></Card>
          </div>

          <Card className="mb-8 overflow-hidden">
            <CardHeader><CardTitle>{t("سجل السحب", "Withdrawal History")}</CardTitle><CardDescription>{t("الموافقة لا تعني أن الدفعة وصلت؛ راجع حالة التتبع والمرجع الخارجي.", "Approval does not mean funds arrived; check the tracking status and external reference.")}</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm"><thead><tr className="border-b bg-muted/50"><th className="px-4 py-3 text-start">{t("المبلغ", "Amount")}</th><th className="px-4 py-3 text-start">{t("الحالة", "Status")}</th><th className="px-4 py-3 text-start">{t("الطريقة", "Method")}</th><th className="px-4 py-3 text-start">{t("المرجع", "Reference")}</th><th className="px-4 py-3 text-start">{t("التاريخ", "Requested")}</th></tr></thead><tbody>{withdrawalsUnavailable&&withdrawals.length===0?<tr><td colSpan={5} className="px-4 py-8 text-center text-destructive">{t("تعذر تحميل سجل السحب", "Withdrawal history unavailable")}</td></tr>:withdrawals.length===0?<tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{t("لا توجد طلبات سحب", "No withdrawal requests")}</td></tr>:withdrawals.map((withdrawal)=><tr key={withdrawal.id} className="border-b last:border-0"><td className="px-4 py-3">{formatCurrency(Number(withdrawal.amount),language)}</td><td className="px-4 py-3"><span className="font-medium">{withdrawal.status}</span>{withdrawal.failure_reason&&<p className="text-xs text-destructive">{withdrawal.failure_reason}</p>}</td><td className="px-4 py-3 text-muted-foreground">{withdrawal.payout_method||"—"}</td><td className="px-4 py-3 font-mono text-xs">{withdrawal.external_reference||"—"}</td><td className="px-4 py-3 text-muted-foreground">{new Date(withdrawal.requested_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}</td></tr>)}</tbody></table>
              {withdrawalsUnavailable&&withdrawals.length>0&&<div className="mx-4 rounded border border-destructive/30 p-3 text-sm text-destructive" role="alert">{t("تعذر تحديث سجل السحب؛ المعروض هو آخر بيانات ناجحة","Withdrawal refresh failed; showing the last successful data")}</div>}
              {withdrawalCursor&&withdrawals.length<withdrawalTotal&&<div className="pb-4 text-center"><Button variant="outline" onClick={()=>void loadMoreWithdrawals()} disabled={loadingMoreWithdrawals}>{loadingMoreWithdrawals?t("جاري التحميل...","Loading..."):t("تحميل طلبات سحب أقدم","Load Older Withdrawals")}</Button></div>}
            </CardContent>
          </Card>

          <Card className="mb-8 overflow-hidden">
            <CardHeader><CardTitle>{t("دفتر الأستاذ","Ledger Entries")}</CardTitle><CardDescription>{t("يعرض كل تسوية وحجز وإفراج واسترداد ودفعة مع أثرها على الأرصدة.","Every settlement, reservation, release, refund, and payout with its balance impact.")}</CardDescription></CardHeader>
            <CardContent className="space-y-3 p-0">
              {ledgerUnavailable&&ledgerEntries.length===0?<div className="p-8 text-center text-destructive" role="alert">{t("تعذر تحميل دفتر الأستاذ","Ledger entries unavailable")}<div><Button variant="outline" size="sm" className="mt-3" onClick={()=>void fetchData()}>{t("إعادة المحاولة","Retry")}</Button></div></div>:ledgerEntries.length===0?<div className="p-8 text-center text-muted-foreground">{t("لا توجد قيود بعد","No ledger entries yet")}</div>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/50"><th className="px-4 py-3 text-start">{t("التاريخ","Date")}</th><th className="px-4 py-3 text-start">{t("النوع","Type")}</th><th className="px-4 py-3 text-start">{t("المرجع","Reference")}</th><th className="px-4 py-3 text-start">{t("متاح","Available")}</th><th className="px-4 py-3 text-start">{t("محجوز","Reserved")}</th><th className="px-4 py-3 text-start">{t("مدفوع","Paid")}</th><th className="px-4 py-3 text-start">{t("ملاحظة","Note")}</th></tr></thead><tbody>{ledgerEntries.map((entry)=><tr key={entry.id} className="border-b last:border-0"><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(entry.created_at).toLocaleString(language==="ar"?"ar-SA":"en-US")}</td><td className="px-4 py-3"><Badge variant="outline">{entry.entry_type}</Badge></td><td className="max-w-xs px-4 py-3"><div>{language==="ar"?entry.service_name_ar:entry.service_name_en}</div><div className="break-all font-mono text-xs text-muted-foreground">{entry.reference_key}</div>{entry.withdrawal_status&&<div className="text-xs text-muted-foreground">{entry.withdrawal_status}</div>}</td><td className="whitespace-nowrap px-4 py-3">{Number(entry.available_delta)===0?"—":formatCurrency(Number(entry.available_delta),language)}</td><td className="whitespace-nowrap px-4 py-3">{Number(entry.reserved_delta)===0?"—":formatCurrency(Number(entry.reserved_delta),language)}</td><td className="whitespace-nowrap px-4 py-3">{Number(entry.paid_delta)===0?"—":formatCurrency(Number(entry.paid_delta),language)}</td><td className="max-w-xs px-4 py-3 text-muted-foreground">{entry.note||"—"}</td></tr>)}</tbody></table></div>}
              {ledgerUnavailable&&ledgerEntries.length>0&&<div className="mx-4 rounded border border-destructive/30 p-3 text-sm text-destructive" role="alert">{t("تعذر تحديث دفتر الأستاذ؛ المعروض هو آخر بيانات ناجحة","Ledger refresh failed; showing the last successful data")}</div>}
              {ledgerCursor&&ledgerEntries.length<ledgerTotal&&<div className="pb-4 text-center"><Button variant="outline" onClick={()=>void loadMoreLedger()} disabled={loadingMoreLedger}>{loadingMoreLedger?t("جاري التحميل...","Loading..."):t("تحميل قيود أقدم","Load Older Entries")}</Button></div>}
            </CardContent>
          </Card>

          <OrdersTable orders={orders} onOrderUpdate={fetchData} />
          {orders.length<providerOrderTotal&&<div className="mt-4 text-center"><Button variant="outline" onClick={()=>void loadMoreOrders()} disabled={loadingMoreOrders}>{loadingMoreOrders?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Orders")}</Button></div>}

        </div>
      </main>

      <Footer />

      <AlertDialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("تأكيد السحب", "Confirm Withdrawal")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `هل تريد سحب ${formatCurrency(stats.availableBalance,"ar")}؟`,
                `Do you want to withdraw ${formatCurrency(stats.availableBalance,"en")}?`
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
