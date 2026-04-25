"use client"

import { Button } from "@/components/ui/button"
import { useLanguage } from "@/components/language-provider"

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useLanguage()

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="text-center space-y-4 px-4">
        <h1 className="text-4xl font-bold text-destructive">
          {t("حدث خطأ", "Something went wrong")}
        </h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          {t(
            "عذراً، حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.",
            "Sorry, an unexpected error occurred. Please try again."
          )}
        </p>
        <Button onClick={reset}>
          {t("حاول مرة أخرى", "Try Again")}
        </Button>
      </div>
    </div>
  )
}
