"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/components/language-provider"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"

export default function NotFound() {
  const { t } = useLanguage()

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-4 px-4">
          <h1 className="text-6xl font-bold text-primary">404</h1>
          <h2 className="text-2xl font-semibold">
            {t("الصفحة غير موجودة", "Page Not Found")}
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            {t(
              "عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها.",
              "Sorry, the page you're looking for doesn't exist or has been moved."
            )}
          </p>
          <Button asChild>
            <Link href="/">{t("العودة للرئيسية", "Go Home")}</Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  )
}
