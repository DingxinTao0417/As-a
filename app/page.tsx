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
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"

export default function HomePage() {
  const { t } = useLanguage()
  const [userRole, setUserRole] = useState<string | null>(null) // null = not logged in
  const [roleChecked, setRoleChecked] = useState(false)
  const [accountContextUnavailable, setAccountContextUnavailable] = useState(false)

  useEffect(() => {
    async function checkUser() {
      const supabase = createClient()
      const { data: { user },error:authError } = await supabase.auth.getUser()
      if(authError){setAccountContextUnavailable(true);setRoleChecked(true);return}
      if (user) {
        const { data: profile,error:profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle()
        if(profileError||!profile){setAccountContextUnavailable(true);setRoleChecked(true);return}
        setUserRole(profile?.role || null)
      }
      setRoleChecked(true)
    }
    checkUser()
  }, [])

  const values = [
    {
      icon: CheckCircle2,
      titleAr: "الالتزام",
      titleEn: "Commitment",
      descAr: "سجل واضح للطلبات والتسليم وملاحظات التعديل",
      descEn: "Clear records for orders, delivery, and revision feedback",
    },
    {
      icon: ShieldCheck,
      titleAr: "الاحترافية",
      titleEn: "Professionalism",
      descAr: "تظهر شارة التوثيق فقط بعد مراجعة الإدارة",
      descEn: "Verification badges appear only after administrator review",
    },
    {
      icon: Star,
      titleAr: "الثقة",
      titleEn: "Trust",
      descAr: "صلاحيات منفصلة للباحث ومقدم الخدمة والإدارة",
      descEn: "Separate permissions for clients, providers, and administrators",
    },
    {
      icon: TrendingUp,
      titleAr: "تمكين المواهب",
      titleEn: "Empowering Talent",
      descAr: "نساعد المحترفين على النمو وتحقيق دخل إضافي",
      descEn: "Helping professionals grow and earn more",
    },
    {
      icon: Users,
      titleAr: "سهولة الوصول",
      titleEn: "Easy Access",
      descAr: "نربطك بالمحترف المناسب بسرعة وسهولة",
      descEn: "Find the right professional quickly and easily",
    },
  ]

  const services = [
    {
      icon: Code,
      titleAr: "البرمجة والتطوير",
      titleEn: "Development",
      category: "development",
    },
    {
      icon: Palette,
      titleAr: "التصميم",
      titleEn: "Design",
      category: "design",
    },
    {
      icon: Megaphone,
      titleAr: "التسويق الرقمي",
      titleEn: "Digital Marketing",
      category: "marketing",
    },
    {
      icon: Camera,
      titleAr: "التصوير والمونتاج",
      titleEn: "Photo & Video",
      category: "video",
    },
    {
      icon: FileText,
      titleAr: "الكتابة والترجمة",
      titleEn: "Writing & Translation",
      category: "writing",
    },
    {
      icon: Briefcase,
      titleAr: "الاستشارات",
      titleEn: "Consulting",
      category: "consulting",
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
                {t("أسعى… والباقي علينا", "As'a — You Strive, We Handle the Rest")}
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground text-balance">
                {t(
                  "نربطك بالفرص التي تستحقها، ونجعل الإنجاز تجربة بسيطة وواضحة",
                  "We connect you with the opportunities you deserve, making every achievement simple and clear",
                )}
              </p>
              <div className={`flex flex-col sm:flex-row gap-4 justify-center items-center transition-opacity duration-300 ${roleChecked ? "opacity-100" : "opacity-0"}`}>
                {(accountContextUnavailable || userRole !== "provider") && (
                  <Button size="lg" className="bg-primary hover:bg-primary/90 text-lg px-8" asChild>
                    <Link href="/services/seeker">
                      {t("ابحث عن محترف", "Find a Professional")}
                      <ArrowRight className="me-2 h-5 w-5" />
                    </Link>
                  </Button>
                )}
                {!accountContextUnavailable && userRole !== "seeker" && (
                  <Button size="lg" variant="outline" className="text-lg px-8 bg-transparent" asChild>
                    <Link href={userRole === "provider" ? "/dashboard" : "/services/provider"}>
                      {userRole === "provider"
                        ? t("لوحة التحكم", "Go to Dashboard")
                        : t("اعرض خدماتك", "Offer Your Services")}
                    </Link>
                  </Button>
                )}
              </div>
              {roleChecked&&accountContextUnavailable&&<p className="text-sm text-muted-foreground" role="status">{t("اختصارات الحساب غير متاحة مؤقتاً","Account shortcuts are temporarily unavailable")}</p>}
            </div>
          </div>
        </section>

        {/* Core Values */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary mb-4">
                {t("قيمنا", "Our Values")}
              </h2>
              <p className="text-muted-foreground text-lg">{t("ما يميّزنا عن غيرنا", "What sets us apart")}</p>
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
                {t("خدمات مميّزة", "Featured Services")}
              </h2>
              <p className="text-muted-foreground text-lg">
                {t(
                  "اكتشف مجموعة واسعة من الخدمات المهنية",
                  "Explore a wide range of professional services",
                )}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service, index) => {
                const Icon = service.icon
                return (
                  <Link key={index} href={`/services/seeker?category=${service.category}`}>
                    <Card className="p-6 hover:shadow-lg transition-all hover:scale-105 cursor-pointer">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-2">{t(service.titleAr, service.titleEn)}</h3>
                          <p className="text-sm text-primary font-medium">{t("عرض الخدمات المتاحة", "Browse available listings")}</p>
                        </div>
                      </div>
                    </Card>
                  </Link>
                )
              })}
            </div>
            <div className="text-center mt-8">
              <Button variant="outline" size="lg" asChild>
                <Link href="/services/seeker">
                  {t("تصفّح جميع الخدمات", "Browse All Services")}
                  <ArrowRight className="me-2 h-5 w-5" />
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
                {t("كيف تعمل المنصة", "How It Works")}
              </h2>
              <p className="text-muted-foreground text-lg">
                {t("ثلاث خطوات بسيطة لتحقيق أهدافك", "Three simple steps to get things done")}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <div className="relative">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold mx-auto">
                    1
                  </div>
                  <h3 className="text-xl font-semibold">{t("حدّد احتياجك", "Define Your Need")}</h3>
                  <p className="text-muted-foreground">
                    {t("تصفّح الخدمات المتاحة وحدد ما يناسبك", "Browse available services and choose a suitable listing")}
                  </p>
                </div>
              </div>
              <div className="relative">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold mx-auto">
                    2
                  </div>
                  <h3 className="text-xl font-semibold">{t("اختر المحترف", "Pick a Professional")}</h3>
                  <p className="text-muted-foreground">
                    {t("راجع الملفات الشخصية واختر الأنسب لك", "Review profiles and choose the best fit")}
                  </p>
                </div>
              </div>
              <div className="relative">
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold mx-auto">
                    3
                  </div>
                  <h3 className="text-xl font-semibold">{t("استلم النتيجة", "Get Results")}</h3>
                  <p className="text-muted-foreground">
                    {t("راجع التسليم واطلب تعديلاً أو أكّد الاستلام", "Review the delivery, request a revision, or confirm receipt")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section — only for non-seekers */}
        {roleChecked && !accountContextUnavailable && userRole !== "seeker" && (
        <section className="py-16 md:py-24 bg-secondary text-secondary-foreground">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold">
                {userRole === "provider"
                  ? t("أدِر خدماتك", "Manage Your Services")
                  : t("هل أنت محترف؟", "Are You a Professional?")}
              </h2>
              <p className="text-lg opacity-90">
                {userRole === "provider"
                  ? t("تابع طلباتك وأرباحك من لوحة التحكم", "Track your orders and earnings from the dashboard")
                  : t(
                      "أنشئ ملف مقدم خدمة وأضف خدماتك لمراجعتها ونشرها في السوق",
                      "Create a provider profile and submit services for marketplace review",
                    )}
              </p>
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-lg px-8" asChild>
                <Link href={userRole === "provider" ? "/dashboard" : "/register/provider"}>
                  {userRole === "provider"
                    ? t("لوحة التحكم", "Dashboard")
                    : t("سجّل كمحترف", "Register as a Professional")}
                  <ArrowRight className="me-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
        )}
      </main>

      <Footer />
    </div>
  )
}
