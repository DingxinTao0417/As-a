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

export default function ServiceProviderPage() {
  const { t } = useLanguage()
  const router = useRouter()

  const handleStartNow = () => {
    // Mark that user has seen the introduction page
    sessionStorage.setItem("provider_intro_seen", "true")
    router.push("/register/provider")
  }

  const benefits = [
    {
      icon: Users,
      titleAr: "وصول لآلاف العملاء",
      titleEn: "Access to Thousands of Clients",
      descAr: "اعرض خدماتك لقاعدة واسعة من العملاء المحتملين في السعودية",
      descEn: "Showcase your services to a wide base of potential clients in Saudi Arabia",
    },
    {
      icon: DollarSign,
      titleAr: "دخل إضافي مضمون",
      titleEn: "Guaranteed Additional Income",
      descAr: "حدد أسعارك بنفسك واحصل على دخل ثابت ومستقر",
      descEn: "Set your own prices and earn stable, consistent income",
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
      titleAr: "حماية قانونية",
      titleEn: "Legal Protection",
      descAr: "عقود محكمة وضمان حقوقك المالية",
      descEn: "Secure contracts and guaranteed financial rights",
    },
    {
      icon: Star,
      titleAr: "بناء سمعتك",
      titleEn: "Build Your Reputation",
      descAr: "احصل على تقييمات إيجابية وعزز ملفك المهني",
      descEn: "Get positive reviews and enhance your professional profile",
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
      titleAr: "التحقق من الهوية",
      titleEn: "Identity Verification",
      descAr: "عملية توثيق سريعة وآمنة",
      descEn: "Fast and secure verification process",
    },
    {
      icon: Clock,
      titleAr: "دعم فني 24/7",
      titleEn: "24/7 Technical Support",
      descAr: "فريق دعم متاح لمساعدتك دائماً",
      descEn: "Support team always available to help",
    },
    {
      icon: Briefcase,
      titleAr: "لوحة تحكم متقدمة",
      titleEn: "Advanced Dashboard",
      descAr: "إدارة سهلة لخدماتك وطلباتك",
      descEn: "Easy management of your services and orders",
    },
  ]

  const pricing = [
    {
      titleAr: "باقة البداية",
      titleEn: "Starter Plan",
      priceAr: "مجاناً",
      priceEn: "Free",
      featuresAr: ["عرض حتى 3 خدمات", "عمولة 15% على كل طلب", "دعم فني أساسي", "ملف شخصي عادي"],
      featuresEn: ["Up to 3 services", "15% commission per order", "Basic technical support", "Standard profile"],
    },
    {
      titleAr: "باقة المحترف",
      titleEn: "Professional Plan",
      priceAr: "99 ريال/شهرياً",
      priceEn: "99 SAR/month",
      featuresAr: [
        "عرض حتى 10 خدمات",
        "عمولة 10% على كل طلب",
        "دعم فني متقدم",
        "ملف شخصي مميز",
        "ظهور أولوية في البحث",
      ],
      featuresEn: [
        "Up to 10 services",
        "10% commission per order",
        "Advanced technical support",
        "Premium profile",
        "Priority in search results",
      ],
      popular: true,
    },
    {
      titleAr: "باقة النخبة",
      titleEn: "Elite Plan",
      priceAr: "199 ريال/شهرياً",
      priceEn: "199 SAR/month",
      featuresAr: [
        "خدمات غير محدودة",
        "عمولة 5% على كل طلب",
        "دعم فني مخصص",
        "ملف شخصي VIP",
        "أولوية قصوى في البحث",
        "تحليلات متقدمة",
      ],
      featuresEn: [
        "Unlimited services",
        "5% commission per order",
        "Dedicated technical support",
        "VIP profile",
        "Top priority in search",
        "Advanced analytics",
      ],
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
                {t("اختر الباقة المناسبة لك", "Choose Your Plan")}
              </h2>
              <p className="text-muted-foreground text-lg">
                {t("خطط مرنة تناسب جميع المستويات", "Flexible plans for all levels")}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {pricing.map((plan, index) => (
                <Card key={index} className={`p-6 ${plan.popular ? "border-2 border-primary shadow-lg relative" : ""}`}>
                  {plan.popular && (
                    <div className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2">
                      <span className="bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-semibold">
                        {t("الأكثر شعبية", "Most Popular")}
                      </span>
                    </div>
                  )}
                  <div className="space-y-6">
                    <div className="text-center">
                      <h3 className="text-2xl font-bold mb-2">{t(plan.titleAr, plan.titleEn)}</h3>
                      <div className="text-3xl font-bold text-primary mb-4">{t(plan.priceAr, plan.priceEn)}</div>
                    </div>
                    <ul className="space-y-3">
                      {plan.featuresAr.map((_, featureIndex) => (
                        <li key={featureIndex} className="flex items-start gap-2">
                          <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                          <span className="text-sm">
                            {t(plan.featuresAr[featureIndex], plan.featuresEn[featureIndex])}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className={`w-full ${plan.popular ? "bg-primary" : ""}`}
                      variant={plan.popular ? "default" : "outline"}
                    >
                      {t("اختر هذه الباقة", "Choose This Plan")}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
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
