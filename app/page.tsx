"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useLanguage } from "@/components/language-provider"
import {
  CheckCircle2,
  ShieldCheck,
  Users,
  TrendingUp,
  Star,
  ArrowRight,
  Briefcase,
  Code,
  Palette,
  Megaphone,
  Camera,
  FileText,
} from "lucide-react"
import Link from "next/link"

export default function HomePage() {
  const { t } = useLanguage()

  const values = [
    {
      icon: CheckCircle2,
      titleAr: "الالتزام",
      titleEn: "Commitment",
      descAr: "نضمن إنجاز مهامك بأعلى جودة وفي الوقت المحدد",
      descEn: "We ensure your tasks are completed with highest quality on time",
    },
    {
      icon: ShieldCheck,
      titleAr: "الاحتراف",
      titleEn: "Professionalism",
      descAr: "محترفون موثوقون ومعتمدون في مجالاتهم",
      descEn: "Trusted and certified professionals in their fields",
    },
    {
      icon: Star,
      titleAr: "الثقة",
      titleEn: "Trust",
      descAr: "منصة آمنة تحمي حقوق الجميع",
      descEn: "Secure platform protecting everyone's rights",
    },
    {
      icon: TrendingUp,
      titleAr: "تمكين المواهب",
      titleEn: "Empowering Talents",
      descAr: "نساعد المحترفين على النمو وتحقيق النجاح",
      descEn: "Helping professionals grow and achieve success",
    },
    {
      icon: Users,
      titleAr: "تسهيل الوصول",
      titleEn: "Easy Access",
      descAr: "نربطك بالمحترف المناسب بسرعة وسهولة",
      descEn: "Connecting you with the right professional quickly",
    },
  ]

  const services = [
    {
      icon: Code,
      titleAr: "البرمجة والتطوير",
      titleEn: "Programming & Development",
      priceAr: "من 500 ريال",
      priceEn: "From 500 SAR",
    },
    {
      icon: Palette,
      titleAr: "التصميم الجرافيكي",
      titleEn: "Graphic Design",
      priceAr: "من 300 ريال",
      priceEn: "From 300 SAR",
    },
    {
      icon: Megaphone,
      titleAr: "التسويق الرقمي",
      titleEn: "Digital Marketing",
      priceAr: "من 400 ريال",
      priceEn: "From 400 SAR",
    },
    {
      icon: Camera,
      titleAr: "التصوير والمونتاج",
      titleEn: "Photography & Video",
      priceAr: "من 600 ريال",
      priceEn: "From 600 SAR",
    },
    {
      icon: FileText,
      titleAr: "الكتابة والترجمة",
      titleEn: "Writing & Translation",
      priceAr: "من 200 ريال",
      priceEn: "From 200 SAR",
    },
    {
      icon: Briefcase,
      titleAr: "الاستشارات",
      titleEn: "Consulting",
      priceAr: "من 350 ريال",
      priceEn: "From 350 SAR",
    },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="bg-gradient-to-b from-secondary/5 to-background py-20 md:py-32">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto text-center space-y-8">
              <h1 className="text-4xl md:text-6xl font-bold text-secondary text-balance">
                {t("أسعى.. والباقي علينا", "You Strive.. and the Rest is on Us")}
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground text-balance">
                {t(
                  "نربط من يسعى بالفرص التي يستحقها، ونجعل الإنجاز تجربة بسيطة وواضحة",
                  "We connect those who strive with the opportunities they deserve, making achievement simple and clear",
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-lg px-8" asChild>
                  <Link href="/services">
                    {t("ابحث عن محترف", "Find a Professional")}
                    <ArrowRight className="mr-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="text-lg px-8 bg-transparent" asChild>
                  <Link href="/post-request">{t("اعرض خدماتك", "Offer Your Services")}</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Core Values */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary mb-4">
                {t("القيم الأساسية", "Core Values")}
              </h2>
              <p className="text-muted-foreground text-lg">{t("ما يميزنا عن غيرنا", "What sets us apart")}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
              {values.map((value, index) => {
                const Icon = value.icon
                return (
                  <Card key={index} className="p-6 hover:shadow-lg transition-shadow">
                    <div className="flex flex-col items-center text-center space-y-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="font-semibold text-lg">{t(value.titleAr, value.titleEn)}</h3>
                      <p className="text-sm text-muted-foreground">{t(value.descAr, value.descEn)}</p>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        </section>

        {/* Featured Services */}
        <section className="py-16 md:py-24 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary mb-4">
                {t("خدمات متميزة", "Featured Services")}
              </h2>
              <p className="text-muted-foreground text-lg">
                {t(
                  "اكتشف مجموعة من الخدمات المهنية عالية الجودة",
                  "Discover a range of high-quality professional services",
                )}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service, index) => {
                const Icon = service.icon
                return (
                  <Card key={index} className="p-6 hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-2">{t(service.titleAr, service.titleEn)}</h3>
                        <p className="text-sm text-primary font-medium">{t(service.priceAr, service.priceEn)}</p>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
            <div className="text-center mt-8">
              <Button variant="outline" size="lg" asChild>
                <Link href="/services">
                  {t("تصفح جميع الخدمات", "Browse All Services")}
                  <ArrowRight className="mr-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary mb-4">
                {t("كيف تعمل أسعى", "How As'aa Works")}
              </h2>
              <p className="text-muted-foreground text-lg">
                {t("خطوات بسيطة لتحقيق أهدافك", "Simple steps to achieve your goals")}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <div className="relative">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold mx-auto">
                    1
                  </div>
                  <h3 className="text-xl font-semibold">{t("حدد احتياجك", "Define Your Need")}</h3>
                  <p className="text-muted-foreground">
                    {t("ابحث عن الخدمة أو أضف طلبك بوضوح", "Search for service or post your clear request")}
                  </p>
                </div>
              </div>
              <div className="relative">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold mx-auto">
                    2
                  </div>
                  <h3 className="text-xl font-semibold">{t("اختر المحترف", "Choose Professional")}</h3>
                  <p className="text-muted-foreground">
                    {t("راجع الملفات واختر المحترف الأنسب", "Review profiles and choose the best fit")}
                  </p>
                </div>
              </div>
              <div className="relative">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold mx-auto">
                    3
                  </div>
                  <h3 className="text-xl font-semibold">{t("احصل على النتيجة", "Get Results")}</h3>
                  <p className="text-muted-foreground">
                    {t("استلم عملك بجودة عالية في الوقت المحدد", "Receive high-quality work on time")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 md:py-24 bg-secondary text-secondary-foreground">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold">{t("هل أنت محترف؟", "Are You a Professional?")}</h2>
              <p className="text-lg opacity-90">
                {t(
                  "انضم إلى منصة أسعى وابدأ بعرض خدماتك لآلاف العملاء المحتملين",
                  "Join As'aa platform and start offering your services to thousands of potential clients",
                )}
              </p>
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-lg px-8">
                <Link href="/register">
                  {t("ابدأ الآن", "Start Now")}
                  <ArrowRight className="mr-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
