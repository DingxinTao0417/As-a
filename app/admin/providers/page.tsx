"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useLanguage } from "@/components/language-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Search, Star, ExternalLink } from "lucide-react"

type ProviderRow = {
  id: string
  name_ar: string
  name_en: string
  title_ar: string | null
  title_en: string | null
  bio_ar: string | null
  bio_en: string | null
  category: string
  skills: string[]
  rating: number
  reviews_count: number
  completed_projects: number
  is_verified: boolean
  is_active: boolean
  avatar_url: string | null
  portfolio_urls: string[]
  tap_account_status: string | null
  created_at: string
}

const filterOptions = ["all", "verified", "unverified"] as const
type Filter = typeof filterOptions[number]

export default function AdminProvidersPage() {
  const { t, language } = useLanguage()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>("unverified")
  const [search, setSearch] = useState("")
  const [detail, setDetail] = useState<ProviderRow | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  async function fetchProviders() {
    const supabase = createClient()
    const { data } = await supabase
      .from("providers")
      .select("*")
      .order("created_at", { ascending: false })
    setProviders((data as ProviderRow[]) || [])
    setLoading(false)
  }

  useEffect(() => { fetchProviders() }, [])

  const filtered = providers.filter((p) => {
    const matchFilter =
      filter === "all" ? true : filter === "verified" ? p.is_verified : !p.is_verified
    const name = language === "ar" ? p.name_ar : p.name_en
    const matchSearch = search === "" || name.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

  const handleToggleVerify = async (provider: ProviderRow) => {
    setToggling(provider.id)
    const supabase = createClient()
    await supabase.from("providers").update({ is_verified: !provider.is_verified }).eq("id", provider.id)
    setProviders((prev) =>
      prev.map((p) => p.id === provider.id ? { ...p, is_verified: !p.is_verified } : p)
    )
    if (detail?.id === provider.id) {
      setDetail((d) => d ? { ...d, is_verified: !d.is_verified } : null)
    }
    setToggling(null)
  }

  const filterLabels: Record<Filter, [string, string]> = {
    all: ["الكل", "All"],
    verified: ["موثق", "Verified"],
    unverified: ["غير موثق", "Unverified"],
  }

  const tapStatusColor = (status: string | null) => {
    switch (status) {
      case "active": return "bg-green-100 text-green-700"
      case "not_connected": return "bg-gray-100 text-gray-600"
      default: return "bg-yellow-100 text-yellow-700"
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("توثيق مقدمي الخدمة", "Provider Verification")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("مراجعة ملفات مقدمي الخدمة وتوثيقهم", "Review provider profiles and verify them")}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          {filterOptions.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {t(filterLabels[f][0], filterLabels[f][1])}
            </Button>
          ))}
        </div>
        <div className="relative ms-auto">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="ps-9 w-56"
            placeholder={t("بحث...", "Search...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-start px-4 py-3 font-medium">{t("مقدم الخدمة", "Provider")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الفئة", "Category")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("التقييم", "Rating")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("المشاريع", "Projects")}</th>
                <th className="text-start px-4 py-3 font-medium">Tap Payment</th>
                <th className="text-start px-4 py-3 font-medium">{t("تاريخ الانضمام", "Joined")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الحالة", "Status")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("إجراء", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    {t("لا يوجد مقدمو خدمة", "No providers found")}
                  </td>
                </tr>
              ) : filtered.map((provider) => {
                const name = language === "ar" ? provider.name_ar : provider.name_en
                return (
                  <tr key={provider.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarImage src={provider.avatar_url || ""} />
                          <AvatarFallback>{name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{name}</div>
                          <div className="text-xs text-muted-foreground">
                            {language === "ar" ? provider.title_ar : provider.title_en}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{provider.category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-primary text-primary" />
                        <span>{provider.rating?.toFixed(1)}</span>
                        <span className="text-muted-foreground">({provider.reviews_count})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{provider.completed_projects}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tapStatusColor(provider.tap_account_status)}`}>
                        {provider.tap_account_status || "not_connected"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(provider.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                    </td>
                    <td className="px-4 py-3">
                      {provider.is_verified ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200">
                          {t("موثق", "Verified")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("غير موثق", "Unverified")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDetail(provider)}>
                          {t("تفاصيل", "Details")}
                        </Button>
                        <Button
                          size="sm"
                          variant={provider.is_verified ? "outline" : "default"}
                          onClick={() => handleToggleVerify(provider)}
                          disabled={toggling === provider.id}
                        >
                          {provider.is_verified ? t("إلغاء التوثيق", "Unverify") : t("توثيق", "Verify")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        {detail && (
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={detail.avatar_url || ""} />
                  <AvatarFallback>
                    {(language === "ar" ? detail.name_ar : detail.name_en).charAt(0)}
                  </AvatarFallback>
                </Avatar>
                {language === "ar" ? detail.name_ar : detail.name_en}
                {detail.is_verified && (
                  <Badge className="bg-green-100 text-green-700">{t("موثق", "Verified")}</Badge>
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Title & Bio */}
              <div>
                <div className="text-sm font-medium text-muted-foreground">{t("المسمى الوظيفي", "Title")}</div>
                <div>{language === "ar" ? detail.title_ar : detail.title_en}</div>
              </div>
              {(language === "ar" ? detail.bio_ar : detail.bio_en) && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">{t("نبذة", "Bio")}</div>
                  <p className="text-sm leading-relaxed">
                    {language === "ar" ? detail.bio_ar : detail.bio_en}
                  </p>
                </div>
              )}
              {/* Skills */}
              {detail.skills?.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">{t("المهارات", "Skills")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.skills.map((s, i) => <Badge key={i} variant="outline">{s}</Badge>)}
                  </div>
                </div>
              )}
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xl font-bold">{detail.rating?.toFixed(1)}</div>
                  <div className="text-xs text-muted-foreground">{t("التقييم", "Rating")}</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xl font-bold">{detail.reviews_count}</div>
                  <div className="text-xs text-muted-foreground">{t("التقييمات", "Reviews")}</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xl font-bold">{detail.completed_projects}</div>
                  <div className="text-xs text-muted-foreground">{t("المشاريع", "Projects")}</div>
                </div>
              </div>
              {/* Portfolio */}
              {detail.portfolio_urls?.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">{t("أعمال سابقة", "Portfolio")}</div>
                  <div className="space-y-1">
                    {detail.portfolio_urls.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {/* Action */}
              <div className="pt-2 border-t flex justify-end">
                <Button
                  variant={detail.is_verified ? "outline" : "default"}
                  onClick={() => handleToggleVerify(detail)}
                  disabled={toggling === detail.id}
                >
                  {detail.is_verified ? t("إلغاء التوثيق", "Remove Verification") : t("توثيق مقدم الخدمة", "Verify Provider")}
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
