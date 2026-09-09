"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useLanguage } from "@/components/language-provider"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import {
  LayoutDashboard,
  Briefcase,
  ShieldCheck,
  Wallet,
  ClipboardList,
  CircleAlert,
  ScrollText,
  UserRoundX,
  LifeBuoy,
  Undo2,
  Scale,
  LogOut,
  Menu,
  X,
  Globe,
  Moon,
  Sun,
  BookOpen,
} from "lucide-react"
import { useTheme } from "next-themes"

const navItems = [
  { href: "/admin", labelAr: "الرئيسية", labelEn: "Overview", icon: LayoutDashboard },
  { href: "/admin/services", labelAr: "مراجعة الخدمات", labelEn: "Services Review", icon: Briefcase },
  { href: "/admin/providers", labelAr: "توثيق مقدمي الخدمة", labelEn: "Provider Verification", icon: ShieldCheck },
  { href: "/admin/withdrawals", labelAr: "طلبات السحب", labelEn: "Withdrawals", icon: Wallet },
  { href: "/admin/payments", labelAr: "استثناءات الدفع", labelEn: "Payment Exceptions", icon: CircleAlert },
  { href: "/admin/audit", labelAr: "سجل التدقيق", labelEn: "Audit Log", icon: ScrollText },
  { href: "/admin/deletions", labelAr: "حذف الحسابات", labelEn: "Account Deletions", icon: UserRoundX },
  { href: "/admin/support", labelAr: "طلبات الدعم", labelEn: "Support Tickets", icon: LifeBuoy },
  { href: "/admin/refunds", labelAr: "طلبات الاسترداد", labelEn: "Refund Requests", icon: Undo2 },
  { href: "/admin/disputes", labelAr: "نزاعات الطلبات", labelEn: "Order Disputes", icon: Scale },
  { href: "/admin/knowledge", labelAr: "معرفة المساعد", labelEn: "Assistant Knowledge", icon: BookOpen },
  { href: "/admin/orders", labelAr: "الطلبات والمستخدمون", labelEn: "Orders & Users", icon: ClipboardList },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t, language, setLanguage } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checkAttempt, setCheckAttempt] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [themeMounted,setThemeMounted]=useState(false)
  const { toast } = useToast()
  const { resolvedTheme,setTheme }=useTheme()

  useEffect(()=>setThemeMounted(true),[])

  useEffect(() => {
    async function checkAdmin() {
      setLoading(true)
      setLoadError(null)
      setUnauthorized(false)
      const supabase = createClient()
      const { data: { user },error:authError } = await supabase.auth.getUser()

      if(authError){setLoadError(t("تعذر التحقق من جلسة الإدارة","Could not verify the administrator session"));setLoading(false);return}
      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data: profile,error:profileError } = await supabase
        .from("profiles")
        .select("is_admin, email")
        .eq("id", user.id)
        .single()

      if(profileError){
        setLoadError(t("تعذر تحميل صلاحيات الإدارة","Could not load administrator permissions"))
        setLoading(false)
        return
      }

      if (!profile?.is_admin) {
        setUnauthorized(true)
        setLoading(false)
        return
      }

      setAdminEmail(profile.email || user.email || null)
      setLoading(false)
    }

    checkAdmin()
  }, [router,checkAttempt])

  const handleSignOut = async () => {
    const supabase = createClient()
    const { error }=await supabase.auth.signOut()
    if(error){toast({title:t("تعذر تسجيل الخروج","Could not sign out"),description:t("يرجى المحاولة مرة أخرى","Please try again"),variant:"destructive"});return}
    router.push("/auth/login")
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
      </div>
    )
  }

  if (unauthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4">
        <ShieldCheck className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold">{t("غير مصرح لك", "Unauthorized")}</h1>
        <p className="text-muted-foreground">{t("هذه الصفحة للمشرفين فقط", "This page is for admins only")}</p>
        <Button onClick={() => router.push("/")}>{t("العودة للرئيسية", "Back to Home")}</Button>
      </div>
    )
  }

  if(loadError){
    return <div className="min-h-screen flex items-center justify-center flex-col gap-4 px-4 text-center" role="alert">
      <CircleAlert className="h-16 w-16 text-destructive" />
      <h1 className="text-2xl font-bold">{t("تعذر فتح لوحة الإدارة","Could not open the admin panel")}</h1>
      <p className="text-muted-foreground">{loadError}</p>
      <Button onClick={()=>setCheckAttempt((attempt)=>attempt+1)}>{t("إعادة المحاولة","Retry")}</Button>
    </div>
  }

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 bottom-0 z-30 w-64 bg-background border-e flex flex-col
          transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : language === "ar" ? "translate-x-full lg:translate-x-0" : "-translate-x-full lg:translate-x-0"}
          lg:static lg:translate-x-0
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b shrink-0">
          <ShieldCheck className="h-6 w-6 text-primary me-2" />
          <span className="font-bold text-lg">{t("لوحة الإدارة", "Admin Panel")}</span>
          <button
            type="button"
            aria-label={t("إغلاق القائمة", "Close menu")}
            className="ms-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"}
                `}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t(item.labelAr, item.labelEn)}
              </Link>
            )
          })}
        </nav>

        {/* Bottom */}
        <div className="border-t p-4 space-y-2 shrink-0">
          <div className="text-xs text-muted-foreground truncate px-1">{adminEmail}</div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
            {t("تسجيل الخروج", "Sign Out")}
          </Button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-background border-b flex items-center px-4 gap-3 shrink-0">
          <button
            type="button"
            aria-label={t("فتح القائمة", "Open menu")}
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label={resolvedTheme==="dark"?t("التبديل إلى الوضع الفاتح","Switch to light theme"):t("التبديل إلى الوضع الداكن","Switch to dark theme")}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={!themeMounted}
            onClick={()=>setTheme(resolvedTheme==="dark"?"light":"dark")}
          >
            {resolvedTheme==="dark"?<Sun className="h-4 w-4" />:<Moon className="h-4 w-4" />}
          </button>
          {/* Language toggle */}
          <button
            type="button"
            aria-label={t("تغيير اللغة", "Change language")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
          >
            <Globe className="h-4 w-4" />
            {language === "ar" ? "EN" : "عربي"}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
