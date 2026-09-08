"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { verifyPayment } from "@/app/actions/orders"
import { useLanguage } from "@/components/language-provider"
import { useToast } from "@/hooks/use-toast"

/** Verify once after auth is ready, preserving the conversation destination. */
export function usePaymentReturn(search: string, authenticated: boolean) {
  const router = useRouter()
  const { t } = useLanguage()
  const { toast } = useToast()
  const processed = useRef<string | null>(null)
  const [verifiedVersion, setVerifiedVersion] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(search)
    const status = params.get("payment")
    const orderId = params.get("order_id")
    if (!authenticated || !orderId || (status !== "callback" && status !== "success")) return
    if (processed.current === orderId) return
    processed.current = orderId

    // Provider/conversation parameters are still needed by conversation loading.
    params.delete("payment")
    params.delete("order_id")
    params.delete("tap_id")
    const remaining = params.toString()
    router.replace(remaining ? `/messages?${remaining}` : "/messages", { scroll: false })

    async function verify() {
      try {
        const result = await verifyPayment(orderId!)
        if (!result.success) {
          toast({ title: t("تعذر تأكيد الدفع", "Payment could not be verified"), description: result.error, variant: "destructive" })
          return
        }
        setVerifiedVersion((version) => version + 1)
      } catch {
        toast({ title: t("تعذر تأكيد الدفع", "Payment could not be verified"), description: t("تحقق من حالة الطلب قبل إعادة محاولة الدفع.", "Check your order status before trying to pay again."), variant: "destructive" })
      }
    }
    void verify()
  }, [search, authenticated, router, t, toast])

  return verifiedVersion
}
