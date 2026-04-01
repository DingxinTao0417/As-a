"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useLanguage } from "@/components/language-provider"
import { Search, Star, Filter, SlidersHorizontal, MessageCircle, Clock, DollarSign } from "lucide-react"
import { useState, useEffect } from "react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

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
  providers: {
    id: string
    name_ar: string
    name_en: string
    avatar_url: string | null
    rating: number
    reviews_count: number
    is_verified: boolean
  }
}

export default function TaskSeekerPage() {
  const { t, language } = useLanguage()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [sortBy, setSortBy] = useState("newest")
  const [services, setServices] = useState<ServiceWithProvider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  const categories = [
    { id: "all", nameAr: "الكل", nameEn: "All" },
    { id: "development", nameAr: "تطوير", nameEn: "Development" },
    { id: "design", nameAr: "تصميم", nameEn: "Design" },
    { id: "marketing", nameAr: "تسويق", nameEn: "Marketing" },
    { id: "writing", nameAr: "كتابة", nameEn: "Writing" },
    { id: "video", nameAr: "فيديو", nameEn: "Video" },
    { id: "consulting", nameAr: "استشارات", nameEn: "Consulting" },
    { id: "business", nameAr: "أعمال", nameEn: "Business" },
  ]

  useEffect(() => {
    async function fetchServices() {
      const supabase = createClient()
      setIsLoading(true)

      try {
        const { data, error } = await supabase
          .from("services")
          .select(`
            *,
            providers (
              id,
              name_ar,
              name_en,
              avatar_url,
              rating,
              reviews_count,
              is_verified
            )
          `)
          .eq("is_active", true)
          .order("created_at", { ascending: false })

        if (error) {
          console.error("[v0] Error fetching services:", error)
          return
        }

        setServices((data as ServiceWithProvider[]) || [])
      } catch (error) {
        console.error("[v0] Error in fetchServices:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchServices()
  }, [])

  useEffect(() => {
    async function checkUser() {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
    }
    checkUser()
  }, [])

  const filteredServices = services
    .filter((service) => {
      const matchesCategory = selectedCategory === "all" || service.category === selectedCategory

      const name = language === "ar" ? service.name_ar : service.name_en
      const desc = language === "ar" ? service.description_ar : service.description_en

      const matchesSearch =
        searchQuery === "" ||
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (desc && desc.toLowerCase().includes(searchQuery.toLowerCase()))

      return matchesCategory && matchesSearch
    })
    .sort((a, b) => {
      if (sortBy === "price-low") return a.price - b.price
      if (sortBy === "price-high") return b.price - a.price
      if (sortBy === "rating") return (b.providers?.rating || 0) - (a.providers?.rating || 0)
      return 0 // newest is default order from DB
    })

  const handleContactProvider = async (providerId: string) => {
    if (!user) {
      router.push("/auth/login")
      return
    }
    router.push(`/messages?provider=${providerId}`)
  }

  const getPriceTypeLabel = (type: string) => {
    switch (type) {
      case "fixed": return t("سعر ثابت", "Fixed Price")
      case "hourly": return t("بالساعة", "Per Hour")
      case "starting_from": return t("يبدأ من", "Starting From")
      default: return ""
    }
  }

  const getCategoryLabel = (catId: string) => {
    const cat = categories.find(c => c.id === catId)
    return cat ? (language === "ar" ? cat.nameAr : cat.nameEn) : catId
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero Section with Search */}
        <section className="bg-gradient-to-b from-secondary/10 to-background py-12 md:py-20">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto text-center space-y-6">
              <h1 className="text-3xl md:text-5xl font-bold text-secondary text-balance">
                {t("اكتشف خدمات احترافية لمشروعك", "Discover Professional Services for Your Project")}
              </h1>
              <p className="text-lg text-muted-foreground text-balance">
                {t("تصفح الخدمات المتاحة واختر الأنسب لاحتياجاتك", "Browse available services and choose the best fit for your needs")}
              </p>

              {/* Search Bar */}
              <div className="relative max-w-2xl mx-auto">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={t("ابحث عن خدمة...", "Search for a service...")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-14 pr-12 pl-4 text-lg"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Filters and Results Section */}
        <section className="py-8">
          <div className="container mx-auto px-4">
            {/* Category Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
              {categories.map((cat) => (
                <Button
                  key={cat.id}
                  variant={selectedCategory === cat.id ? "default" : "outline"}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={selectedCategory === cat.id ? "bg-primary" : ""}
                >
                  {t(cat.nameAr, cat.nameEn)}
                </Button>
              ))}
            </div>

            {/* Sort and Filter Bar */}
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
              <div className="text-muted-foreground">
                {filteredServices.length} {t("خدمة متاحة", "services available")}
              </div>

              <div className="flex gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2 bg-transparent">
                      <SlidersHorizontal className="h-4 w-4" />
                      {t("ترتيب حسب", "Sort by")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setSortBy("newest")}>
                      {t("الأحدث", "Newest")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSortBy("rating")}>
                      {t("الأعلى تقييماً", "Highest Rated")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSortBy("price-low")}>
                      {t("السعر: من الأقل للأعلى", "Price: Low to High")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSortBy("price-high")}>
                      {t("السعر: من الأعلى للأقل", "Price: High to Low")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-20">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
                <p className="mt-4 text-muted-foreground">{t("جاري التحميل...", "Loading...")}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredServices.map((service) => {
                    const name = language === "ar" ? service.name_ar : service.name_en
                    const desc = language === "ar" ? service.description_ar : service.description_en
                    const providerName = language === "ar" ? service.providers?.name_ar : service.providers?.name_en

                    return (
                      <Card
                        key={service.id}
                        className="overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer group flex flex-col"
                        onClick={() => router.push(`/services/${service.id}`)}
                      >
                        {/* Service Image */}
                        {service.image_urls && service.image_urls.length > 0 && (
                          <div className="w-full h-48 overflow-hidden bg-muted">
                            <img
                              src={service.image_urls[0]}
                              alt={name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          </div>
                        )}

                        <div className="p-6 flex flex-col flex-1 gap-4">
                          {/* Category & Price Type */}
                          <div className="flex items-center justify-between">
                            <Badge variant="secondary">{getCategoryLabel(service.category)}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {getPriceTypeLabel(service.price_type)}
                            </span>
                          </div>

                          {/* Service Name & Description */}
                          <div>
                            <h3 className="font-bold text-lg mb-2 group-hover:text-primary transition-colors">{name}</h3>
                            {desc && <p className="text-sm text-muted-foreground line-clamp-2 overflow-hidden">{desc}</p>}
                          </div>

                          {/* Features */}
                          {service.features && service.features.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {service.features.slice(0, 3).map((feature, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {feature}
                                </Badge>
                              ))}
                              {service.features.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{service.features.length - 3}
                                </Badge>
                              )}
                            </div>
                          )}

                          {/* Delivery Time */}
                          {service.delivery_time && (
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" />
                              <span>{service.delivery_time}</span>
                            </div>
                          )}

                          {/* Spacer to push bottom sections down */}
                          <div className="flex-1" />

                          {/* Price */}
                          <div className="flex items-center gap-1 pt-2 border-t">
                            <DollarSign className="h-4 w-4 text-primary" />
                            <span className="text-2xl font-bold text-primary">
                              {service.price}
                            </span>
                            <span className="text-sm text-muted-foreground ml-1">
                              {t("ر.س", "SAR")}
                            </span>
                          </div>

                          {/* Provider Info */}
                          <div className="flex items-center justify-between pt-3 border-t">
                            <button
                              className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); router.push(`/provider/${service.provider_id}`) }}
                            >
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={service.providers?.avatar_url || "/placeholder.svg"} />
                                <AvatarFallback className="text-xs">
                                  {(providerName || "?").charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="text-start">
                                <p className="text-sm font-medium leading-none">{providerName}</p>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <Star className="h-3 w-3 fill-primary text-primary" />
                                  <span className="text-xs text-muted-foreground">
                                    {service.providers?.rating?.toFixed(1)} ({service.providers?.reviews_count})
                                  </span>
                                </div>
                              </div>
                            </button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => { e.stopPropagation(); handleContactProvider(service.provider_id) }}
                              className="gap-1"
                            >
                              <MessageCircle className="h-4 w-4" />
                              {t("تواصل", "Contact")}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>

                {filteredServices.length === 0 && (
                  <div className="text-center py-20">
                    <Filter className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold mb-2">{t("لا توجد نتائج", "No results found")}</h3>
                    <p className="text-muted-foreground">
                      {t("جرب تغيير معايير البحث أو الفلتر", "Try changing your search or filter criteria")}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
