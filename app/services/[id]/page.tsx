"use client"

import { useEffect, useState, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { createDirectOrder, createPaymentCharge } from "@/app/actions/orders"
import Image from "next/image"
import { useLanguage } from "@/components/language-provider"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Star,
  MessageCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Send,
  Pencil,
  FileCheck,
  ThumbsUp,
  Zap,
  Clock,
  Shield,
  User,
  DollarSign,
} from "lucide-react"

// --- Types ---
type ServiceWithProvider = {
  id: string
  name_ar: string
  name_en: string
  description_ar: string | null
  description_en: string | null
  category: string
  price: number
  price_type: string
  delivery_time: string | null
  features: string[]
  image_urls: string[]
  is_active: boolean
  provider_id: string
  created_at: string
  providers: {
    id: string
    name_ar: string
    name_en: string
    title_ar: string
    title_en: string
    avatar_url: string | null
    rating: number
    reviews_count: number
    completed_projects: number
    is_verified: boolean
    bio_ar: string | null
    bio_en: string | null
    response_time: string | null
  }
}

type RelatedService = {
  id: string
  name_ar: string
  name_en: string
  category: string
  price: number
  price_type: string
  provider_id: string
  providers: {
    name_ar: string
    name_en: string
    avatar_url: string | null
    rating: number
  }
}

type Review = {
  id: string
  rating: number
  comment: string | null
  created_at: string
  service_name: string | null
  reviewer_id: string
  profiles: {
    full_name: string | null
    avatar_url: string | null
  }
}

// --- Placeholder Portfolio Images ---
const PLACEHOLDER_IMAGES = [
  "https://placehold.co/800x500/1a1a2e/e0e0e0?text=Service+Image",
]



// --- FAQ Accordion Item ---
function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 px-1 text-start font-medium hover:text-primary transition-colors cursor-pointer"
      >
        <span>{question}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-200 ${open ? "max-h-40 pb-4" : "max-h-0"}`}>
        <p className="text-sm text-muted-foreground px-1 leading-relaxed">{answer}</p>
      </div>
    </div>
  )
}

// --- Star Rating ---
function StarRating({ rating, size = "h-4 w-4" }: { rating: number; size?: string }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`${size} ${i <= rating ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted"}`} />
      ))}
    </div>
  )
}


