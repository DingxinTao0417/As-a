"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/components/language-provider"
import { ArrowRight, ArrowLeft, Shield, Zap, Heart, Globe } from "lucide-react"
import Link from "next/link"

export default function AboutPage() {
  const { t, language } = useLanguage()
  const ArrowIcon = language === "ar" ? ArrowLeft : ArrowRight

  const values = [
    {
      icon: Shield,
      titleAr: "الثقة أولاً",
      titleEn: "Trust First",
      descAr: "تعرض الملفات حالة التوثيق الفعلية، وتبقى تفاصيل الطلب والتسليم محفوظة للطرفين.",
      descEn: "Profiles show their actual verification status, while order and delivery details remain visible to both parties.",
    },
    {
      icon: Zap,
      titleAr: "سرعة الإنجاز",
      titleEn: "Fast Delivery",
      descAr: "تتيح الرسائل المباشرة مناقشة الخدمة وإرسال العروض ومتابعة الطلب في مكان واحد.",
      descEn: "Direct messaging keeps service discussion, quotes, and order follow-up in one place.",
    },
    {
      icon: Heart,
      titleAr: "مساعدة واضحة",
      titleEn: "Clear Help",
      descAr: "يوفر المساعد داخل المنصة إرشادات عامة، ويصرح بوضوح عندما تحتاج المسألة إلى مراجعة يدوية.",
      descEn: "The in-product assistant provides general guidance and clearly identifies matters that require manual review.",
    },
    {
      icon: Globe,
      titleAr: "هوية محلية",
      titleEn: "Local Identity",
      descAr: "بنيت للسوق السعودي بمعرفة السوق السعودي. العملة، اللغة، واحتياجات العمل المحلي في صميم التصميم.",
      descEn: "Built for the Saudi market with Saudi market knowledge. Currency, language, and local business needs are core to the design.",
    },
  ]

  const milestones = [
    { year: "2026", eventAr: "تطوير واختبار مسارات الحسابات والخدمات والطلبات", eventEn: "Development and testing of account, service, and order workflows" },
    { year: t("التالي", "Next"), eventAr: "التحقق في بيئة الاختبار من الدفع والاسترداد والسحب قبل الإطلاق", eventEn: "Validate payments, refunds, and payouts in a sandbox before launch" },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1">

        {/* ─── Page header ─── */}
        <section className="border-b border-border py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">
                {t("من نحن", "About us")}
              </p>
              <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight mb-6">
                {language === "ar"
                  ? <>منصة بُنيت لأن<br />الكفاءة السعودية تستحق أكثر</>
                  : <>A platform built because<br />Saudi talent deserves better</>
                }
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                {t(
                  "أسعى منصة للخدمات المهنية تربط أصحاب المشاريع بالمحترفين المستقلين في المملكة العربية السعودية. بدأنا بسؤال بسيط: لماذا يلجأ السعوديون لمنصات أجنبية لإنجاز مهام محلية؟",
                  "As'aa is a professional services platform connecting project owners with independent professionals in Saudi Arabia. We started with a simple question: why do Saudis use foreign platforms to complete local tasks?"
                )}
              </p>
            </div>
          </div>
        </section>

        {/* ─── Mission ─── */}
        <section className="py-16 md:py-24 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center max-w-5xl mx-auto">
              <div>
                <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">
                  {t("مهمتنا", "Our mission")}
                </p>
                <h2 className="text-3xl font-bold text-foreground mb-6 leading-snug">
                  {t(
                    "تمكين المواهب المحلية وتسهيل الوصول إليها",
                    "Empowering local talent and making it accessible"
                  )}
                </h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  {t(
                    "نصمم سوقاً واضحاً للخدمات المحلية يربط ملفات مقدمي الخدمة بالخدمات والرسائل والطلبات والتسليم.",
                    "We are designing a clear local-services marketplace that connects provider profiles, listings, messages, orders, and delivery."
                  )}
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  {t(
                    "لسنا مجرد سوق للخدمات. نحن نبني منظومة للعمل الحر المحلي تعكس قيم وثقافة المجتمع السعودي.",
                    "We're not just a service marketplace. We're building an ecosystem for local freelance work that reflects the values and culture of Saudi society."
                  )}
                </p>
              </div>

              {/* Current capabilities */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { numAr: "عربي", numEn: "Arabic", labelAr: "واجهة من اليمين لليسار", labelEn: "Right-to-left interface" },
                  { numAr: "English", numEn: "English", labelAr: "واجهة ثنائية اللغة", labelEn: "Bilingual interface" },
                  { numAr: "SAR", numEn: "SAR", labelAr: "عملة الطلبات", labelEn: "Order currency" },
                  { numAr: "JSON", numEn: "JSON", labelAr: "تصدير بيانات الحساب", labelEn: "Account data export" },
                ].map((s, i) => (
                  <div key={i} className="bg-background rounded-2xl border border-border p-6">
                    <div className="text-3xl font-bold text-foreground mb-1">{t(s.numAr, s.numEn)}</div>
                    <div className="text-sm text-muted-foreground">{t(s.labelAr, s.labelEn)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Values ─── */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-5xl mx-auto">
              <div className="mb-12">
                <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">
                  {t("ما يميّزنا", "What sets us apart")}
                </p>
                <h2 className="text-3xl font-bold text-foreground">
                  {t("مبادئ نبني عليها كل قرار", "Principles behind every decision")}
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {values.map((v, i) => {
                  const Icon = v.icon
                  return (
                    <div key={i} className="flex gap-5">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mt-0.5">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground mb-2">{t(v.titleAr, v.titleEn)}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">{t(v.descAr, v.descEn)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Timeline ─── */}
        <section className="py-16 md:py-24 bg-muted/30 border-y border-border">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto">
              <div className="mb-12">
                <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">
                  {t("مسيرتنا", "Our journey")}
                </p>
                <h2 className="text-3xl font-bold text-foreground">
                  {t("من الفكرة إلى الواقع", "From idea to reality")}
                </h2>
              </div>
              <div className="relative">
                {/* vertical line */}
                <div className="absolute top-0 bottom-0 right-[19px] md:right-auto md:left-[19px] w-px bg-border" />
                <div className="space-y-10">
                  {milestones.map((m, i) => (
                    <div key={i} className="flex items-start gap-6 relative">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-primary bg-background flex items-center justify-center z-10">
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      </div>
                      <div className="pt-1.5">
                        <span className="text-xs font-semibold text-muted-foreground tracking-wider">{m.year}</span>
                        <p className="text-base font-medium text-foreground mt-0.5">{t(m.eventAr, m.eventEn)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── CTA ─── */}
        <section className="py-16 md:py-24 bg-secondary text-secondary-foreground">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t("انضم إلى المجتمع", "Join the community")}
              </h2>
              <p className="text-muted-foreground text-lg mb-10">
                {t(
                  "سواء كنت تبحث عن محترف أو تعرض خدماتك، أسعى هي المكان المناسب.",
                  "Whether you're looking for a professional or offering your services, As'aa is the right place."
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button size="lg" className="bg-primary hover:bg-primary/90 rounded-full px-8 h-12 text-base gap-2" asChild>
                  <Link href="/services/seeker">
                    {t("ابحث عن محترف", "Find a professional")}
                    <ArrowIcon className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="rounded-full px-8 h-12 text-base bg-transparent" asChild>
                  <Link href="/auth/signup">
                    {t("سجّل كمحترف", "Register as professional")}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  )
}
