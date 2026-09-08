"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useLanguage } from "./language-provider"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import { CircleDollarSign, X } from "lucide-react"
import { createOrder } from "@/app/actions/orders"
import { calculateFees, formatCurrency, PLATFORM_FEE_PERCENTAGE, MAX_SAR_AMOUNT, toSARMinorUnits } from "@/lib/money"

interface CreateOrderDialogProps {
  conversationId: string
  seekerId: string
  providerId: string
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

  const [formData, setFormData] = useState({
    serviceNameAr: prefill?.serviceNameAr ?? "",
    serviceNameEn: prefill?.serviceNameEn ?? "",
    serviceDescriptionAr: prefill?.serviceDescriptionAr ?? "",
    serviceDescriptionEn: prefill?.serviceDescriptionEn ?? "",
    amount: prefill?.amount ?? "",
  })

  useEffect(() => {
    if (prefill) {
      setFormData({
        serviceNameAr: prefill.serviceNameAr,
        serviceNameEn: prefill.serviceNameEn,
        serviceDescriptionAr: prefill.serviceDescriptionAr,
        serviceDescriptionEn: prefill.serviceDescriptionEn,
        amount: prefill.amount,
      })
    }
  }, [prefill])

  const amount = Number(formData.amount || "0")
  const fees = calculateFees(Number.isFinite(amount) ? amount : 0)

  const isValidAmount = amount >= 1 && toSARMinorUnits(amount) !== null
  const canSubmit = isValidAmount && formData.serviceNameAr.trim() && formData.serviceNameEn.trim() && !loading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
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

    try {
      const result = await createOrder({
        conversationId,
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
        onSuccess()
        onClose()
      }
    } catch (err) {
      setError(`Failed to create quote: ${err instanceof Error ? err.message : "Unknown error"}`)
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
                onChange={(e) => setFormData({ ...formData, serviceNameAr: e.target.value })}
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
                onChange={(e) => setFormData({ ...formData, serviceNameEn: e.target.value })}
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
                onChange={(e) => setFormData({ ...formData, serviceDescriptionAr: e.target.value })}
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
                onChange={(e) => setFormData({ ...formData, serviceDescriptionEn: e.target.value })}
                placeholder={language === "ar" ? "أدخل تفاصيل الخدمة بالإنجليزية" : "Enter service details in English"}
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="order-amount" className="block text-sm font-medium mb-2">
                {language === "ar" ? "السعر (ر.س)" : "Price (SAR)"}
              </Label>
              <div className="relative">
                <CircleDollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="order-amount"
                  required
                  type="number"
                  min="1"
                  max={MAX_SAR_AMOUNT}
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  className="pl-10"
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
                  <span>{language === "ar" ? "إجمالي المبلغ المستحق على العميل:" : "Total charged to customer:"}</span>
                  <span className="font-semibold">{formatCurrency(fees.amount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    {language === "ar"
                      ? `رسوم المنصة (${PLATFORM_FEE_PERCENTAGE * 100}%):`
                      : `Platform Fee (${PLATFORM_FEE_PERCENTAGE * 100}%):`}
                  </span>
                  <span>-{formatCurrency(fees.platformFee)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{language === "ar" ? "سوف تستلم:" : "You will receive:"}</span>
                  <span>{formatCurrency(fees.providerAmount)}</span>
                </div>
              </div>
            )}

            {error && <div role="alert" className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm">{error}</div>}

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
