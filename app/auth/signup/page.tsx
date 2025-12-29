"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useLanguage } from "@/components/language-provider"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { language, isRTL } = useLanguage()

  const content = {
    ar: {
      title: "إنشاء حساب جديد",
      description: "أدخل بياناتك لإنشاء حساب جديد في المنصة",
      fullName: "الاسم الكامل",
      fullNamePlaceholder: "أحمد محمد",
      email: "البريد الإلكتروني",
      emailPlaceholder: "example@email.com",
      password: "كلمة المرور",
      repeatPassword: "تأكيد كلمة المرور",
      signupButton: "إنشاء حساب",
      creatingAccount: "جاري إنشاء الحساب...",
      haveAccount: "لديك حساب بالفعل؟",
      login: "تسجيل الدخول",
      passwordMismatch: "كلمة المرور غير متطابقة",
      success: "تم إنشاء الحساب! يرجى التحقق من بريدك الإلكتروني.",
    },
    en: {
      title: "Create New Account",
      description: "Enter your information to create a new account",
      fullName: "Full Name",
      fullNamePlaceholder: "Ahmed Mohammed",
      email: "Email",
      emailPlaceholder: "example@email.com",
      password: "Password",
      repeatPassword: "Repeat Password",
      signupButton: "Sign up",
      creatingAccount: "Creating account...",
      haveAccount: "Already have an account?",
      login: "Login",
      passwordMismatch: "Passwords do not match",
      success: "Account created! Please check your email.",
    },
  }

  const t = content[language]

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    if (password !== repeatPassword) {
      setError(t.passwordMismatch)
      setIsLoading(false)
      return
    }

    console.log("[v0] Starting signup process")

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL || `${window.location.origin}`,
          data: {
            full_name: fullName,
          },
        },
      })
      if (error) {
        console.error("[v0] Signup error:", error)
        throw error
      }

      console.log("[v0] Signup successful")
      alert(t.success)
      router.push("/auth/login")
    } catch (error: unknown) {
      console.error("[v0] Signup failed:", error)
      setError(error instanceof Error ? error.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-6 md:p-10" dir={isRTL ? "rtl" : "ltr"}>
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{t.title}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignup}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="fullName">{t.fullName}</Label>
                  <Input
                    id="fullName"
                    type="text"
                    placeholder={t.fullNamePlaceholder}
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">{t.email}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t.emailPlaceholder}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">{t.password}</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="repeat-password">{t.repeatPassword}</Label>
                  <Input
                    id="repeat-password"
                    type="password"
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? t.creatingAccount : t.signupButton}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                {t.haveAccount}{" "}
                <Link href="/auth/login" className="underline underline-offset-4">
                  {t.login}
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
