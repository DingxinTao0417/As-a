"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLanguage } from "@/components/language-provider"
import {
  Search,
  Menu,
  X,
  ChevronDown,
  Globe,
  User,
  LogOut,
  MessageCircle,
  LayoutDashboard,
  Heart,
  History,
  Briefcase,
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

export function Header() {
  const { language, setLanguage, t } = useLanguage()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [userRole, setUserRole] = useState<"seeker" | "provider" | null>(null)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      if (user) {
        setUserRole(user.user_metadata?.role || "seeker")
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        setUserRole(session.user.user_metadata?.role || "seeker")
      } else {
        setUserRole(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
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

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors">
                {t("الخدمات", "Services")}
                <ChevronDown className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <Link href="/services/seeker">{t("تصفح المحترفين", "Browse Professionals")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/services/provider">{t("كن مقدم خدمة", "Become a Provider")}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Link href="/about" className="text-sm font-medium hover:text-primary transition-colors">
              {t("من نحن", "About")}
            </Link>
          </nav>

          {/* Search Bar */}
          <div className="hidden md:flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t("ما المهمة التي تريد إنجازها؟", "What task do you need done?")} className="pr-10" />
            </div>
          </div>

          <div className="flex items-center gap-3">
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
                  {userRole === "provider" ? (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href="/dashboard" className="flex items-center gap-2">
                          <LayoutDashboard className="h-4 w-4" />
                          {t("لوحة التحكم", "Dashboard")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/register/provider" className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4" />
                          {t("خدماتي", "My Services")}
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
                    </>
                  )}
                  <DropdownMenuItem asChild>
                    <Link href="/messages" className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4" />
                      {t("الرسائل", "Messages")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="h-4 w-4 ml-2" />
                    {t("تسجيل الخروج", "Logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button variant="outline" size="sm" asChild className="hidden sm:flex bg-transparent">
                <Link href="/auth/login">{t("تسجيل الدخول", "Login")}</Link>
              </Button>
            )}

            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
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
                {t("تصفح المحترفين", "Browse Professionals")}
              </Link>
              <Link href="/services/provider" className="text-sm font-medium hover:text-primary transition-colors">
                {t("كن مقدم خدمة", "Become a Provider")}
              </Link>
              <Link href="/about" className="text-sm font-medium hover:text-primary transition-colors">
                {t("من نحن", "About")}
              </Link>
              {user && (
                <>
                  <Link href="/profile" className="text-sm font-medium hover:text-primary transition-colors">
                    {t("الملف الشخصي", "Profile")}
                  </Link>
                  {userRole === "provider" ? (
                    <>
                      <Link href="/dashboard" className="text-sm font-medium hover:text-primary transition-colors">
                        {t("لوحة التحكم", "Dashboard")}
                      </Link>
                      <Link
                        href="/register/provider"
                        className="text-sm font-medium hover:text-primary transition-colors"
                      >
                        {t("خدماتي", "My Services")}
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
                    </>
                  )}
                  <Link
                    href="/messages"
                    className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-2"
                  >
                    <MessageCircle className="h-4 w-4" />
                    {t("الرسائل", "Messages")}
                  </Link>
                  <Button variant="ghost" size="sm" onClick={handleLogout} className="justify-start text-red-600">
                    <LogOut className="h-4 w-4 ml-2" />
                    {t("تسجيل الخروج", "Logout")}
                  </Button>
                </>
              )}
              {!user && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/auth/login">{t("تسجيل الدخول", "Login")}</Link>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
                className="justify-start"
              >
                <Globe className="h-4 w-4 ml-2" />
                {language === "ar" ? "English" : "العربية"}
              </Button>
            </nav>
          </div>
        )}
      </div>
    </header>
  )
}
