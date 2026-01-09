"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useLanguage } from "./language-provider"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { DollarSign, X } from "lucide-react"
import { createOrder } from "@/app/actions/orders"
import { formatCurrency, PLATFORM_FEE_PERCENTAGE } from "@/lib/stripe"

interface CreateOrderDialogProps {
  conversationId: string
  seekerId: string
  providerId: string
  onClose: () => void
  onSuccess: () => void
}

export function CreateOrderDialog({
  conversationId,
  seekerId,
  providerId,
  onClose,
  onSuccess,
}: CreateOrderDialogProps) {
  const { language } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [formData, setFormData] = useState({
    serviceNameAr: "",
    serviceNameEn: "",
    serviceDescriptionAr: "",
    serviceDescriptionEn: "",
    amount: "",
  })

  useEffect(() => {
    console.log("[v0] CreateOrderDialog mounted with props:", {
      conversationId,
      seekerId,
      providerId,
    })
  }, [conversationId, seekerId, providerId])

  const amountCents = Math.round(Number.parseFloat(formData.amount || "0") * 100)
  const platformFeeCents = Math.round(amountCents * PLATFORM_FEE_PERCENTAGE)
  const providerAmountCents = amountCents - platformFeeCents

  const isValidAmount = amountCents >= 100 // Minimum $1.00
  const canSubmit = isValidAmount && formData.serviceNameAr && formData.serviceNameEn && !loading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    console.log("[v0] ========== ORDER CREATION STARTED ==========")
    console.log("[v0] Form submit triggered")
    console.log("[v0] Form data:", formData)
    console.log("[v0] Amount validation:", { amountCents, isValidAmount, canSubmit })
    console.log("[v0] IDs:", { conversationId, seekerId, providerId })

    if (!isValidAmount) {
      setError(language === "ar" ? "الحد الأدنى للمبلغ هو $1.00" : "Minimum amount is $1.00")
      return
    }

    if (!formData.serviceNameAr || !formData.serviceNameEn) {
      setError(language === "ar" ? "يرجى ملء اسم الخدمة بكلا اللغتين" : "Please fill in service name in both languages")
      return
    }

    setLoading(true)

    try {
      console.log("[v0] Submitting order with data:", {
        conversationId,
        seekerId,
        providerId,
        amountCents,
      })

      const result = await createOrder({
        conversationId,
        seekerId,
        providerId,
        serviceNameAr: formData.serviceNameAr,
        serviceNameEn: formData.serviceNameEn,
        serviceDescriptionAr: formData.serviceDescriptionAr,
        serviceDescriptionEn: formData.serviceDescriptionEn,
        amountCents,
      })

      console.log("[v0] Order creation result:", result)

      if (result.error) {
        console.error("[v0] Order creation failed:", result.error)
        setError(result.error)
      } else {
        console.log("[v0] Order created successfully")
        onSuccess()
        onClose()
      }
    } catch (err) {
      console.error("[v0] Unexpected error:", err)
      setError(`Failed to create quote: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setLoading(false)
    }
  }

  const handleCloseClick = () => {
    console.log("[v0] Close button clicked")
    onClose()
  }

  const handleCancelClick = () => {
    console.log("[v0] Cancel button clicked")
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">{language === "ar" ? "إنشاء عرض سعر" : "Create Quote"}</h2>
            <Button variant="ghost" size="icon" onClick={handleCloseClick}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                {language === "ar" ? "اسم الخدمة (عربي)" : "Service Name (Arabic)"}
              </label>
              <Input
                required
                value={formData.serviceNameAr}
                onChange={(e) => setFormData({ ...formData, serviceNameAr: e.target.value })}
                placeholder={language === "ar" ? "أدخل اسم الخدمة بالعربية" : "Enter service name in Arabic"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {language === "ar" ? "اسم الخدمة (إنجليزي)" : "Service Name (English)"}
              </label>
              <Input
                required
                value={formData.serviceNameEn}
                onChange={(e) => setFormData({ ...formData, serviceNameEn: e.target.value })}
                placeholder={language === "ar" ? "أدخل اسم الخدمة بالإنجليزية" : "Enter service name in English"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {language === "ar" ? "وصف الخدمة (عربي)" : "Service Description (Arabic)"}
              </label>
              <Textarea
                value={formData.serviceDescriptionAr}
                onChange={(e) => setFormData({ ...formData, serviceDescriptionAr: e.target.value })}
                placeholder={language === "ar" ? "أدخل تفاصيل الخدمة بالعربية" : "Enter service details in Arabic"}
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {language === "ar" ? "وصف الخدمة (إنجليزي)" : "Service Description (English)"}
              </label>
              <Textarea
                value={formData.serviceDescriptionEn}
                onChange={(e) => setFormData({ ...formData, serviceDescriptionEn: e.target.value })}
                placeholder={language === "ar" ? "أدخل تفاصيل الخدمة بالإنجليزية" : "Enter service details in English"}
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {language === "ar" ? "السعر (USD)" : "Price (USD)"}
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  className="pl-10"
                />
              </div>
              {!isValidAmount && formData.amount && (
                <p className="text-sm text-destructive mt-1">
                  {language === "ar" ? "الحد الأدنى: $1.00" : "Minimum: $1.00"}
                </p>
              )}
            </div>

            {amountCents > 0 && (
              <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>{language === "ar" ? "المبلغ الإجمالي:" : "Total Amount:"}</span>
                  <span className="font-semibold">{formatCurrency(amountCents)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    {language === "ar"
                      ? `رسوم المنصة (${PLATFORM_FEE_PERCENTAGE * 100}%):`
                      : `Platform Fee (${PLATFORM_FEE_PERCENTAGE * 100}%):`}
                  </span>
                  <span>-{formatCurrency(platformFeeCents)}</span>
                </div>
                <div className="flex justify-between font-semibold pt-2 border-t">
                  <span>{language === "ar" ? "سوف تستلم:" : "You will receive:"}</span>
                  <span className="text-primary">{formatCurrency(providerAmountCents)}</span>
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
                onClick={() => console.log("[v0] Submit button clicked, canSubmit:", canSubmit)}
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
