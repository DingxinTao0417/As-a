"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useLanguage } from "@/components/language-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Search, CheckCircle, XCircle, Eye, DollarSign, Clock } from "lucide-react"
import { setServiceActive } from "@/app/actions/admin"

type ServiceRow = {
  id: string
  name_ar: string
  name_en: string
  description_ar: string | null
  description_en: string | null
  category: string
  price: number
  price_type: string
  delivery_time: string | null
  is_active: boolean
  image_urls: string[]
  features: string[]
  created_at: string
  providers: {
    name_ar: string
    name_en: string
    avatar_url: string | null
  } | null
}

const filterOptions = ["all", "active", "inactive"] as const
type Filter = typeof filterOptions[number]

export default function AdminServicesPage() {
  const { t, language } = useLanguage()
  const [services, setServices] = useState<ServiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")
  const [preview, setPreview] = useState<ServiceRow | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchServices() {
    try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("services")
      .select("*, providers(name_ar, name_en, avatar_url)")
      .order("created_at", { ascending: false })
    if (error) throw error
    setServices((data as ServiceRow[]) || [])
    } catch { setError("Unable to load services. Please refresh and try again.") }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchServices() }, [])

  const filtered = services.filter((s) => {
    const matchFilter =
      filter === "all" ? true : filter === "active" ? s.is_active : !s.is_active
    const name = language === "ar" ? s.name_ar : s.name_en
    const matchSearch = search === "" || name.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

  const handleToggle = async (service: ServiceRow) => {
    if (toggling) return
    setToggling(service.id)
    setError(null)
    try {
    const result = await setServiceActive(service.id, !service.is_active)
    if (!result.success) throw new Error(result.error)
    setServices((prev) =>
      prev.map((s) => s.id === service.id ? { ...s, is_active: !s.is_active } : s)
    )
    setPreview((current) => current?.id === service.id ? { ...current, is_active: !service.is_active } : current)
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to update service.") }
    finally { setToggling(null) }
  }

  const filterLabels: Record<Filter, [string, string]> = {
    all: ["الكل", "All"],
    active: ["مفعّل", "Active"],
    inactive: ["معلق", "Inactive"],
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
      {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
      <div>
        <h1 className="text-2xl font-bold">{t("مراجعة الخدمات", "Services Review")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("إدارة وتفعيل خدمات مقدمي الخدمة", "Manage and activate provider services")}
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
                <th className="text-start px-4 py-3 font-medium">{t("الخدمة", "Service")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("مقدم الخدمة", "Provider")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الفئة", "Category")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("السعر", "Price")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("تاريخ الإنشاء", "Created")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الحالة", "Status")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("إجراء", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {t("لا توجد خدمات", "No services found")}
                  </td>
                </tr>
              ) : filtered.map((service) => {
                const name = language === "ar" ? service.name_ar : service.name_en
                const providerName = service.providers
                  ? language === "ar" ? service.providers.name_ar : service.providers.name_en
                  : "—"
                return (
                  <tr key={service.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {service.image_urls?.[0] && (
                          <img
                            src={service.image_urls[0]}
                            alt={name}
                            className="w-10 h-10 rounded object-cover shrink-0"
                          />
                        )}
                        <span className="font-medium line-clamp-1">{name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{providerName}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{service.category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-3.5 w-3.5 text-primary" />
                        <span className="font-medium">{service.price}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(service.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                    </td>
                    <td className="px-4 py-3">
                      {service.is_active ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200">
                          <CheckCircle className="h-3 w-3 me-1" />
                          {t("مفعّل", "Active")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 me-1" />
                          {t("معلق", "Inactive")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreview(service)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant={service.is_active ? "destructive" : "default"}
                          onClick={() => handleToggle(service)}
                          disabled={toggling === service.id}
                        >
                          {service.is_active ? t("تعليق", "Deactivate") : t("تفعيل", "Activate")}
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

      {/* Preview Dialog */}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        {preview && (
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {language === "ar" ? preview.name_ar : preview.name_en}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Images */}
              {preview.image_urls?.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {preview.image_urls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt={`image-${i}`}
                      className="w-32 h-32 rounded object-cover"
                    />
                  ))}
                </div>
              )}
              {/* Details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">{t("الفئة", "Category")}</div>
                  <div className="font-medium">{preview.category}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("السعر", "Price")}</div>
                  <div className="font-medium flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5 text-primary" />
                    {preview.price} ({preview.price_type})
                  </div>
                </div>
                {preview.delivery_time && (
                  <div>
                    <div className="text-muted-foreground">{t("وقت التسليم", "Delivery")}</div>
                    <div className="font-medium flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {preview.delivery_time}
                    </div>
                  </div>
                )}
              </div>
              {/* Description */}
              {(language === "ar" ? preview.description_ar : preview.description_en) && (
                <div>
                  <div className="text-muted-foreground text-sm mb-1">{t("الوصف", "Description")}</div>
                  <p className="text-sm leading-relaxed">
                    {language === "ar" ? preview.description_ar : preview.description_en}
                  </p>
                </div>
              )}
              {/* Features */}
              {preview.features?.length > 0 && (
                <div>
                  <div className="text-muted-foreground text-sm mb-2">{t("المميزات", "Features")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.features.map((f, i) => (
                      <Badge key={i} variant="outline">{f}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {/* Action */}
              <div className="pt-2 border-t flex justify-end">
                <Button
                  variant={preview.is_active ? "destructive" : "default"}
                  onClick={() => { handleToggle(preview); setPreview(null) }}
                >
                  {preview.is_active ? t("تعليق الخدمة", "Deactivate Service") : t("تفعيل الخدمة", "Activate Service")}
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