// ==============================
// MAIN COMPONENT
// ==============================
export default function ServiceDetailPage() {
  const { t, language } = useLanguage()
  const params = useParams()
  const router = useRouter()
  const [service, setService] = useState<ServiceWithProvider | null>(null)
  const [relatedServices, setRelatedServices] = useState<RelatedService[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [activeImage, setActiveImage] = useState(0)
  const thumbsRef = useRef<HTMLDivElement>(null)

  // Scroll thumbnail strip to keep active thumb visible
  useEffect(() => {
    if (!thumbsRef.current) return
    const thumb = thumbsRef.current.children[activeImage] as HTMLElement
    if (thumb) thumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }, [activeImage])

  // Order state
  const [isOrdering, setIsOrdering] = useState(false)

  useEffect(() => {
    async function fetchService() {
      const supabase = createClient()
      setIsLoading(true)

      const { data: userData } = await supabase.auth.getUser()
      setUser(userData.user)

      const { data, error } = await supabase
        .from("services")
        .select(`
          *,
          providers (
            id, name_ar, name_en, title_ar, title_en, avatar_url,
            rating, reviews_count, completed_projects, is_verified,
            bio_ar, bio_en, response_time
          )
        `)
        .eq("id", params.id)
        .single()

      if (error || !data) {
        router.push("/services/seeker")
        return
      }

      setService(data as ServiceWithProvider)

      // Fetch related services (same category, exclude current)
      const { data: related } = await supabase
        .from("services")
        .select(`
          id, name_ar, name_en, category, price, price_type, provider_id,
          providers ( name_ar, name_en, avatar_url, rating )
        `)
        .eq("category", data.category)
        .eq("is_active", true)
        .neq("id", data.id)
        .limit(4)

      setRelatedServices((related as RelatedService[]) || [])

      // Fetch reviews for this service
      const { data: reviewsData } = await supabase
        .from("reviews")
        .select(`
          id, rating, comment, created_at, service_name, reviewer_id,
          profiles ( full_name, avatar_url )
        `)
        .eq("service_id", data.id)
        .order("created_at", { ascending: false })
        .limit(10)

      setReviews((reviewsData as Review[]) || [])

      setIsLoading(false)
    }

    fetchService()
  }, [params.id, router])

  const handleContact = () => {
    if (!user) { router.push("/auth/login"); return }
    router.push(`/messages?provider=${service?.provider_id}`)
  }

  const handleOrderNow = async () => {
    if (!user) { router.push("/auth/login"); return }
    if (!service) return

    setIsOrdering(true)
    try {
      // 1. Create a direct order and related conversation context
      const orderResult = await createDirectOrder(service.id)
      
      if (!orderResult.success) {
        alert(orderResult.error)
        setIsOrdering(false)
        return
      }

      const { orderId } = orderResult.data

      // 2. Create Tap payment charge
      const paymentResult = await createPaymentCharge(orderId)

      if (!paymentResult.success || !paymentResult.data.url) {
        alert(paymentResult.success ? "Failed to initialize payment" : paymentResult.error)
        setIsOrdering(false)
        return
      }

      // 3. Redirect to Tap payment
      window.location.href = paymentResult.data.url
    } catch (error) {
      console.error("Error creating direct order:", error)
      alert("An unexpected error occurred")
      setIsOrdering(false)
    }
  }

  if (isLoading || !service) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
        <Footer />
      </div>
    )
  }

  const name = language === "ar" ? service.name_ar : service.name_en
  const desc = language === "ar" ? service.description_ar : service.description_en
  const providerName = language === "ar" ? service.providers?.name_ar : service.providers?.name_en
  const providerTitle = language === "ar" ? service.providers?.title_ar : service.providers?.title_en
  const providerRating = service.providers?.rating || 5.0
  const providerReviews = service.providers?.reviews_count || 0

  // Use real images if available, else fall back to placeholder
  const galleryImages = service.image_urls && service.image_urls.length > 0
    ? service.image_urls
    : PLACEHOLDER_IMAGES

  const getPriceTypeLabel = (type: string) => {
    switch (type) {
      case "fixed": return t("سعر ثابت", "Fixed Price")
      case "hourly": return t("بالساعة", "Per Hour")
      case "starting_from": return t("يبدأ من", "Starting From")
      default: return ""
    }
  }

  const faqItems = [
    {
      q: t("ماذا يحدث إذا لم أكن راضياً عن النتيجة؟", "What happens if I'm not satisfied with the result?"),
      a: t("يمكنك طلب مراجعات مجانية ضمن الباقة. إذا لم تكن راضياً بعد المراجعات، يمكنك التواصل مع الدعم.", "You can request free revisions within the package. If still unsatisfied after revisions, you can contact support."),
    },
    {
      q: t("ما المعلومات التي أحتاج لتقديمها؟", "What information do I need to provide?"),
      a: t("اسم العلامة التجارية، الشعار إن وجد، الألوان المفضلة، و2-3 أمثلة لأعمال تعجبك.", "Brand name, slogan if any, preferred colors, and 2-3 examples of designs you like."),
    },
    {
      q: t("كم يستغرق الحصول على أول تصميم؟", "How long to get the first draft?"),
      a: t("عادة خلال 24-48 ساعة من تقديم المتطلبات.", "Usually within 24-48 hours of submitting requirements."),
    },
    {
      q: t("هل يمكنك التصميم بأنماط محددة؟", "Can you design in specific styles?"),
      a: t("نعم، أعمل بجميع الأنماط: مينيمالست، كلاسيكي، عصري، وغيرها. شارك أمثلة وسأتكيف معها.", "Yes, I work in all styles: minimalist, classic, modern, and more. Share examples and I'll adapt."),
    },
  ]

  const workflowSteps = [
    { icon: Send, title: t("تقديم المتطلبات", "Submit Requirements"), desc: t("ملء استبيان قصير عن مشروعك", "Fill a brief questionnaire about your project") },
    { icon: Pencil, title: t("استلام المسودة", "Receive Draft"), desc: t("استلام المقترحات الأولية خلال الوقت المحدد", "Receive initial concepts within the agreed time") },
    { icon: FileCheck, title: t("المراجعة والتعديل", "Review & Revise"), desc: t("إرسال ملاحظاتك للحصول على النسخة المثالية", "Provide feedback to get the perfect version") },
    { icon: ThumbsUp, title: t("الاستلام النهائي", "Final Delivery"), desc: t("استلام الملفات النهائية وتقييم الخدمة", "Get final files and rate the service") },
  ]

  const tags = [
    "Minimalist", "Modern", "Logo Design", "Figma", "Illustrator",
    "Brand Identity", "Arabic", "Custom", "SVG",
  ]

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1">
        {/* Breadcrumb + Back */}
        <div className="container mx-auto px-4 max-w-6xl pt-6">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-4 w-4" />
            {t("رجوع", "Back to Services")}
          </Button>
        </div>

        {/* Two Column Layout */}
        <div className="container mx-auto px-4 max-w-6xl pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* ========== LEFT COLUMN (2/3) ========== */}
            <div className="lg:col-span-2 space-y-8">

              {/* H1 Title */}
              <h1 className="text-2xl md:text-3xl font-bold leading-tight">{name}</h1>

              {/* Portfolio Gallery */}
              <div className="space-y-3">
                {/* Primary Image - sliding carousel */}
                <div className="relative rounded-xl overflow-hidden bg-muted aspect-[16/10] group">
                  <div
                    className="flex h-full transition-transform duration-500 ease-in-out"
                    style={{ transform: `translateX(-${activeImage * 100}%)` }}
                  >
                    {galleryImages.map((img, idx) => (
                      <div key={idx} className="w-full h-full flex-shrink-0">
                        <Image
                          src={img}
                          alt={`${name} - ${idx + 1}`}
                          width={800}
                          height={500}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Nav Arrows - only show if more than 1 image */}
                  {galleryImages.length > 1 && (
                    <>
                      <button
                        onClick={() => setActiveImage((prev) => (prev === 0 ? galleryImages.length - 1 : prev - 1))}
                        className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg cursor-pointer hover:bg-background"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setActiveImage((prev) => (prev === galleryImages.length - 1 ? 0 : prev + 1))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg cursor-pointer hover:bg-background"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>

                      {/* Dot indicators */}
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {galleryImages.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={() => setActiveImage(idx)}
                            className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                              activeImage === idx ? "w-4 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Thumbnails - only show if more than 1 image */}
                {galleryImages.length > 1 && (
                  <div ref={thumbsRef} className="flex gap-2 overflow-x-auto px-1 py-1">
                    {galleryImages.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveImage(idx)}
                        className={`relative rounded-lg overflow-hidden h-16 w-24 flex-shrink-0 cursor-pointer transition-all duration-200 ${
                          activeImage === idx ? "ring-2 ring-primary ring-offset-2" : "opacity-60 hover:opacity-100"
                        }`}
                      >
                        <Image src={img} alt={`Thumb ${idx + 1}`} width={96} height={64} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Service Description */}
              <Card className="p-6 shadow-sm">
                <h2 className="text-xl font-bold mb-4">{t("وصف الخدمة", "Service Description")}</h2>
                <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                  {desc || t(
                    "سأقوم بتصميم شعار احترافي ومميز يعكس هوية علامتك التجارية بشكل مثالي. تشمل الخدمة بحثاً شاملاً وتصوراً إبداعياً وملفات نهائية بدقة عالية.",
                    "I will craft a unique, professional, and minimalist logo that perfectly encapsulates your brand essence. This service includes thorough research, conceptualization, and multiple high-resolution vector final assets."
                  )}
                </p>
              </Card>

              {/* What's Included */}
              {service.features && service.features.length > 0 && (
                <Card className="p-6 shadow-sm">
                  <h2 className="text-xl font-bold mb-4">{t("ما يتضمنه", "What's Included")}</h2>
                  <ul className="space-y-3">
                    {service.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* Workflow / Milestones */}
              <Card className="p-6 shadow-sm">
                <h2 className="text-xl font-bold mb-6">{t("كيف يتم العمل", "How It Works")}</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {workflowSteps.map((step, idx) => {
                    const Icon = step.icon
                    return (
                      <div key={idx} className="text-center space-y-2">
                        <div className="relative mx-auto">
                          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                            <Icon className="h-6 w-6 text-primary" />
                          </div>
                          <span className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                        </div>
                        <h4 className="font-semibold text-sm">{step.title}</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                      </div>
                    )
                  })}
                </div>
              </Card>

              {/* FAQ */}
              <Card className="p-6 shadow-sm">
                <h2 className="text-xl font-bold mb-2">{t("الأسئلة الشائعة", "Frequently Asked Questions")}</h2>
                <div className="divide-y-0">
                  {faqItems.map((item, idx) => (
                    <FAQItem key={idx} question={item.q} answer={item.a} />
                  ))}
                </div>
              </Card>

              {/* Ordering Requirements */}
              <Card className="p-6 shadow-sm border-primary/20">
                <h2 className="text-xl font-bold mb-4">{t("متطلبات الطلب", "Ordering Requirements")}</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("بعد الشراء، سيُطلب منك تقديم المعلومات التالية:", "After purchase, you'll be asked to provide the following:")}
                </p>
                <ul className="space-y-2">
                  {[
                    t("اسم العلامة التجارية والشعار (إن وجد)", "Brand name and slogan (if any)"),
                    t("الألوان المفضلة أو الهوية البصرية الحالية", "Preferred colors or existing brand guidelines"),
                    t("2-3 أمثلة لتصاميم تعجبك", "2-3 examples of designs you like"),
                    t("وصف مختصر لطبيعة العمل والجمهور المستهدف", "Brief description of your business and target audience"),
                  ].map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="h-5 w-5 rounded-full bg-secondary/10 text-secondary flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">
                        {idx + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            {/* ========== RIGHT SIDEBAR (1/3) ========== */}
            <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">

              {/* Provider Card */}
              <Card className="p-6 shadow-sm">
                <div className="flex flex-col items-center text-center space-y-3">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 blur-sm" />
                    <Avatar className="relative h-20 w-20 border-2 border-muted">
                      <AvatarImage src={service.providers?.avatar_url || "/placeholder.svg"} />
                      <AvatarFallback className="text-xl font-bold bg-primary/10">
                        {(providerName || "?").charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    {service.providers?.is_verified && (
                      <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{providerName}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{providerTitle}</p>
                  </div>
                  <StarRating rating={Math.round(providerRating)} />
                  <span className="text-sm text-muted-foreground">{providerRating.toFixed(1)} ({providerReviews} {t("مراجعة", "reviews")})</span>

                  {/* Seller Stats */}
                  <div className="w-full space-y-2 pt-3 border-t text-sm">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Zap className="h-3.5 w-3.5" />{t("وقت الرد", "Response Time")}</span>
                      <span className="font-medium">{service.providers?.response_time || t("خلال ساعة", "Within 1 hr")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><FileCheck className="h-3.5 w-3.5" />{t("طلبات منجزة", "Orders Done")}</span>
                      <span className="font-medium">{service.providers?.completed_projects || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3.5 w-3.5" />{t("آخر تسليم", "Last Delivery")}</span>
                      <span className="font-medium">{t("يوم واحد", "1 day ago")}</span>
                    </div>
                  </div>

                  {/* Verification Badges */}
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    <Badge variant="secondary" className="gap-1 text-xs"><Shield className="h-3 w-3" />{t("هوية موثقة", "ID Verified")}</Badge>
                    <Badge variant="secondary" className="gap-1 text-xs"><Star className="h-3 w-3" />{t("بائع محترف", "Pro Seller")}</Badge>
                  </div>

                  <div className="w-full space-y-2 pt-2">
                    <Button className="w-full gap-2" onClick={handleContact}>
                      <MessageCircle className="h-4 w-4" />
                      {t("تواصل", "Contact")}
                    </Button>
                    <Button variant="outline" className="w-full gap-2" onClick={() => router.push(`/provider/${service.provider_id}`)}>
                      <User className="h-4 w-4" />
                      {t("عرض الملف الكامل", "View Full Profile")}
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Pricing Card + CTA */}
              <Card className="p-6 shadow-sm">
                <div className="space-y-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-primary">{service.price}</span>
                    <span className="text-lg text-muted-foreground">{t("ر.س", "SAR")}</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("نوع التسعير", "Pricing Type")}</span>
                      <span>{getPriceTypeLabel(service.price_type)}</span>
                    </div>
                    {service.delivery_time && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{t("وقت التسليم", "Delivery Time")}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{service.delivery_time}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("التصنيف", "Category")}</span>
                      <Badge variant="secondary">{service.category}</Badge>
                    </div>
                  </div>
                  {/* Main CTA */}
                  <Button
                    size="lg"
                    className="w-full gap-2 text-base font-semibold mt-2"
                    onClick={handleOrderNow}
                    disabled={isOrdering}
                  >
                    {isOrdering ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    ) : (
                      <>
                        {t("اطلب الآن", "Order Now")} ({service.price} {t("ر.س", "SAR")})
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">{t("لن يتم الخصم إلا بعد موافقتك", "You won't be charged until you approve")}</p>
                </div>
              </Card>

              {/* Tags Cloud */}
              <Card className="p-5 shadow-sm">
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">{t("كلمات مفتاحية", "Tags")}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs cursor-pointer hover:bg-muted transition-colors">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* ========== FULL WIDTH SECTIONS ========== */}

          {/* Reviews Section */}
          {(() => {
            const displayReviews = reviews
            const totalReviews = displayReviews.length
            const avgRating = totalReviews > 0 ? displayReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews : 0
            const ratingCounts = [5, 4, 3, 2, 1].map((star) => ({
              star,
              count: displayReviews.filter((r) => r.rating === star).length,
              pct: totalReviews > 0 ? Math.round((displayReviews.filter((r) => r.rating === star).length / totalReviews) * 100) : 0,
            }))

            const formatDate = (dateStr: string) => {
              const diff = Date.now() - new Date(dateStr).getTime()
              const days = Math.floor(diff / 86400000)
              if (days < 1) return t("اليوم", "Today")
              if (days < 7) return t(`قبل ${days} أيام`, `${days} days ago`)
              if (days < 30) return t(`قبل ${Math.floor(days / 7)} أسابيع`, `${Math.floor(days / 7)} weeks ago`)
              return t(`قبل ${Math.floor(days / 30)} أشهر`, `${Math.floor(days / 30)} months ago`)
            }

            return (
              <div className="mt-12 pt-10 border-t">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-bold">{t("آراء العملاء", "What Clients Are Saying")}</h2>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Rating Summary */}
                  <Card className="p-6 shadow-sm">
                    <div className="text-center mb-6">
                      <span className="text-5xl font-bold">{avgRating.toFixed(1)}</span>
                      <div className="flex justify-center mt-2">
                        <StarRating rating={Math.round(avgRating)} size="h-5 w-5" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{totalReviews} {t("تقييم", "ratings")}</p>
                    </div>
                    {/* Rating Distribution */}
                    <div className="space-y-2">
                      {ratingCounts.map(({ star, pct }) => (
                        <div key={star} className="flex items-center gap-2 text-sm">
                          <span className="w-3 text-center">{star}</span>
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-8 text-end text-xs text-muted-foreground">{pct}%</span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Review List */}
                  <div className="lg:col-span-2 space-y-4">
                    {displayReviews.map((review) => {
                      const reviewerName = review.profiles?.full_name || t("مستخدم", "User")
                      const reviewerAvatar = review.profiles?.avatar_url
                      return (
                        <Card key={review.id} className="p-5 shadow-sm">
                          <div className="flex items-start gap-4">
                            <Avatar className="h-10 w-10 flex-shrink-0">
                              <AvatarImage src={reviewerAvatar || "/placeholder.svg"} />
                              <AvatarFallback>{reviewerName.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <div>
                                  <span className="font-semibold text-sm">{reviewerName}</span>
                                  {review.service_name && (
                                    <span className="text-xs text-muted-foreground ml-2">• {review.service_name}</span>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground">{formatDate(review.created_at)}</span>
                              </div>
                              <StarRating rating={review.rating} size="h-3.5 w-3.5" />
                              {review.comment && (
                                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{review.comment}</p>
                              )}
                            </div>
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Related Services */}
          {relatedServices.length > 0 && (
            <div className="mt-12 pt-10 border-t">
              <h2 className="text-2xl font-bold mb-6">{t("خدمات مشابهة قد تعجبك", "Similar Services You May Like")}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {relatedServices.map((svc) => {
                  const svcName = language === "ar" ? svc.name_ar : svc.name_en
                  const svcProvider = language === "ar" ? svc.providers?.name_ar : svc.providers?.name_en
                  return (
                    <Card
                      key={svc.id}
                      className="p-4 hover:shadow-lg transition-all cursor-pointer group"
                      onClick={() => router.push(`/services/${svc.id}`)}
                    >
                      <h4 className="font-semibold text-sm mb-2 group-hover:text-primary transition-colors line-clamp-2">{svcName}</h4>
                      <div className="flex items-center gap-2 mb-3">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={svc.providers?.avatar_url || "/placeholder.svg"} />
                          <AvatarFallback className="text-xs">{(svcProvider || "?").charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground">{svcProvider}</span>
                        <div className="flex items-center gap-0.5 ml-auto">
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          <span className="text-xs">{svc.providers?.rating?.toFixed(1)}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-primary">{svc.price} {t("ر.س", "SAR")}</span>
                        <Badge variant="outline" className="text-xs">{svc.category}</Badge>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
