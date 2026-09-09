"use client"

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/language-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Briefcase, ShieldCheck, Wallet, ClipboardList, Users, AlertCircle, Undo2, Scale } from "lucide-react"
import Link from "next/link"
import { getAdminOperationsSummary, getAdminServicePage } from "@/app/actions/operations"
import { useToast } from "@/hooks/use-toast"

type Stats = {
  pendingServices: number
  unverifiedProviders: number
  pendingWithdrawals: number
  totalOrders: number
  totalUsers: number
  openRefunds: number
  openDisputes: number
  paymentExceptions: number
}

type RecentService = {
  id: string
  name_ar: string
  name_en: string
  category: string
  is_active: boolean
  created_at: string
  providers: { name_ar: string; name_en: string } | null
}

export default function AdminOverviewPage() {
  const { t, language } = useLanguage()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentServices, setRecentServices] = useState<RecentService[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [servicesUnavailable, setServicesUnavailable] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const { toast } = useToast()

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setLoadError(null)
      const [summaryResult,servicesResult] = await Promise.all([
        getAdminOperationsSummary(),
        getAdminServicePage("","pending_review",null,5),
      ])

      if(!summaryResult.success){setLoadError(summaryResult.error);toast({title:t("تعذر تحميل ملخص العمليات","Could not load operations summary"),description:summaryResult.error,variant:"destructive"});setLoading(false);return}
      const summary=summaryResult.data.summary
      setStats({
        pendingServices:Number(summary.pending_services||0),
        unverifiedProviders:Number(summary.unverified_providers||0),
        pendingWithdrawals:Number(summary.pending_withdrawals||0),
        totalOrders:Number(summary.total_orders||0),
        totalUsers:Number(summary.total_users||0),
        openRefunds:Number(summary.open_refunds||0),
        openDisputes:Number(summary.open_disputes||0),
        paymentExceptions:Number(summary.payment_exceptions||0),
      })
      if(!servicesResult.success){setServicesUnavailable(true);toast({title:t("تعذر تحميل أحدث الخدمات","Could not load latest services"),variant:"destructive"})}
      else {setRecentServices(servicesResult.data.services as RecentService[]);setServicesUnavailable(false)}
      setLoading(false)
    }

    fetchData()
  }, [reloadKey])

  const statCards = [
    {
      label: t("خدمات بانتظار المراجعة", "Services Pending Review"),
      value: stats?.pendingServices,
      icon: Briefcase,
      href: "/admin/services",
      urgent: (stats?.pendingServices || 0) > 0,
    },
    { label:t("استردادات مفتوحة","Open Refunds"),value:stats?.openRefunds,icon:Undo2,href:"/admin/refunds",urgent:(stats?.openRefunds||0)>0 },
    { label:t("نزاعات مفتوحة","Open Disputes"),value:stats?.openDisputes,icon:Scale,href:"/admin/disputes",urgent:(stats?.openDisputes||0)>0 },
    { label:t("استثناءات الدفع","Payment Exceptions"),value:stats?.paymentExceptions,icon:AlertCircle,href:"/admin/payments",urgent:(stats?.paymentExceptions||0)>0 },
    {
      label: t("مقدمو خدمة غير موثقين", "Unverified Providers"),
      value: stats?.unverifiedProviders,
      icon: ShieldCheck,
      href: "/admin/providers",
      urgent: (stats?.unverifiedProviders || 0) > 0,
    },
    {
      label: t("طلبات سحب معلقة", "Pending Withdrawals"),
      value: stats?.pendingWithdrawals,
      icon: Wallet,
      href: "/admin/withdrawals",
      urgent: (stats?.pendingWithdrawals || 0) > 0,
    },
    {
      label: t("إجمالي الطلبات", "Total Orders"),
      value: stats?.totalOrders,
      icon: ClipboardList,
      href: "/admin/orders",
      urgent: false,
    },
    {
      label: t("إجمالي المستخدمين", "Total Users"),
      value: stats?.totalUsers,
      icon: Users,
      href: "/admin/orders",
      urgent: false,
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
      </div>
    )
  }

  if(loadError){
    return <Card className="mx-auto max-w-lg p-8 text-center" role="alert">
      <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
      <h1 className="text-xl font-semibold">{t("تعذر تحميل ملخص العمليات","Could not load operations summary")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
      <Button className="mt-4" onClick={()=>setReloadKey((key)=>key+1)}>{t("إعادة المحاولة","Retry")}</Button>
    </Card>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("لوحة تحكم الإدارة", "Admin Dashboard")}</h1>
        <p className="text-muted-foreground mt-1">{t("نظرة عامة على المنصة", "Platform overview")}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <Link key={card.href + card.label} href={card.href}>
              <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer group">
                <div className="flex items-start justify-between">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      card.urgent ? "bg-destructive/10" : "bg-primary/10"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${card.urgent ? "text-destructive" : "text-primary"}`} />
                  </div>
                  {card.urgent && card.value! > 0 && (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                </div>
                <div className="mt-3">
                  <div className={`text-3xl font-bold ${card.urgent && card.value! > 0 ? "text-destructive" : ""}`}>
                    {card.value}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5 group-hover:text-foreground transition-colors">
                    {card.label}
                  </div>
                </div>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Recent Inactive Services */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          {t("آخر الخدمات المعلقة", "Latest Pending Services")}
        </h2>
        {servicesUnavailable ? (
          <Card className="p-8 text-center" role="alert">
            <p className="text-destructive">{t("تعذر تحميل أحدث الخدمات","Could not load latest services")}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={()=>setReloadKey((key)=>key+1)}>{t("إعادة المحاولة","Retry")}</Button>
          </Card>
        ) : recentServices.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            {t("لا توجد خدمات معلقة", "No pending services")}
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-start px-4 py-3 font-medium">{t("اسم الخدمة", "Service Name")}</th>
                    <th className="text-start px-4 py-3 font-medium">{t("مقدم الخدمة", "Provider")}</th>
                    <th className="text-start px-4 py-3 font-medium">{t("الفئة", "Category")}</th>
                    <th className="text-start px-4 py-3 font-medium">{t("تاريخ الإنشاء", "Created")}</th>
                    <th className="text-start px-4 py-3 font-medium">{t("الحالة", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentServices.map((service) => (
                    <tr key={service.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">
                        {language === "ar" ? service.name_ar : service.name_en}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {service.providers
                          ? language === "ar" ? service.providers.name_ar : service.providers.name_en
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{service.category}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(service.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="destructive">{t("معلق", "Inactive")}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {recentServices.length > 0 && (
          <div className="mt-2 text-end">
            <Link href="/admin/services" className="text-sm text-primary hover:underline">
              {t("عرض الكل →", "View all →")}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
