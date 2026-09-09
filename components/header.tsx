"use client"

import { useState, useEffect, type FormEvent } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLanguage } from "@/components/language-provider"
import {
  Search,
  Menu,
  X,
  Globe,
  User,
  LogOut,
  MessageCircle,
  LayoutDashboard,
  Heart,
  History,
  Briefcase,
  Bell,
  LifeBuoy,
  Undo2,
  Scale,
  Moon,
  Sun,
  ShieldCheck,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import type { User as SupabaseUser } from "@supabase/supabase-js"
import { getMyNotifications } from "@/app/actions/notifications"
import { useToast } from "@/hooks/use-toast"
import { useTheme } from "next-themes"

export function Header() {
  const { language, setLanguage, t } = useLanguage()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [userRole, setUserRole] = useState<"seeker" | "provider" | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [notificationCount, setNotificationCount] = useState(0)
  const [authUnavailable, setAuthUnavailable] = useState(false)
  const [accountContextUnavailable, setAccountContextUnavailable] = useState(false)
  const [notificationsUnavailable, setNotificationsUnavailable] = useState(false)
  const [themeMounted,setThemeMounted]=useState(false)
  const router = useRouter()
  const { toast } = useToast()
  const { resolvedTheme,setTheme }=useTheme()

  useEffect(()=>setThemeMounted(true),[])

  useEffect(() => {
    const supabase = createClient()
    let active = true
    let notificationChannel:ReturnType<typeof supabase.channel>|null=null

    const syncNotifications=async()=>{
      const notifications=await getMyNotifications(1)
      if(!active)return
      if(notifications.success){
        setNotificationCount(notifications.data.unreadCount)
        setNotificationsUnavailable(false)
      }else setNotificationsUnavailable(true)
    }

    const syncUser = async (nextUser: SupabaseUser | null) => {
      if (!active) return
      setUser(nextUser)
      setAuthUnavailable(false)
      if (!nextUser) {
        if(notificationChannel){void notificationChannel.unsubscribe();notificationChannel=null}
        setUserRole(null)
        setNotificationCount(0)
        setAccountContextUnavailable(false)
        setNotificationsUnavailable(false)
        return
      }
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", nextUser.id)
        .maybeSingle()
      if (active) {
        setUserRole(error ? null : profile?.role || null)
        setAccountContextUnavailable(Boolean(error || !profile))
      }
      await syncNotifications()
      if(!active)return
      if(notificationChannel)void notificationChannel.unsubscribe()
      notificationChannel=supabase.channel(`header-notifications-${nextUser.id}`).on("postgres_changes",{
        event:"*",schema:"public",table:"notifications",filter:`user_id=eq.${nextUser.id}`,
      },()=>void syncNotifications()).subscribe()
    }

    supabase.auth.getUser().then(({ data: { user },error }) => {
      if(error){if(active)setAuthUnavailable(true);return}
      void syncUser(user)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => void syncUser(session?.user ?? null))

    return () => {
      active = false
      if(notificationChannel)void notificationChannel.unsubscribe()
      subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    const { error }=await supabase.auth.signOut()
    if(error){toast({title:t("تعذر تسجيل الخروج","Could not sign out"),description:t("يرجى المحاولة مرة أخرى","Please try again"),variant:"destructive"});return}
    router.push("/")
    router.refresh()
  }

  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    const query = searchQuery.trim()
    if (query) {
      router.push(`/services/seeker?q=${encodeURIComponent(query)}`)
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="text-2xl font-bold text-primary">أسعى</div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-6 flex-1 justify-center">
            <Link href="/" className="text-sm font-medium hover:text-primary transition-colors">
              {t("الرئيسية", "Home")}
            </Link>

            <Link href="/services/seeker" className="text-sm font-medium hover:text-primary transition-colors">
              {t("الخدمات", "Services")}
            </Link>

            <Link href="/about" className="text-sm font-medium hover:text-primary transition-colors">
              {t("من نحن", "About")}
            </Link>
          </nav>

          {/* Search Bar */}
          <form onSubmit={handleSearch} className="hidden md:flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("ما المهمة التي تريد إنجازها؟", "What task do you need done?")}
                className="ps-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t("بحث عن خدمات", "Search for services")}
              />
            </div>
          </form>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={()=>setTheme(resolvedTheme==="dark"?"light":"dark")}
              disabled={!themeMounted}
              aria-label={resolvedTheme==="dark"?t("التبديل إلى الوضع الفاتح","Switch to light theme"):t("التبديل إلى الوضع الداكن","Switch to dark theme")}
            >
              {resolvedTheme==="dark"?<Sun className="h-4 w-4" />:<Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
              className="hidden sm:flex items-center gap-2"
            >
              <Globe className="h-4 w-4" />
              {language === "ar" ? "EN" : "AR"}
            </Button>

            {user ? (
              <>
              <Button variant="ghost" size="icon" asChild className="relative hidden sm:inline-flex" aria-label={notificationsUnavailable?t("تعذر تحميل الإشعارات","Notifications unavailable"):t("الإشعارات", "Notifications")}>
                <Link href="/notifications">
                  <Bell className="h-4 w-4" />
                  {notificationCount > 0 && <span className="absolute -end-1 -top-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 text-white">{notificationCount > 99 ? "99+" : notificationCount}</span>}
                  {notificationsUnavailable&&<span className="absolute -end-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive" />}
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="hidden sm:flex items-center gap-2 bg-transparent">
                    <User className="h-4 w-4" />
                    {user.email?.split("@")[0]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      {t("الملف الشخصي", "Profile")}
                    </Link>
                  </DropdownMenuItem>
                  {accountContextUnavailable ? (
                    <DropdownMenuItem disabled>{t("خيارات الحساب غير متاحة","Account options unavailable")}</DropdownMenuItem>
                  ) : userRole === "provider" ? (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href="/dashboard" className="flex items-center gap-2">
                          <LayoutDashboard className="h-4 w-4" />
                          {t("لوحة التحكم", "Dashboard")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/my-services" className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4" />
                          {t("خدماتي", "My Services")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/verification" className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4" />
                          {t("طلب التوثيق", "Verification")}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href="/history" className="flex items-center gap-2">
                          <History className="h-4 w-4" />
                          {t("سجل الخدمات", "History")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/favorites" className="flex items-center gap-2">
                          <Heart className="h-4 w-4" />
                          {t("المفضلة", "Favorites")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/refunds" className="flex items-center gap-2">
                          <Undo2 className="h-4 w-4" />
                          {t("طلبات الاسترداد", "Refund Requests")}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem asChild>
                    <Link href="/messages" className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4" />
                      {t("الرسائل", "Messages")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/support" className="flex items-center gap-2">
                      <LifeBuoy className="h-4 w-4" />
                      {t("طلبات الدعم", "Support Tickets")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/disputes" className="flex items-center gap-2">
                      <Scale className="h-4 w-4" />
                      {t("نزاعات الطلبات", "Order Disputes")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="h-4 w-4 ms-2" />
                    {t("تسجيل الخروج", "Logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </>
            ) : authUnavailable ? (
              <Button variant="outline" size="sm" disabled className="hidden sm:flex bg-transparent">{t("الحساب غير متاح","Account unavailable")}</Button>
            ) : (
              <Button variant="outline" size="sm" asChild className="hidden sm:flex bg-transparent">
                <Link href="/auth/login">{t("تسجيل الدخول", "Login")}</Link>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={t("القائمة", "Menu")}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden py-4 border-t border-border">
            <nav className="flex flex-col gap-4">
              <Link href="/" className="text-sm font-medium hover:text-primary transition-colors">
                {t("الرئيسية", "Home")}
              </Link>
              <Link href="/services/seeker" className="text-sm font-medium hover:text-primary transition-colors">
                {t("الخدمات", "Services")}
              </Link>
              <Link href="/about" className="text-sm font-medium hover:text-primary transition-colors">
                {t("من نحن", "About")}
              </Link>
              {user && (
                <>
                  <Link href="/profile" className="text-sm font-medium hover:text-primary transition-colors">
                    {t("الملف الشخصي", "Profile")}
                  </Link>
                  {accountContextUnavailable ? (
                    <p className="text-sm text-destructive" role="status">{t("خيارات الحساب غير متاحة","Account options unavailable")}</p>
                  ) : userRole === "provider" ? (
                    <>
                      <Link href="/dashboard" className="text-sm font-medium hover:text-primary transition-colors">
                        {t("لوحة التحكم", "Dashboard")}
                      </Link>
                      <Link
                        href="/my-services"
                        className="text-sm font-medium hover:text-primary transition-colors"
                      >
                        {t("خدماتي", "My Services")}
                      </Link>
                      <Link href="/verification" className="text-sm font-medium hover:text-primary transition-colors">
                        {t("طلب التوثيق", "Verification")}
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link href="/history" className="text-sm font-medium hover:text-primary transition-colors">
                        {t("سجل الخدمات", "History")}
                      </Link>
                      <Link href="/favorites" className="text-sm font-medium hover:text-primary transition-colors">
                        {t("المفضلة", "Favorites")}
                      </Link>
                      <Link href="/refunds" className="text-sm font-medium hover:text-primary transition-colors">
                        {t("طلبات الاسترداد", "Refund Requests")}
                      </Link>
                    </>
                  )}
                  <Link
                    href="/messages"
                    className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-2"
                  >
                    <MessageCircle className="h-4 w-4" />
                    {t("الرسائل", "Messages")}
                  </Link>
                  <Link href="/notifications" className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    {t("الإشعارات", "Notifications")} {notificationsUnavailable?t("(غير متاحة)","(unavailable)"):notificationCount > 0 ? `(${notificationCount})` : ""}
                  </Link>
                  <Link href="/support" className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-2">
                    <LifeBuoy className="h-4 w-4" />
                    {t("طلبات الدعم", "Support Tickets")}
                  </Link>
                  <Link href="/disputes" className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-2">
                    <Scale className="h-4 w-4" />
                    {t("نزاعات الطلبات", "Order Disputes")}
                  </Link>
                  <Button variant="ghost" size="sm" onClick={handleLogout} className="justify-start text-red-600">
                    <LogOut className="h-4 w-4 ms-2" />
                    {t("تسجيل الخروج", "Logout")}
                  </Button>
                </>
              )}
              {!user && !authUnavailable && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/auth/login">{t("تسجيل الدخول", "Login")}</Link>
                </Button>
              )}
              {!user&&authUnavailable&&<p className="text-sm text-destructive" role="status">{t("تعذر تحميل حالة الحساب","Account status unavailable")}</p>}
              <Button
                variant="ghost"
                size="sm"
                onClick={()=>setTheme(resolvedTheme==="dark"?"light":"dark")}
                disabled={!themeMounted}
                className="justify-start"
              >
                {resolvedTheme==="dark"?<Sun className="h-4 w-4 ms-2" />:<Moon className="h-4 w-4 ms-2" />}
                {resolvedTheme==="dark"?t("الوضع الفاتح","Light theme"):t("الوضع الداكن","Dark theme")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
                className="justify-start"
              >
                <Globe className="h-4 w-4 ms-2" />
                {language === "ar" ? "English" : "العربية"}
              </Button>
            </nav>
          </div>
        )}
      </div>
    </header>
  )
}
