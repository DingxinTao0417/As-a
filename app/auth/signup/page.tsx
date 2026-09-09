"use client"

import { Label } from "@/components/ui/label"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useLanguage } from "@/components/language-provider"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [role, setRole] = useState<"seeker" | "provider">("seeker")
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { language, isRTL } = useLanguage()

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("role") === "provider") setRole("provider")
  }, [])

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
      role: "أريد التسجيل كـ",
      seeker: "باحث عن خدمات",
      seekerDesc: "أبحث عن محترفين لتنفيذ مشاريعي",
      provider: "مقدم خدمات",
      providerDesc: "أقدم خدماتي المهنية للآخرين",
      signupButton: "إنشاء حساب",
      creatingAccount: "جاري إنشاء الحساب...",
      haveAccount: "لديك حساب بالفعل؟",
      login: "تسجيل الدخول",
      passwordMismatch: "كلمة المرور غير متطابقة",
      success: "تم إنشاء الحساب! يرجى التحقق من بريدك الإلكتروني.",
      termsRequired: "يجب الموافقة على شروط الاستخدام وسياسة الخصوصية",
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
      role: "I want to register as",
      seeker: "Service Seeker",
      seekerDesc: "Looking for professionals to complete my projects",
      provider: "Service Provider",
      providerDesc: "Offering my professional services to others",
      signupButton: "Sign up",
      creatingAccount: "Creating account...",
      haveAccount: "Already have an account?",
      login: "Login",
      passwordMismatch: "Passwords do not match",
      success: "Account created! Please check your email.",
      termsRequired: "You must agree to the Terms of Service and Privacy Policy",
    },
  }

  const t = content[language]

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading || success) return
    setIsLoading(true)
    setError(null)

    if (password !== repeatPassword) {
      setError(t.passwordMismatch)
      setIsLoading(false)
      return
    }

    if (!agreedToTerms) {
      setError(t.termsRequired)
      setIsLoading(false)
      return
    }

    try {
      if (!fullName.trim() || password.length < 8) {
        setError(language === "ar" ? "أدخل اسمك وكلمة مرور من 8 أحرف على الأقل." : "Enter your name and a password of at least 8 characters.")
        return
      }
      const supabase = createClient()
      const destination = role === "provider" ? "/register/provider" : "/"
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`,
          data: {
            full_name: fullName.trim(),
            role: role,
          },
        },
      })
      if (error) throw error

      if (data.session) {
        router.replace(destination)
        router.refresh()
      } else {
        setSuccess(true)
        setPassword("")
        setRepeatPassword("")
      }
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
            {success ? (
              <div className="space-y-4">
                <p role="status" className="text-sm">{t.success}</p>
                <Button asChild className="w-full"><Link href="/auth/login">{t.login}</Link></Button>
              </div>
            ) : (
            <form onSubmit={handleSignup}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="fullName">{t.fullName}</Label>
                  <Input
                    id="fullName"
                    autoComplete="name"
                    maxLength={100}
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
                    autoComplete="email"
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
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {password && (
                    <div className="space-y-1">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((level) => {
                          const strength = [
                            password.length >= 8,
                            /[A-Z]/.test(password),
                            /[0-9]/.test(password),
                            /[^A-Za-z0-9]/.test(password),
                          ].filter(Boolean).length
                          return (
                            <div
                              key={level}
                              className={`h-1 flex-1 rounded-full ${
                                level <= strength
                                  ? strength <= 1 ? "bg-red-500" : strength <= 2 ? "bg-amber-500" : strength <= 3 ? "bg-blue-500" : "bg-green-500"
                                  : "bg-muted"
                              }`}
                            />
                          )
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {(() => {
                          const s = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length
                          if (s <= 1) return language === "ar" ? "ضعيفة" : "Weak"
                          if (s === 2) return language === "ar" ? "متوسطة" : "Fair"
                          if (s === 3) return language === "ar" ? "جيدة" : "Good"
                          return language === "ar" ? "قوية" : "Strong"
                        })()}
                      </p>
                    </div>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="repeat-password">{t.repeatPassword}</Label>
                  <Input
                    id="repeat-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                  />
                </div>

                <div className="grid gap-3">
                  <Label>{t.role}</Label>
                  <RadioGroup value={role} onValueChange={(value) => setRole(value as "seeker" | "provider")}>
                    <div className="flex items-start space-x-3 space-x-reverse">
                      <RadioGroupItem value="seeker" id="seeker" />
                      <div className="grid gap-1.5 leading-none">
                        <label
                          htmlFor="seeker"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {t.seeker}
                        </label>
                        <p className="text-sm text-muted-foreground">{t.seekerDesc}</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3 space-x-reverse">
                      <RadioGroupItem value="provider" id="provider" />
                      <div className="grid gap-1.5 leading-none">
                        <label
                          htmlFor="provider"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {t.provider}
                        </label>
                        <p className="text-sm text-muted-foreground">{t.providerDesc}</p>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="terms"
                    checked={agreedToTerms}
                    onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
                  />
                  <label htmlFor="terms" className="text-sm text-muted-foreground leading-6">
                    {language === "ar" ? (
                      <>
                        أوافق على <Link href="/terms" className="underline">شروط الاستخدام</Link> و{" "}
                        <Link href="/privacy" className="underline">سياسة الخصوصية</Link>
                      </>
                    ) : (
                      <>
                        I agree to the <Link href="/terms" className="underline">Terms of Service</Link> and{" "}
                        <Link href="/privacy" className="underline">Privacy Policy</Link>
                      </>
                    )}
                  </label>
                </div>
                <Button type="submit" className="w-full" disabled={isLoading || !agreedToTerms}>
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
            )}
          </CardContent>
        </Card>
      </div>
      </main>
      <Footer />
    </div>
  )
}
