"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Heart, Star, Briefcase, DollarSign, Trash2 } from "lucide-react"

interface Favorite {
  id: string
  provider_id: string
  provider: {
    name_ar: string
    name_en: string
    title_ar: string
    title_en: string
    avatar_url: string
    rating: number
    starting_price: number
  }
}

export default function FavoritesPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const loadFavorites = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      setUser(user)

      // Fetch favorites with provider info
      const { data, error } = await supabase.from("favorites").select("id, provider_id").eq("user_id", user.id)

      if (error) {
        console.error("[v0] Error fetching favorites:", error)
      } else if (data) {
        // Fetch provider details for each favorite
        const providerIds = data.map((f: any) => f.provider_id)
        const { data: providers, error: providerError } = await supabase
          .from("providers")
          .select("*")
          .in("id", providerIds)

        if (!providerError) {
          const favoritesWithProviders = data.map((fav: any) => ({
            ...fav,
            provider: providers.find((p: any) => p.id === fav.provider_id),
          }))
          setFavorites(favoritesWithProviders)
        }
      }

      setLoading(false)
    }

    loadFavorites()
  }, [router])

  const removeFavorite = async (favoriteId: string) => {
    const supabase = createClient()
    const { error } = await supabase.from("favorites").delete().eq("id", favoriteId)

    if (!error) {
      setFavorites(favorites.filter((f) => f.id !== favoriteId))
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 bg-muted/30 py-8">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="mb-6">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Heart className="h-8 w-8 text-red-500" />
              {t("المفضلة", "Favorites")}
            </h1>
            <p className="text-muted-foreground mt-2">
              {t("قائمة مقدمي الخدمات المفضلين لديك", "Your favorite service providers")}
            </p>
          </div>

          {favorites.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Heart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">{t("لا توجد مفضلات حتى الآن", "No favorites yet")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {favorites.map((favorite) => (
                <Card key={favorite.id} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={favorite.provider?.avatar_url || "/placeholder.svg"} />
                        <AvatarFallback>
                          {language === "ar"
                            ? favorite.provider?.name_ar?.charAt(0)
                            : favorite.provider?.name_en?.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeFavorite(favorite.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <h3 className="font-semibold text-lg mb-1">
                      {language === "ar" ? favorite.provider?.name_ar : favorite.provider?.name_en}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      {language === "ar" ? favorite.provider?.title_ar : favorite.provider?.title_en}
                    </p>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-semibold">{favorite.provider?.rating}</span>
                      </div>
                      <Badge variant="secondary">
                        <Briefcase className="h-3 w-3 ml-1" />
                        {language === "ar" ? "محترف" : "Professional"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t">
                      <div className="flex items-center gap-1 text-sm font-semibold">
                        <DollarSign className="h-4 w-4" />
                        {favorite.provider?.starting_price} {t("ريال", "SAR")}
                      </div>
                      <Button size="sm" asChild>
                        <a href={`/messages?provider=${favorite.provider_id}`}>{t("تواصل", "Contact")}</a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
