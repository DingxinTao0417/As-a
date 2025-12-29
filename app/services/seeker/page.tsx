"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useLanguage } from "@/components/language-provider"
import { Search, Star, Briefcase, Filter, SlidersHorizontal, MessageCircle } from "lucide-react"
import { useState, useEffect } from "react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

type Provider = {
  id: string
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
  categories: any
  is_verified: boolean
}

export default function TaskSeekerPage() {
  const { t, language } = useLanguage()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [sortBy, setSortBy] = useState("rating")
  const [providers, setProviders] = useState<Provider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  const categories = [
    { id: "all", nameAr: "الكل", nameEn: "All" },
    { id: "تطوير", nameAr: "تطوير", nameEn: "Development" },
    { id: "تصميم", nameAr: "تصميم", nameEn: "Design" },
    { id: "تسويق", nameAr: "تسويق", nameEn: "Marketing" },
    { id: "كتابة", nameAr: "كتابة", nameEn: "Writing" },
    { id: "تصوير", nameAr: "تصوير", nameEn: "Photography" },
    { id: "استشارات", nameAr: "استشارات", nameEn: "Consulting" },
  ]

  useEffect(() => {
    async function fetchProviders() {
      const supabase = createClient()
      setIsLoading(true)

      try {
        const { data, error } = await supabase.from("providers").select("*").order("rating", { ascending: false })

        if (error) {
          console.error("[v0] Error fetching providers:", error)
          return
        }

        setProviders(data || [])
      } catch (error) {
        console.error("[v0] Error in fetchProviders:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProviders()
  }, [])

  useEffect(() => {
    async function checkUser() {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
    }
    checkUser()
  }, [])

  const filteredProviders = providers
    .filter((provider) => {
      // Category filtering - check if any category in the array matches
      const matchesCategory =
        selectedCategory === "all" ||
        (Array.isArray(provider.categories) &&
          provider.categories.some((cat: string) => cat.includes(selectedCategory)))

      // Search filtering - search in the current language fields
      const name = language === "ar" ? provider.name_ar : provider.name_en
      const title = language === "ar" ? provider.title_ar : provider.title_en

      const matchesSearch =
        searchQuery === "" ||
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        provider.skills.some((skill) => skill.toLowerCase().includes(searchQuery.toLowerCase()))

      return matchesCategory && matchesSearch
    })
    .sort((a, b) => {
      if (sortBy === "rating") return b.rating - a.rating
      if (sortBy === "reviews") return b.reviews_count - a.reviews_count
      if (sortBy === "price-low") return (a.starting_price || 0) - (b.starting_price || 0)
      if (sortBy === "price-high") return (b.starting_price || 0) - (a.starting_price || 0)
      return 0
    })

  const handleContactProvider = async (providerId: string) => {
    if (!user) {
      router.push("/auth/login")
      return
    }

    // Redirect to messages page with provider ID
    router.push(`/messages?provider=${providerId}`)
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
                {t("ابحث عن المحترف المثالي لمشروعك", "Find the Perfect Professional for Your Project")}
              </h1>
              <p className="text-lg text-muted-foreground text-balance">
                {t("آلاف المحترفين الموثوقين جاهزون لخدمتك", "Thousands of trusted professionals ready to serve you")}
              </p>

              {/* Search Bar */}
              <div className="relative max-w-2xl mx-auto">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={t("ابحث عن خدمة أو محترف...", "Search for service or professional...")}
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
                {filteredProviders.length} {t("محترف متاح", "professionals available")}
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
                    <DropdownMenuItem onClick={() => setSortBy("rating")}>
                      {t("الأعلى تقييماً", "Highest Rated")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSortBy("reviews")}>
                      {t("الأكثر مراجعة", "Most Reviewed")}
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
                <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
                  {filteredProviders.map((provider) => {
                    const name = language === "ar" ? provider.name_ar : provider.name_en
                    const title = language === "ar" ? provider.title_ar : provider.title_en
                    const bio = language === "ar" ? provider.bio_ar : provider.bio_en

                    return (
                      <Card
                        key={provider.id}
                        className="break-inside-avoid overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer group"
                      >
                        <div className="relative h-48 overflow-hidden bg-muted">
                          <img
                            src={provider.avatar_url || "/placeholder.svg?height=200&width=300&query=professional"}
                            alt={name}
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                          />
                          <div className="absolute top-3 right-3 bg-background/90 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-1">
                            <Star className="h-4 w-4 fill-primary text-primary" />
                            <span className="font-semibold text-sm">{provider.rating.toFixed(1)}</span>
                            <span className="text-xs text-muted-foreground">({provider.reviews_count})</span>
                          </div>
                          {provider.is_verified && (
                            <div className="absolute top-3 left-3 bg-primary text-primary-foreground px-2 py-1 rounded-full text-xs font-semibold">
                              {t("موثق", "Verified")}
                            </div>
                          )}
                        </div>

                        <div className="p-5 space-y-4">
                          <div>
                            <h3 className="font-bold text-lg mb-1">{name}</h3>
                            <p className="text-sm text-muted-foreground">{title}</p>
                          </div>

                          {bio && <p className="text-sm leading-relaxed line-clamp-3">{bio}</p>}

                          {/* Skills */}
                          <div className="flex flex-wrap gap-2">
                            {provider.skills.slice(0, 4).map((skill, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                          </div>

                          {/* Stats */}
                          <div className="flex items-center gap-4 text-sm text-muted-foreground pt-3 border-t flex-wrap">
                            <div className="flex items-center gap-1">
                              <Briefcase className="h-4 w-4" />
                              <span className="text-xs">
                                {provider.completed_projects} {t("مشروع", "projects")}
                              </span>
                            </div>
                          </div>

                          {/* Price */}
                          <div className="flex items-center justify-between pt-3 border-t gap-2">
                            <div>
                              <span className="text-xs text-muted-foreground">{t("يبدأ من", "Starting at")}</span>
                              <p className="text-xl font-bold text-primary">
                                {provider.starting_price || 0} {t("ر.س", "SAR")}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleContactProvider(provider.id)}
                                className="gap-1"
                              >
                                <MessageCircle className="h-4 w-4" />
                                {t("تواصل", "Contact")}
                              </Button>
                              <Button size="sm" className="bg-primary hover:bg-primary/90">
                                {t("عرض الملف", "View Profile")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>

                {filteredProviders.length === 0 && (
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
