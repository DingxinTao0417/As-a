"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useLanguage } from "./language-provider"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import { CircleDollarSign, X } from "lucide-react"
import { createOrder } from "@/app/actions/orders"
import { calculateFees, formatCurrency, PLATFORM_FEE_PERCENTAGE } from "@/lib/tap"

interface CreateOrderDialogProps {
  conversationId: string
  serviceId?: string
  prefill?: {
    serviceNameAr: string
    serviceNameEn: string
    serviceDescriptionAr: string
    serviceDescriptionEn: string
    amount: string
  }
  onClose: () => void
  onSuccess: () => void
}

export function CreateOrderDialog({
  conversationId,
  serviceId,
  prefill,
  onClose,
  onSuccess,
}: CreateOrderDialogProps) {
  const { language, t } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const quoteRequestId = useRef<string | null>(null)

  const [formData, setFormData] = useState({
    serviceNameAr: prefill?.serviceNameAr ?? "",
    serviceNameEn: prefill?.serviceNameEn ?? "",
    serviceDescriptionAr: prefill?.serviceDescriptionAr ?? "",
    serviceDescriptionEn: prefill?.serviceDescriptionEn ?? "",
    amount: prefill?.amount ?? "",
  })

  useEffect(() => {
    if (prefill) {
      quoteRequestId.current = null
      setFormData({
        serviceNameAr: prefill.serviceNameAr,
        serviceNameEn: prefill.serviceNameEn,
        serviceDescriptionAr: prefill.serviceDescriptionAr,
        serviceDescriptionEn: prefill.serviceDescriptionEn,
        amount: prefill.amount,
      })
    }
  }, [prefill])

  const amount = Math.round(Number.parseFloat(formData.amount || "0") * 100) / 100
  const fees = calculateFees(amount)

  const isValidAmount = Number.parseFloat(formData.amount || "0") >= 1 // Minimum 1.00 SAR
  const canSubmit = isValidAmount && formData.serviceNameAr && formData.serviceNameEn && !loading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!isValidAmount) {
      setError(t("المبلغ يجب أن يكون 1 ريال على الأقل", "Amount must be at least 1.00 SAR"))
      return
    }

    if (!formData.serviceNameAr || !formData.serviceNameEn) {
      setError(language === "ar" ? "يرجى ملء اسم الخدمة بكلا اللغتين" : "Please fill in service name in both languages")
      return
    }

    setLoading(true)
    if (!quoteRequestId.current) quoteRequestId.current = crypto.randomUUID()

    try {
      const result = await createOrder({
        conversationId,
        clientRequestId: quoteRequestId.current,
        serviceNameAr: formData.serviceNameAr,
        serviceNameEn: formData.serviceNameEn,
        serviceDescriptionAr: formData.serviceDescriptionAr,
        serviceDescriptionEn: formData.serviceDescriptionEn,
        amount,
        serviceId,
      })

      if (!result.success) {
        setError(result.error)
      } else {
        quoteRequestId.current = null
        onSuccess()
        onClose()
      }
    } catch {
      setError(t("تعذر إنشاء عرض السعر. حاول مرة أخرى", "Could not create the quote. Try again"))
    } finally {
      setLoading(false)
    }
  }

  const handleCloseClick = () => {
    onClose()
  }

  const handleCancelClick = () => {
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">{language === "ar" ? "إنشاء عرض سعر" : "Create Quote"}</h2>
            <Button variant="ghost" size="icon" onClick={handleCloseClick} aria-label={t("إغلاق", "Close")}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="service-name-ar" className="block text-sm font-medium mb-2">
                {language === "ar" ? "اسم الخدمة (عربي)" : "Service Name (Arabic)"}
              </Label>
              <Input
                id="service-name-ar"
                required
                value={formData.serviceNameAr}
                onChange={(e) => {quoteRequestId.current=null;setFormData({ ...formData, serviceNameAr: e.target.value })}}
                placeholder={language === "ar" ? "أدخل اسم الخدمة بالعربية" : "Enter service name in Arabic"}
              />
            </div>

            <div>
              <Label htmlFor="service-name-en" className="block text-sm font-medium mb-2">
                {language === "ar" ? "اسم الخدمة (إنجليزي)" : "Service Name (English)"}
              </Label>
              <Input
                id="service-name-en"
                required
                value={formData.serviceNameEn}
                onChange={(e) => {quoteRequestId.current=null;setFormData({ ...formData, serviceNameEn: e.target.value })}}
                placeholder={language === "ar" ? "أدخل اسم الخدمة بالإنجليزية" : "Enter service name in English"}
              />
            </div>

            <div>
              <Label htmlFor="service-description-ar" className="block text-sm font-medium mb-2">
                {language === "ar" ? "وصف الخدمة (عربي)" : "Service Description (Arabic)"}
              </Label>
              <Textarea
                id="service-description-ar"
                value={formData.serviceDescriptionAr}
                onChange={(e) => {quoteRequestId.current=null;setFormData({ ...formData, serviceDescriptionAr: e.target.value })}}
                placeholder={language === "ar" ? "أدخل تفاصيل الخدمة بالعربية" : "Enter service details in Arabic"}
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="service-description-en" className="block text-sm font-medium mb-2">
                {language === "ar" ? "وصف الخدمة (إنجليزي)" : "Service Description (English)"}
              </Label>
              <Textarea
                id="service-description-en"
                value={formData.serviceDescriptionEn}
                onChange={(e) => {quoteRequestId.current=null;setFormData({ ...formData, serviceDescriptionEn: e.target.value })}}
                placeholder={language === "ar" ? "أدخل تفاصيل الخدمة بالإنجليزية" : "Enter service details in English"}
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="order-amount" className="block text-sm font-medium mb-2">
                {language === "ar" ? "السعر (ر.س)" : "Price (SAR)"}
              </Label>
              <div className="relative">
                <CircleDollarSign className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="order-amount"
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => {quoteRequestId.current=null;setFormData({ ...formData, amount: e.target.value })}}
                  placeholder="0.00"
                  className="ps-10"
                />
              </div>
              {!isValidAmount && formData.amount && (
                <p className="text-sm text-destructive mt-1">
                  {language === "ar" ? "الحد الأدنى: 1.00 ر.س" : "Minimum: 1.00 SAR"}
                </p>
              )}
            </div>

            {amount > 0 && (
              <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>{language === "ar" ? "إجمالي الطلب:" : "Order total:"}</span>
                  <span className="font-semibold text-primary">{formatCurrency(fees.amount,language)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    {language === "ar"
                      ? `رسوم المنصة (${PLATFORM_FEE_PERCENTAGE * 100}%):`
                      : `Platform Fee (${PLATFORM_FEE_PERCENTAGE * 100}%):`}
                  </span>
                  <span>-{formatCurrency(fees.platformFee,language)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{language === "ar" ? "سوف تستلم:" : "You will receive:"}</span>
                  <span>{formatCurrency(fees.providerAmount,language)}</span>
                </div>
              </div>
            )}

            {error && <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm">{error}</div>}

            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={handleCancelClick} className="flex-1 bg-transparent">
                {language === "ar" ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit}
                className="flex-1"
              >
                {loading
                  ? language === "ar"
                    ? "جاري الإنشاء..."
                    : "Creating..."
                  : language === "ar"
                    ? "إرسال العرض"
                    : "Send Quote"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
