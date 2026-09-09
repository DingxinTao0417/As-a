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
  Heart,
  AlertCircle,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { getProviderFavoriteStatus, setProviderFavorite } from "@/app/actions/favorites"
import {
  getPublicProviderDetail,
  getPublicProviderServices,
  type PublicProviderDetail,
  type PublicProviderService,
  type PublicProviderServiceCursor,
} from "@/app/actions/catalog"

export default function ProviderProfilePage() {
  const { t, language } = useLanguage()
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const [provider, setProvider] = useState<PublicProviderDetail | null>(null)
  const [services, setServices] = useState<PublicProviderService[]>([])
  const [serviceCursor,setServiceCursor]=useState<PublicProviderServiceCursor|null>(null)
  const [serviceTotal,setServiceTotal]=useState(0)
  const [loadingMoreServices,setLoadingMoreServices]=useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [providerUnavailable, setProviderUnavailable] = useState(false)
  const [providerLoadError, setProviderLoadError] = useState<string | null>(null)
  const [servicesUnavailable, setServicesUnavailable] = useState(false)
  const [favoriteUnavailable, setFavoriteUnavailable] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [user, setUser] = useState<any>(null)
  const [authUnavailable, setAuthUnavailable] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [savingFavorite, setSavingFavorite] = useState(false)

  useEffect(() => {
    async function fetchProvider() {
      const supabase = createClient()
      setIsLoading(true)
      setProviderUnavailable(false)
      setProviderLoadError(null)
      setServicesUnavailable(false)
      setFavoriteUnavailable(false)

      const [{ data: userData,error:authError },providerResult] = await Promise.all([
        supabase.auth.getUser(),
        getPublicProviderDetail(String(params.id)),
      ])
      setUser(userData.user)
      setAuthUnavailable(Boolean(authError))

      if (!providerResult.success) {
        setProviderLoadError(t("تعذر تحميل مقدم الخدمة. يرجى المحاولة مرة أخرى","Could not load the provider. Please try again"))
        setIsLoading(false)
        return
      }
      const data=providerResult.data.provider
      if (!data) {
        setProviderUnavailable(true)
        setIsLoading(false)
        return
      }

      setProvider(data)

      if (userData.user) {
        const favoriteResult=await getProviderFavoriteStatus(data.id)
        if(!favoriteResult.success){
          setFavoriteUnavailable(true)
          toast({ title:t("تعذر تحميل حالة المفضلة","Could not load favorite status"),description:t("يرجى المحاولة مرة أخرى","Please try again"),variant:"destructive" })
        }else setIsFavorite(favoriteResult.data.favorite)
      }

      const servicesResult=await getPublicProviderServices(data.id)
      if (!servicesResult.success) {
        setServicesUnavailable(true)
        toast({ title: t("تعذر تحميل الخدمات", "Could not load services"), description:servicesResult.error, variant: "destructive" })
      } else {
        setServices(servicesResult.data.services)
        setServiceCursor(servicesResult.data.nextCursor)
        setServiceTotal(servicesResult.data.total)
        setServicesUnavailable(false)
      }
      setIsLoading(false)
    }

    fetchProvider()
  }, [params.id, router,loadAttempt])

  const loadMoreServices=async()=>{
    if(!provider||!serviceCursor||loadingMoreServices)return
    setLoadingMoreServices(true)
    const result=await getPublicProviderServices(provider.id,serviceCursor)
    if(result.success){
      setServices((current)=>[...current,...result.data.services.filter((service)=>!current.some((item)=>item.id===service.id))])
      setServiceCursor(result.data.nextCursor);setServiceTotal(result.data.total);setServicesUnavailable(false)
    }else{
      setServicesUnavailable(true)
      toast({title:t("تعذر تحميل خدمات أقدم","Could not load older services"),description:result.error,variant:"destructive"})
    }
    setLoadingMoreServices(false)
  }

  const handleContact = () => {
    if(authUnavailable){toast({title:t("تعذر التحقق من الجلسة","Could not verify your session"),description:t("يرجى المحاولة مرة أخرى","Please try again"),variant:"destructive"});return}
    if (!user) {
      router.push(`/auth/login?next=${encodeURIComponent(`/messages?provider=${provider?.id}`)}`)
      return
    }
    router.push(`/messages?provider=${provider?.id}`)
  }

  const handleFavorite = async () => {
    if (!provider) return
    if(authUnavailable){toast({title:t("تعذر التحقق من الجلسة","Could not verify your session"),description:t("يرجى المحاولة مرة أخرى","Please try again"),variant:"destructive"});return}
    if (!user) {
      router.push(`/auth/login?next=${encodeURIComponent(`/provider/${provider.id}`)}`)
      return
    }
    setSavingFavorite(true)
    try {
      const result = await setProviderFavorite(provider.id, !isFavorite)
      if (!result.success) {
        toast({ title: t("فشل الحفظ", "Save failed"), description: result.error, variant: "destructive" })
        return
      }
      setIsFavorite(result.data.favorite)
      toast({ title: result.data.favorite ? t("تمت الإضافة للمفضلة", "Added to favorites") : t("تمت الإزالة من المفضلة", "Removed from favorites") })
    } catch {
      toast({ title: t("فشل الحفظ", "Save failed"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
    } finally {
      setSavingFavorite(false)
    }
  }

  if (isLoading) {
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

  if (providerUnavailable || providerLoadError || !provider) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center" role="alert">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
            <h1 className="text-xl font-semibold">
              {providerUnavailable ? t("مقدم الخدمة غير متاح","Provider unavailable") : t("تعذر تحميل مقدم الخدمة","Could not load provider")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {providerUnavailable
                ? t("قد يكون الحساب متوقفاً أو غير منشور","The account may be paused or unpublished")
                : providerLoadError}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {!providerUnavailable && <Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t("إعادة المحاولة","Retry")}</Button>}
              <Button variant="outline" onClick={() => router.push("/services/seeker")}>{t("تصفح الخدمات","Browse Services")}</Button>
            </div>
          </div>
        </main>
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
    { icon: DollarSign, value: servicesUnavailable&&services.length===0 ? "—" : `${serviceTotal}`, label: t("خدمة متاحة", "Services"), color: "text-primary", bgColor: "bg-primary/10" },
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
                  <div className="absolute bottom-1 end-1 bg-white rounded-full p-1.5 shadow-xl">
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

              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  size="lg"
                  onClick={handleContact}
                  className="bg-white text-primary hover:bg-white/90 gap-2 shadow-lg"
                >
                  <MessageCircle className="h-5 w-5" />
                  {t("تواصل الآن", "Contact Now")}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleFavorite}
                  disabled={savingFavorite || favoriteUnavailable || authUnavailable}
                  aria-pressed={isFavorite}
                  title={favoriteUnavailable ? t("حالة المفضلة غير متاحة","Favorite status unavailable") : undefined}
                  className="gap-2 bg-white/10 text-white border-white/40 hover:bg-white/20 hover:text-white"
                >
                  <Heart className={`h-5 w-5 ${isFavorite ? "fill-current" : ""}`} />
                  {favoriteUnavailable
                    ? t("المفضلة غير متاحة","Favorite Unavailable")
                    : isFavorite ? t("في المفضلة", "Favorited") : t("أضف للمفضلة", "Add Favorite")}
                </Button>
              </div>
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
          {servicesUnavailable&&services.length===0 ? (
            <Card className="p-6 text-center" role="alert">
              <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
              <p className="font-medium">{t("تعذر تحميل الخدمات المتاحة","Could not load available services")}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t("إعادة المحاولة","Retry")}</Button>
            </Card>
          ) : services.length > 0 && (
            <div>
              {servicesUnavailable&&<Card className="mb-4 p-4 text-sm text-destructive" role="alert">{t("تعذر تحديث الخدمات؛ المعروض هو آخر بيانات ناجحة","Service refresh failed; showing the last successful data")}</Card>}
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
                            <span className="text-xs text-muted-foreground ms-1">{getPriceTypeLabel(svc.price_type)}</span>
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
              {serviceCursor&&services.length<serviceTotal&&<div className="mt-5 text-center"><Button variant="outline" onClick={()=>void loadMoreServices()} disabled={loadingMoreServices}>{loadingMoreServices?t("جاري التحميل...","Loading..."):t("تحميل خدمات أقدم","Load Older Services")}</Button></div>}
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
