"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useLanguage } from "@/components/language-provider"
import {
  CheckCircle2,
  TrendingUp,
  Users,
  DollarSign,
  Calendar,
  Star,
  ArrowRight,
  Shield,
  Clock,
  Briefcase,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { PLATFORM_FEE_PERCENTAGE } from "@/lib/money"

export default function ServiceProviderPage() {
  const { t } = useLanguage()
  const router = useRouter()

  const handleStartNow = async () => {
    const { data } = await createClient().auth.getUser()
    router.push(data.user ? "/register/provider" : "/auth/signup?role=provider")
  }

  const benefits = [
    {
      icon: Users,
      titleAr: "اعرض خدماتك",
      titleEn: "Showcase Your Services",
      descAr: "اعرض خدماتك لقاعدة واسعة من العملاء المحتملين في السعودية",
      descEn: "Showcase your services to a wide base of potential clients in Saudi Arabia",
    },
    {
      icon: DollarSign,
      titleAr: "حدد أسعارك",
      titleEn: "Set Your Prices",
      descAr: "حدد سعر خدماتك وأرسل عروض أسعار واضحة للعملاء",
      descEn: "Set service prices and send clear quotes to clients",
    },
    {
      icon: Calendar,
      titleAr: "مرونة في العمل",
      titleEn: "Work Flexibility",
      descAr: "اختر مشاريعك ووقت عملك بما يناسب جدولك",
      descEn: "Choose your projects and work hours that fit your schedule",
    },
    {
      icon: Shield,
      titleAr: "تفاصيل واضحة",
      titleEn: "Clear Order Details",
      descAr: "احتفظ بنطاق العمل وعرض السعر والمحادثات في حسابك",
      descEn: "Keep the work scope, quote, and conversations in your account",
    },
    {
      icon: Star,
      titleAr: "بناء سمعتك",
      titleEn: "Build Your Reputation",
      descAr: "اعرض خبراتك وأعمالك في ملفك المهني",
      descEn: "Show your experience and past work in your professional profile",
    },
    {
      icon: TrendingUp,
      titleAr: "نمو مستمر",
      titleEn: "Continuous Growth",
      descAr: "طور مهاراتك ووسع نطاق عملك باستمرار",
      descEn: "Develop your skills and expand your work scope continuously",
    },
  ]

  const steps = [
    {
      number: "1",
      titleAr: "أنشئ حسابك",
      titleEn: "Create Account",
      descAr: "سجل معلوماتك الأساسية وأكمل ملفك الشخصي",
      descEn: "Register your basic information and complete your profile",
    },
    {
      number: "2",
      titleAr: "أضف خدماتك",
      titleEn: "Add Services",
      descAr: "حدد خدماتك، أسعارك، ومدة التسليم",
      descEn: "Define your services, prices, and delivery time",
    },
    {
      number: "3",
      titleAr: "استقبل الطلبات",
      titleEn: "Receive Orders",
      descAr: "ابدأ في استقبال طلبات العملاء وتنفيذها",
      descEn: "Start receiving and fulfilling client orders",
    },
    {
      number: "4",
      titleAr: "احصل على أرباحك",
      titleEn: "Get Paid",
      descAr: "استلم أرباحك بعد إتمام المشاريع بنجاح",
      descEn: "Receive your earnings after successful project completion",
    },
  ]

  const features = [
    {
      icon: CheckCircle2,
      titleAr: "مراجعة الخدمات",
      titleEn: "Service Review",
      descAr: "تُراجع الخدمات قبل ظهورها للعملاء",
      descEn: "Services are reviewed before appearing to clients",
    },
    {
      icon: Clock,
      titleAr: "رسائل مباشرة",
      titleEn: "Direct Messages",
      descAr: "ناقش احتياجات المشروع مع العميل من داخل حسابك",
      descEn: "Discuss project requirements with clients from your account",
    },
    {
      icon: Briefcase,
      titleAr: "لوحة تحكم متقدمة",
      titleEn: "Advanced Dashboard",
      descAr: "إدارة سهلة لخدماتك وطلباتك",
      descEn: "Easy management of your services and orders",
    },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="bg-gradient-to-b from-primary/5 to-background py-20 md:py-32">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto text-center space-y-8">
              <h1 className="text-4xl md:text-6xl font-bold text-secondary text-balance">
                {t("انضم كمقدم خدمة", "Join as Service Provider")}
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground text-balance">
                {t(
                  "حول خبراتك ومهاراتك إلى دخل ثابت. ابدأ رحلتك المهنية معنا اليوم",
                  "Turn your expertise and skills into stable income. Start your professional journey with us today",
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-lg px-8" onClick={handleStartNow}>
                  {t("ابدأ الآن مجاناً", "Start Free Now")}
                  <ArrowRight className="me-2 h-5 w-5" />
                </Button>
                <Button size="lg" variant="outline" className="text-lg px-8 bg-transparent" asChild>
                  <Link href="#pricing">{t("تصفح الباقات", "View Plans")}</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary mb-4">
                {t("لماذا تنضم لأسعى؟", "Why Join As'aa?")}
              </h2>
              <p className="text-muted-foreground text-lg">
                {t("مزايا تجعل تجربتك معنا استثنائية", "Benefits that make your experience exceptional")}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {benefits.map((benefit, index) => {
                const Icon = benefit.icon
                return (
                  <Card key={index} className="p-6 hover:shadow-lg transition-shadow">
                    <div className="flex flex-col items-start space-y-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="font-semibold text-lg">{t(benefit.titleAr, benefit.titleEn)}</h3>
                      <p className="text-sm text-muted-foreground">{t(benefit.descAr, benefit.descEn)}</p>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 md:py-24 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary mb-4">{t("كيف تبدأ؟", "How to Start?")}</h2>
              <p className="text-muted-foreground text-lg">
                {t("أربع خطوات بسيطة للبدء في كسب المال", "Four simple steps to start earning money")}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
              {steps.map((step, index) => (
                <div key={index} className="relative">
                  <div className="space-y-4">
                    <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">
                      {step.number}
                    </div>
                    <h3 className="text-xl font-semibold">{t(step.titleAr, step.titleEn)}</h3>
                    <p className="text-muted-foreground">{t(step.descAr, step.descEn)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary mb-4">
                {t("مميزات إضافية", "Additional Features")}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {features.map((feature, index) => {
                const Icon = feature.icon
                return (
                  <Card key={index} className="p-6 text-center">
                    <div className="flex flex-col items-center space-y-4">
                      <div className="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center">
                        <Icon className="h-6 w-6 text-secondary" />
                      </div>
                      <h3 className="font-semibold text-lg">{t(feature.titleAr, feature.titleEn)}</h3>
                      <p className="text-sm text-muted-foreground">{t(feature.descAr, feature.descEn)}</p>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-16 md:py-24 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary mb-4">
                {t("رسوم واضحة", "Clear Pricing")}
              </h2>
              <p className="text-muted-foreground text-lg">
                {t("راجع الرسوم وصافي أرباحك عند إنشاء كل عرض سعر", "Review the fee and your earnings when creating each quote")}
              </p>
            </div>
            <Card className="p-8 max-w-xl mx-auto text-center space-y-5">
              <h3 className="text-xl font-semibold">{t("رسوم المنصة لكل طلب", "Platform fee per order")}</h3>
              <p className="text-4xl font-bold text-primary">{PLATFORM_FEE_PERCENTAGE * 100}%</p>
              <p className="text-sm text-muted-foreground">{t("تُخصم رسوم المنصة من مبلغ الطلب، ويظهر صافي المبلغ المستحق لك قبل إرسال العرض.", "The platform fee is deducted from the order amount. Your net earnings are shown before you send the quote.")}</p>
              <Button onClick={handleStartNow}>{t("إنشاء ملف مقدم خدمة", "Create a provider profile")}</Button>
            </Card>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 md:py-24 bg-secondary text-secondary-foreground">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold">{t("هل أنت مستعد للانضمام؟", "Ready to Join?")}</h2>
              <p className="text-lg opacity-90">
                {t(
                  "ابدأ رحلتك المهنية اليوم وكن جزءاً من مجتمع المحترفين",
                  "Start your professional journey today and be part of the professional community",
                )}
              </p>
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-lg px-8" onClick={handleStartNow}>
                {t("سجل الآن مجاناً", "Register Free Now")}
                <ArrowRight className="me-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
