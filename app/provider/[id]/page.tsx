"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useLanguage } from "@/components/language-provider"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Star,
  Briefcase,
  MessageCircle,
  ArrowLeft,
  CheckCircle2,
  DollarSign,
  Tag,
  Shield,
  TrendingUp,
  Clock,
} from "lucide-react"

type Provider = {
  id: string
  user_id: string
  name_ar: string
  name_en: string
  title_ar: string
  title_en: string
  bio_ar: string | null
  bio_en: string | null
  avatar_url: string | null
  rating: number
  reviews_count: number
  completed_projects: number
  starting_price: number | null
  skills: string[]
  categories: string[]
  is_verified: boolean
}

type Service = {
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
}

export default function ProviderProfilePage() {
  const { t, language } = useLanguage()
  const params = useParams()
  const router = useRouter()
  const [provider, setProvider] = useState<Provider | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    async function fetchProvider() {
      const supabase = createClient()
      setIsLoading(true)

      const { data: userData } = await supabase.auth.getUser()
      setUser(userData.user)

      const { data, error } = await supabase
        .from("providers")
        .select("*")
        .eq("id", params.id)
        .single()

      if (error || !data) {
        console.error("[v0] Error fetching provider:", error)
        router.push("/services/seeker")
        return
      }

      setProvider(data)

      // Fetch provider's services
      const { data: servicesData } = await supabase
        .from("services")
        .select("*")
        .eq("provider_id", data.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })

      setServices(servicesData || [])
      setIsLoading(false)
    }

    fetchProvider()
  }, [params.id, router])

  const handleContact = () => {
    if (!user) {
      router.push("/auth/login")
      return
    }
    router.push(`/messages?provider=${provider?.id}`)
  }

  if (isLoading || !provider) {
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

  const name = language === "ar" ? provider.name_ar : provider.name_en
  const title = language === "ar" ? provider.title_ar : provider.title_en
  const bio = language === "ar" ? provider.bio_ar : provider.bio_en

  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?"

  const stats = [
    { icon: Star, value: provider.rating.toFixed(1), label: t("التقييم", "Rating"), color: "text-yellow-500", bgColor: "bg-yellow-500/10" },
    { icon: Briefcase, value: provider.completed_projects.toString(), label: t("مشروع منجز", "Projects"), color: "text-blue-500", bgColor: "bg-blue-500/10" },
    { icon: TrendingUp, value: provider.reviews_count.toString(), label: t("مراجعة", "Reviews"), color: "text-green-500", bgColor: "bg-green-500/10" },
    { icon: DollarSign, value: `${services.length}`, label: t("خدمة متاحة", "Services"), color: "text-primary", bgColor: "bg-primary/10" },
  ]

  const getPriceTypeLabel = (type: string) => {
    switch (type) {
      case "fixed": return t("سعر ثابت", "Fixed")
      case "hourly": return t("بالساعة", "/hr")
      case "starting_from": return t("يبدأ من", "From")
      default: return ""
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1">
        {/* Profile Hero */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-secondary/95 via-secondary/80 to-primary/60" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(255,255,255,0.08)_0%,_transparent_50%)]" />
          <div className="relative container mx-auto px-4 py-10 md:py-16">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="text-white/80 hover:text-white hover:bg-white/10 mb-8 gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("رجوع", "Back")}
            </Button>

            <div className="flex flex-col items-center text-center space-y-5">
              <div className="relative">
                <div className="absolute -inset-2 rounded-full bg-white/10 blur-md" />
                <Avatar className="relative h-36 w-36 md:h-44 md:w-44 border-4 border-white/20 shadow-2xl">
                  <AvatarImage src={provider.avatar_url || "/placeholder.svg"} className="object-cover" />
                  <AvatarFallback className="text-5xl bg-white/15 text-white font-bold backdrop-blur-sm">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                {provider.is_verified && (
                  <div className="absolute bottom-1 right-1 bg-white rounded-full p-1.5 shadow-xl">
                    <CheckCircle2 className="h-7 w-7 text-primary" />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h1 className="text-3xl md:text-4xl font-bold text-white">{name}</h1>
                <p className="text-white/70 text-lg">{title}</p>
                <div className="flex items-center justify-center gap-3 pt-1">
                  {provider.is_verified && (
                    <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30 gap-1">
                      <Shield className="h-3 w-3" />
                      {t("موثق", "Verified")}
                    </Badge>
                  )}
                  <div className="flex items-center gap-1 bg-white/15 rounded-full px-3 py-1">
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    <span className="text-white font-semibold text-sm">{provider.rating.toFixed(1)}</span>
                  </div>
                </div>
              </div>

              <Button
                size="lg"
                onClick={handleContact}
                className="bg-white text-primary hover:bg-white/90 gap-2 shadow-lg mt-2"
              >
                <MessageCircle className="h-5 w-5" />
                {t("تواصل الآن", "Contact Now")}
              </Button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="container mx-auto px-4 max-w-4xl -mt-8 relative z-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map((stat, idx) => {
              const Icon = stat.icon
              return (
                <Card key={idx} className="p-4 text-center shadow-lg">
                  <div className={`h-10 w-10 rounded-xl ${stat.bgColor} flex items-center justify-center mx-auto mb-2`}>
                    <Icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </Card>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 max-w-4xl py-10 space-y-6">
          {/* About */}
          {bio && (
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">{t("نبذة عني", "About Me")}</h2>
              <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{bio}</p>
            </Card>
          )}

          {/* Skills */}
          {provider.skills && provider.skills.length > 0 && (
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                {t("المهارات", "Skills")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {provider.skills.map((skill, idx) => (
                  <Badge key={idx} variant="secondary" className="px-3 py-1.5 text-sm">
                    {skill}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          {/* Provider's Services */}
          {services.length > 0 && (
            <div>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                {t("الخدمات المتاحة", "Available Services")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {services.map((svc) => {
                  const svcName = language === "ar" ? svc.name_ar : svc.name_en
                  const svcDesc = language === "ar" ? svc.description_ar : svc.description_en
                  return (
                    <Card
                      key={svc.id}
                      className="p-5 hover:shadow-lg transition-all duration-200 cursor-pointer group"
                      onClick={() => router.push(`/services/${svc.id}`)}
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <h3 className="font-bold group-hover:text-primary transition-colors">{svcName}</h3>
                          <Badge variant="secondary" className="text-xs ms-2 flex-shrink-0">{svc.category}</Badge>
                        </div>
                        {svcDesc && <p className="text-sm text-muted-foreground line-clamp-2">{svcDesc}</p>}
                        <div className="flex items-center justify-between pt-2 border-t">
                          <div className="flex items-center gap-1">
                            <DollarSign className="h-4 w-4 text-primary" />
                            <span className="font-bold text-primary">{svc.price} {t("ر.س", "SAR")}</span>
                            <span className="text-xs text-muted-foreground ml-1">{getPriceTypeLabel(svc.price_type)}</span>
                          </div>
                          {svc.delivery_time && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>{svc.delivery_time}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}

          {/* Bottom CTA */}
          <Card className="p-8 bg-gradient-to-r from-primary/5 to-secondary/5 border-0 text-center">
            <h3 className="text-xl font-bold mb-2">
              {t("مهتم بخدمات", "Interested in services from")} {name}?
            </h3>
            <p className="text-muted-foreground mb-6">
              {t("ابدأ محادثة وناقش تفاصيل مشروعك للحصول على عرض سعر", "Start a conversation and discuss your project details to get a quote")}
            </p>
            <div className="flex gap-3 justify-center">
              <Button size="lg" onClick={handleContact} className="gap-2">
                <MessageCircle className="h-5 w-5" />
                {t("ابدأ المحادثة", "Start Conversation")}
              </Button>
              <Button size="lg" variant="outline" onClick={() => router.push("/services/seeker")} className="gap-2">
                {t("تصفح محترفين آخرين", "Browse Other Professionals")}
              </Button>
            </div>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  )
}
