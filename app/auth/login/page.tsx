"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { safeAuthNext } from "@/components/auth-navigation"
import { useLanguage } from "@/components/language-provider"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)
  const router = useRouter()
  const { language, isRTL } = useLanguage()

  useEffect(() => {
    setCallbackFailed(new URLSearchParams(window.location.search).get("error") === "auth_callback_failed")
  }, [])

  const content = {
    ar: {
      title: "تسجيل الدخول",
      description: "أدخل بريدك الإلكتروني وكلمة المرور للوصول إلى حسابك",
      email: "البريد الإلكتروني",
      emailPlaceholder: "example@email.com",
      password: "كلمة المرور",
      loginButton: "تسجيل الدخول",
      loggingIn: "جاري تسجيل الدخول...",
      noAccount: "ليس لديك حساب؟",
      signUp: "إنشاء حساب",
    },
    en: {
      title: "Login",
      description: "Enter your email and password to access your account",
      email: "Email",
      emailPlaceholder: "example@email.com",
      password: "Password",
      loginButton: "Login",
      loggingIn: "Logging in...",
      noAccount: "Don't have an account?",
      signUp: "Sign up",
    },
  }

  const t = content[language]

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    setIsLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
      const next = safeAuthNext(new URLSearchParams(window.location.search).get("next"))
      router.replace(next)
      router.refresh()
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <Header />
      <main className="flex-1 flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{t.title}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email">{t.email}</Label>
                  <Input
                    id="email"
                    name="email"
                    autoComplete="email"
                    type="email"
                    placeholder={t.emailPlaceholder}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">{t.password}</Label>
                    <Link href="/auth/forgot-password" className="text-xs text-muted-foreground hover:text-primary transition-colors">
                      {language === "ar" ? "نسيت كلمة المرور؟" : "Forgot password?"}
                    </Link>
                  </div>
                  <Input
                    id="password"
                    name="password"
                    autoComplete="current-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {callbackFailed && (
                  <p role="alert" className="text-sm text-destructive">
                    {language === "ar"
                      ? "الرابط غير صالح أو انتهت صلاحيته. سجّل الدخول أو اطلب رابطاً جديداً."
                      : "This link is invalid or expired. Sign in or request a new link."}
                  </p>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? t.loggingIn : t.loginButton}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                {t.noAccount}{" "}
                <Link href="/auth/signup" className="underline underline-offset-4">
                  {t.signUp}
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      </main>
      <Footer />
    </div>
  )
}
