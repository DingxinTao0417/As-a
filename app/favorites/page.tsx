"use client"

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/language-provider"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Heart, Star, Briefcase, DollarSign, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  getFavoriteProviders,setProviderFavorite,
  type FavoriteCursor,type FavoriteProvider,
} from "@/app/actions/favorites"
import { LoadErrorCard } from "@/components/load-error-card"

export default function FavoritesPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [favorites, setFavorites] = useState<FavoriteProvider[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cursor,setCursor]=useState<FavoriteCursor|null>(null)
  const [total,setTotal]=useState(0)
  const [loadingMore,setLoadingMore]=useState(false)
  const [removingProviderId, setRemovingProviderId] = useState<string | null>(null)

  const loadFavorites=async(pageCursor:FavoriteCursor|null=null,append=false)=>{
    if(append)setLoadingMore(true);else{setLoading(true);setLoadError(null)}
    const result=await getFavoriteProviders(pageCursor)
    if(result.success){
      setFavorites((current)=>append?[...current,...result.data.favorites.filter((favorite)=>!current.some((item)=>item.id===favorite.id))]:result.data.favorites)
      setCursor(result.data.nextCursor);if(!append||result.data.favorites.length>0)setTotal(result.data.total);setLoadError(null)
    }else{
      setLoadError(result.error)
      toast({title:t("تعذر تحميل المفضلة","Could not load favorites"),description:result.error,variant:"destructive"})
    }
    if(append)setLoadingMore(false);else setLoading(false)
  }
  useEffect(()=>{void loadFavorites()},[])

  const removeFavorite = async (providerId: string) => {
    setRemovingProviderId(providerId)
    try {
      const result = await setProviderFavorite(providerId, false)
      if (!result.success) {
        toast({ title: t("فشل الحفظ", "Save failed"), description: result.error, variant: "destructive" })
        return
      }
      setFavorites((current) => current.filter((favorite) => favorite.provider_id !== providerId))
      setTotal((current)=>Math.max(0,current-1))
    } catch {
      toast({ title: t("فشل الحفظ", "Save failed"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
    } finally {
      setRemovingProviderId(null)
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
              {t("قائمة مقدمي الخدمات المفضلين لديك", "Your favorite service providers")} {favorites.length} / {total}
            </p>
          </div>

          {loadError&&favorites.length===0 ? (
            <LoadErrorCard title={t("تعذر تحميل المفضلة","Could not load favorites")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadFavorites()} />
          ) : favorites.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Heart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">{t("لا توجد مفضلات حتى الآن", "No favorites yet")}</p>
              </CardContent>
            </Card>
          ) : (
            <>{loadError&&<LoadErrorCard title={t("تعذر تحديث المفضلة","Could not refresh favorites")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadFavorites()} />}<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                        onClick={() => removeFavorite(favorite.provider_id)}
                        disabled={removingProviderId === favorite.provider_id}
                        aria-label={t("إزالة من المفضلة", "Remove from favorites")}
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
                      {favorite.provider?.is_verified && (
                        <Badge variant="secondary">
                          <Briefcase className="h-3 w-3 ms-1" />
                          {t("موثق", "Verified")}
                        </Badge>
                      )}
                      {!favorite.provider.is_available&&<Badge variant="outline">{t("غير متاح","Unavailable")}</Badge>}
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t">
                      <div className="flex items-center gap-1 text-sm font-semibold">
                        <DollarSign className="h-4 w-4" />
                        {favorite.provider?.starting_price ?? "—"} {t("ريال", "SAR")}
                      </div>
                      {favorite.provider.is_available?<Button size="sm" asChild>
                        <a href={`/messages?provider=${favorite.provider_id}`}>{t("تواصل", "Contact")}</a>
                      </Button>:<Button size="sm" disabled>{t("غير متاح","Unavailable")}</Button>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>{cursor&&favorites.length<total&&<div className="mt-6 text-center"><Button variant="outline" onClick={()=>void loadFavorites(cursor,true)} disabled={loadingMore}>{loadingMore?t("جاري التحميل...","Loading..."):t("تحميل مفضلات أقدم","Load Older Favorites")}</Button></div>}</>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
