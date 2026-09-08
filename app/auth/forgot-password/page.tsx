"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { useLanguage } from "@/components/language-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"

export default function ForgotPasswordPage() {
  const { t, isRTL } = useLanguage()
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=%2Fauth%2Freset-password`,
      })
      if (error) throw error
      setSent(true)
    } catch {
      setError(t("تعذر إرسال الرابط. يرجى المحاولة لاحقاً.", "Unable to send the link. Please try again later."))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <Header />
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t("استعادة كلمة المرور", "Reset your password")}</CardTitle>
            <CardDescription>{t("سنرسل لك رابطاً لتغيير كلمة المرور.", "We will email you a link to change your password.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sent ? <p role="status" className="text-sm">{t("إذا كان هناك حساب بهذا البريد، فستصلك رسالة لاستعادة كلمة المرور. تحقق من صندوق الوارد والبريد غير المرغوب فيه.", "If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.")}</p> : (
              <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">{t("البريد الإلكتروني", "Email")}</Label>
                  <Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={pending}>{pending ? t("جاري الإرسال...", "Sending...") : t("إرسال رابط الاستعادة", "Send reset link")}</Button>
              </form>
            )}
            <Link href="/auth/login" className="block text-center text-sm underline">{t("العودة لتسجيل الدخول", "Back to login")}</Link>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  )
}
