"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { useLanguage } from "@/components/language-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

export default function ResetPasswordPage() {
  const { t, isRTL } = useLanguage()
  const [ready, setReady] = useState<boolean | null>(null)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function checkSession() {
      try {
        const { data, error } = await createClient().auth.getUser()
        if (active) setReady(!error && !!data.user)
      } catch {
        if (active) setReady(false)
      }
    }
    void checkSession()
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !ready) return
    setError(null)
    if (password.length < 8 || password !== confirmation) {
      setError(t("استخدم 8 أحرف على الأقل وتأكد من تطابق كلمتي المرور.", "Use at least 8 characters and make sure the passwords match."))
      return
    }
    setPending(true)
    try {
      const { error } = await createClient().auth.updateUser({ password })
      if (error) throw error
      setSaved(true)
      setPassword("")
      setConfirmation("")
    } catch {
      setError(t("تعذر تغيير كلمة المرور. أعد المحاولة أو اطلب رابطاً جديداً.", "Unable to change your password. Try again or request a new reset link."))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <Header />
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle>{t("اختر كلمة مرور جديدة", "Choose a new password")}</CardTitle></CardHeader>
          <CardContent>
            {ready === null ? <p role="status">{t("جاري التحقق...", "Checking your reset link...")}</p> : saved ? (
              <div className="space-y-4">
                <p role="status">{t("تم تغيير كلمة المرور بنجاح.", "Your password has been updated.")}</p>
                <Button asChild className="w-full"><Link href="/">{t("الانتقال للرئيسية", "Go to home")}</Link></Button>
              </div>
            ) : !ready ? (
              <div className="space-y-4">
                <p role="alert">{t("الرابط غير صالح أو انتهت صلاحيته.", "This reset link is invalid or expired.")}</p>
                <Link href="/auth/forgot-password" className="text-sm underline">{t("طلب رابط جديد", "Request a new link")}</Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="password">{t("كلمة المرور الجديدة", "New password")}</Label>
                  <Input id="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirmation">{t("تأكيد كلمة المرور", "Confirm password")}</Label>
                  <Input id="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button className="w-full" type="submit" disabled={pending}>{pending ? t("جاري الحفظ...", "Saving...") : t("تغيير كلمة المرور", "Update password")}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  )
}
