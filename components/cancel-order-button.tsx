"use client"

import { useState } from "react"
import { cancelPendingOrder } from "@/app/actions/orders"
import { useLanguage } from "@/components/language-provider"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

export function CancelOrderButton({ orderId, onCancelled }: { orderId: string; onCancelled: () => void | Promise<void> }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cancel() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await cancelPendingOrder(orderId)
      if (!result.success) {
        setError(result.error)
        return
      }
      setOpen(false)
      await onCancelled()
    } catch {
      setError(t("تعذر إلغاء الطلب. أعد تحميل حالة الطلب قبل المحاولة مجدداً.", "Unable to cancel this order. Reload its status before trying again."))
    } finally { setPending(false) }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setError(null); setOpen(true) }}>{t("إلغاء الطلب", "Cancel order")}</Button>
      <AlertDialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value) }}>
        <AlertDialogContent onClick={(event) => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("إلغاء الطلب غير المدفوع", "Cancel unpaid order")}</AlertDialogTitle>
            <AlertDialogDescription>{t("يمكن إلغاء العرض إذا لم تبدأ عملية الدفع. إذا بدأت عملية الدفع، يجب التحقق من نتيجتها أولاً.", "You can cancel this quote if checkout has not started. If checkout has started, its payment outcome must be checked first.")}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("رجوع", "Go back")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void cancel() }}>{pending ? t("جاري الإلغاء...", "Cancelling...") : t("تأكيد الإلغاء", "Confirm cancellation")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
