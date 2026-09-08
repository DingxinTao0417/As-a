"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useLanguage } from "@/components/language-provider"
import {
  Plus, Edit2, Trash2, Save, Briefcase, Clock,
  DollarSign, Star, MessageCircle, ImagePlus, X,
  Search, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink,
} from "lucide-react"
import { useState, useEffect, useRef, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import NextImage from "next/image"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select"

const PAGE_SIZE = 6

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
  image_urls: string[]
  is_active: boolean
  created_at: string
}

type ProviderReview = {
  id: string
  rating: number
  comment: string | null
  created_at: string
  profiles: any
}

type SortField = "created_at" | "price" | "name"
type SortDir = "asc" | "desc"

const categories = [
  { value: "development", label_ar: "تطوير البرمجيات", label_en: "Software Development" },
  { value: "design", label_ar: "التصميم", label_en: "Design" },
  { value: "marketing", label_ar: "التسويق", label_en: "Marketing" },
  { value: "writing", label_ar: "الكتابة والترجمة", label_en: "Writing & Translation" },
  { value: "video", label_ar: "الفيديو والرسوم المتحركة", label_en: "Video & Animation" },
  { value: "music", label_ar: "الموسيقى والصوت", label_en: "Music & Audio" },
  { value: "business", label_ar: "الأعمال", label_en: "Business" },
  { value: "consulting", label_ar: "الاستشارات", label_en: "Consulting" },
]

const priceTypes = [
  { value: "fixed", label_ar: "سعر ثابت", label_en: "Fixed Price" },
  { value: "hourly", label_ar: "بالساعة", label_en: "Per Hour" },
  { value: "starting_from", label_ar: "يبدأ من", label_en: "Starting From" },
]

export default function MyServicesPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()

  const [providerId, setProviderId] = useState<string | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // ── dialogs ──
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showReviewsDialog, setShowReviewsDialog] = useState(false)
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [featureInput, setFeatureInput] = useState("")
  const [reviewsList, setReviewsList] = useState<ProviderReview[]>([])
  const [isLoadingReviews, setIsLoadingReviews] = useState(false)

  // ── image upload ──
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [existingImageUrls, setExistingImageUrls] = useState<string[]>([])
  const [isUploadingImages, setIsUploadingImages] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // ── form ──
  const [formData, setFormData] = useState({
    name_ar: "", name_en: "", description_ar: "", description_en: "",
    category: "", price: "", price_type: "fixed", delivery_time: "",
    features: [] as string[],
  })

  // ── search / sort / load-more ──
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // ─────────────────────────────────────────────
  useEffect(() => { checkAuthAndFetch() }, [])

  const checkAuthAndFetch = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push("/auth/login"); return }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "provider") {
      toast({ title: t("غير مسموح", "Not Allowed"), description: t("هذه الصفحة لمقدمي الخدمات فقط", "This page is for providers only"), variant: "destructive" })
      router.push("/"); return
    }

    const { data: provider } = await supabase.from("providers").select("id").eq("user_id", user.id).single()
    if (!provider) { router.push("/register/provider"); return }

    setProviderId(provider.id)
    await fetchServices(provider.id)
    setIsLoading(false)
  }

  const fetchServices = async (provId: string) => {
    const supabase = createClient()
    const { data } = await supabase.from("services").select("*").eq("provider_id", provId).order("created_at", { ascending: false })
    setServices(data || [])
  }

  // ── processed list ──
  const processed = useMemo(() => {
    let list = [...services]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name_ar.toLowerCase().includes(q) ||
        s.name_en.toLowerCase().includes(q) ||
        (s.description_ar || "").toLowerCase().includes(q) ||
        (s.description_en || "").toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      let cmp = 0
      if (sortField === "created_at") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (sortField === "price") cmp = a.price - b.price
      if (sortField === "name") cmp = (language === "ar" ? a.name_ar : a.name_en).localeCompare(language === "ar" ? b.name_ar : b.name_en)
      return sortDir === "asc" ? cmp : -cmp
    })
    return list
  }, [services, search, sortField, sortDir, language])

  const visible = processed.slice(0, visibleCount)
  const hasMore = visibleCount < processed.length

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("desc") }
    setVisibleCount(PAGE_SIZE)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
  }

  // ── form helpers ──
  const resetForm = () => {
    setFormData({ name_ar: "", name_en: "", description_ar: "", description_en: "", category: "", price: "", price_type: "fixed", delivery_time: "", features: [] })
    setFeatureInput(""); setImageFiles([]); setImagePreviews([]); setExistingImageUrls([])
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const addFeature = () => {
    if (featureInput.trim() && !formData.features.includes(featureInput.trim())) {
      setFormData({ ...formData, features: [...formData.features, featureInput.trim()] })
      setFeatureInput("")
    }
  }

  const removeFeature = (f: string) => setFormData({ ...formData, features: formData.features.filter(x => x !== f) })

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const totalCount = existingImageUrls.length + imagePreviews.length + files.length
    const MAX = 10
    if (totalCount > MAX) {
      toast({ title: t("تجاوز الحد المسموح", "Limit exceeded"), description: t(`الحد الأقصى ${MAX} صور`, `Max ${MAX} images`), variant: "destructive" })
      files.splice(MAX - existingImageUrls.length - imagePreviews.length)
    }
    const valid = files.filter(f => {
      if (!f.type.startsWith("image/")) return false
      if (f.size > 10 * 1024 * 1024) { toast({ title: t("ملف كبير جداً", "File too large"), description: `${f.name} > 10MB`, variant: "destructive" }); return false }
      return true
    })
    setImageFiles(p => [...p, ...valid])
    setImagePreviews(p => [...p, ...valid.map(f => URL.createObjectURL(f))])
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const removeNewImage = (i: number) => {
    URL.revokeObjectURL(imagePreviews[i])
    setImageFiles(p => p.filter((_, j) => j !== i))
    setImagePreviews(p => p.filter((_, j) => j !== i))
  }

  const uploadImages = async (serviceId: string): Promise<string[]> => {
    const supabase = createClient()
    const uploaded: string[] = []
    for (const file of imageFiles) {
      const dimensions = await new Promise<{ w: number; h: number }>(resolve => {
        const img = new Image(); const url = URL.createObjectURL(file)
        img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
        img.onerror = () => { resolve({ w: 0, h: 0 }); URL.revokeObjectURL(url) }
        img.src = url
      })
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase()
      const base = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, "_").replace(/_+/g, "_").slice(0, 60)
      const sizeTag = dimensions.w > 0 ? `${dimensions.w}x${dimensions.h}` : "unknown"
      const filePath = `${providerId}/${serviceId}/${base}_${Date.now()}_${sizeTag}.${ext}`
      const { error } = await supabase.storage.from("service-images").upload(filePath, file, { contentType: file.type })
      if (error) continue
      const { data: { publicUrl } } = supabase.storage.from("service-images").getPublicUrl(filePath)
      uploaded.push(publicUrl)
    }
    return uploaded
  }

  // ── CRUD ──
  const handleCreate = async () => {
    if (!providerId || isSaving) return
    if (!formData.name_ar.trim() || !formData.name_en.trim() || !formData.category || !Number.isFinite(Number(formData.price)) || Number(formData.price) <= 0) {
      toast({ title: t("خطأ", "Error"), description: t("يرجى ملء الحقول المطلوبة", "Please fill required fields"), variant: "destructive" }); return
    }
    if (imageFiles.length === 0) {
      toast({ title: t("خطأ", "Error"), description: t("يجب إضافة صورة واحدة على الأقل", "At least one image is required"), variant: "destructive" }); return
    }
    setIsSaving(true); setIsUploadingImages(imageFiles.length > 0)
    try {
    const supabase = createClient()
    const { data: newService, error } = await supabase.from("services").insert({
      provider_id: providerId, name_ar: formData.name_ar, name_en: formData.name_en,
      description_ar: formData.description_ar || null, description_en: formData.description_en || null,
      category: formData.category, price: parseFloat(formData.price) || 0, price_type: formData.price_type,
      delivery_time: formData.delivery_time || null, features: formData.features, is_active: false,
    }).select("id").single()
    if (error || !newService) { setIsSaving(false); setIsUploadingImages(false); toast({ title: t("خطأ", "Error"), description: t("فشل في إنشاء الخدمة", "Failed to create service"), variant: "destructive" }); return }
    let imageSaveFailed = false
    if (imageFiles.length > 0) {
      const urls = await uploadImages(newService.id)
      imageSaveFailed = urls.length !== imageFiles.length
      if (urls.length > 0) {
        const { error: imageError } = await supabase.from("services").update({ image_urls: urls }).eq("id", newService.id)
        if (imageError) imageSaveFailed = true
      }
    }
    setIsSaving(false); setIsUploadingImages(false)
    toast({ title: t("تم حفظ الخدمة", "Service saved"), description: imageSaveFailed ? t("تم حفظ المسودة، لكن بعض الصور لم تُحفظ. افتح التعديل لإضافتها مجدداً.", "Your draft was saved, but some images were not saved. Edit the service to upload them again.") : t("تم إرسال الخدمة للمراجعة. ستظهر للعملاء بعد الموافقة.", "Your service has been submitted for review and will appear to customers after approval."), variant: imageSaveFailed ? "destructive" : "default" })
    setShowCreateDialog(false); resetForm(); await fetchServices(providerId)
    } catch {
      toast({ title: t("خطأ", "Error"), description: t("تعذر حفظ الخدمة. أعد تحميل القائمة قبل المحاولة مجدداً.", "Unable to finish saving. Reload your services before trying again."), variant: "destructive" })
    } finally { setIsSaving(false); setIsUploadingImages(false) }
  }

  const handleEdit = async () => {
    if (!providerId || !selectedService || isSaving) return
    if (!formData.name_ar.trim() || !formData.name_en.trim() || !formData.category || !Number.isFinite(Number(formData.price)) || Number(formData.price) <= 0 || existingImageUrls.length + imageFiles.length === 0) {
      toast({ title: t("خطأ", "Error"), description: t("أكمل الحقول المطلوبة وأضف سعراً صالحاً وصورة واحدة على الأقل.", "Fill the required fields, enter a positive price, and add at least one image."), variant: "destructive" }); return
    }
    setIsSaving(true); setIsUploadingImages(imageFiles.length > 0)
    try {
    const supabase = createClient()
    let newUrls: string[] = []
    if (imageFiles.length > 0) newUrls = await uploadImages(selectedService.id)
    const { error } = await supabase.from("services").update({
      name_ar: formData.name_ar, name_en: formData.name_en,
      description_ar: formData.description_ar || null, description_en: formData.description_en || null,
      category: formData.category, price: parseFloat(formData.price) || 0, price_type: formData.price_type,
      delivery_time: formData.delivery_time || null, features: formData.features,
      image_urls: [...existingImageUrls, ...newUrls],
    }).eq("id", selectedService.id)
    setIsSaving(false); setIsUploadingImages(false)
    if (error) { toast({ title: t("خطأ", "Error"), description: t("فشل في تحديث الخدمة", "Failed to update service"), variant: "destructive" }); return }
    const imageSaveFailed = newUrls.length !== imageFiles.length
    toast({ title: t("تم حفظ الخدمة", "Service saved"), description: imageSaveFailed ? t("بعض الصور لم تُرفع. افتح التعديل لإضافتها مجدداً.", "Some images could not be uploaded. Edit the service to add them again.") : t("تم تحديث الخدمة وإرسالها للمراجعة.", "Service updated and submitted for review."), variant: imageSaveFailed ? "destructive" : "default" })
    setShowEditDialog(false); setSelectedService(null); resetForm(); await fetchServices(providerId)
    } catch {
      toast({ title: t("خطأ", "Error"), description: t("تعذر تحديث الخدمة. يرجى المحاولة مجدداً.", "Unable to update your service. Please try again."), variant: "destructive" })
    } finally { setIsSaving(false); setIsUploadingImages(false) }
  }

  const handleDelete = async () => {
    if (!providerId || !selectedService) return
    const supabase = createClient()
    const { error } = await supabase.from("services").delete().eq("id", selectedService.id)
    if (error) { toast({ title: t("خطأ", "Error"), description: t("فشل في حذف الخدمة", "Failed to delete service"), variant: "destructive" }); return }
    toast({ title: t("تم بنجاح", "Success"), description: t("تم حذف الخدمة بنجاح", "Service deleted successfully") })
    setShowDeleteDialog(false); setSelectedService(null); await fetchServices(providerId)
  }

  const openEditDialog = (s: Service) => {
    setSelectedService(s)
    setFormData({ name_ar: s.name_ar || "", name_en: s.name_en || "", description_ar: s.description_ar || "", description_en: s.description_en || "", category: s.category || "", price: s.price?.toString() || "", price_type: s.price_type || "fixed", delivery_time: s.delivery_time || "", features: s.features || [] })
    setExistingImageUrls(s.image_urls || []); setImageFiles([]); setImagePreviews([])
    setShowEditDialog(true)
  }

  const handleViewReviews = async (s: Service) => {
    setSelectedService(s); setShowReviewsDialog(true); setIsLoadingReviews(true)
    const supabase = createClient()
    try {
      const { data, error } = await supabase.from("reviews").select("id, rating, comment, created_at, reviewer_id").eq("service_id", s.id).order("created_at", { ascending: false })
      if (error) throw error
      const ids = [...new Set((data || []).map((review) => review.reviewer_id))]
      const { data: profiles } = ids.length ? await supabase.from("public_profiles").select("id, full_name, avatar_url").in("id", ids) : { data: [] }
      setReviewsList((data || []).map((review) => ({ ...review, profiles: profiles?.find((profile) => profile.id === review.reviewer_id) || null })))
    } catch {
      setReviewsList([])
      toast({ title: t("خطأ", "Error"), description: t("تعذر تحميل التقييمات.", "Unable to load reviews."), variant: "destructive" })
    } finally { setIsLoadingReviews(false) }
  }

  const getCategoryLabel = (v: string) => { const c = categories.find(x => x.value === v); return c ? (language === "ar" ? c.label_ar : c.label_en) : v }
  const getPriceTypeLabel = (v: string) => { const p = priceTypes.find(x => x.value === v); return p ? (language === "ar" ? p.label_ar : p.label_en) : v }

  // ── shared form ──
  const renderFormFields = (isEdit = false) => (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("اسم الخدمة (عربي)", "Service Name (Arabic)")} *</Label>
          <Input value={formData.name_ar} onChange={e => setFormData({ ...formData, name_ar: e.target.value })} placeholder={t("مثال: تصميم شعار", "e.g., Logo Design")} />
        </div>
        <div className="space-y-2">
          <Label>{t("اسم الخدمة (إنجليزي)", "Service Name (English)")} *</Label>
          <Input value={formData.name_en} onChange={e => setFormData({ ...formData, name_en: e.target.value })} placeholder="e.g., Logo Design" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("الوصف (عربي)", "Description (Arabic)")}</Label>
          <Textarea value={formData.description_ar} onChange={e => setFormData({ ...formData, description_ar: e.target.value })} rows={3} />
        </div>
        <div className="space-y-2">
          <Label>{t("الوصف (إنجليزي)", "Description (English)")}</Label>
          <Textarea value={formData.description_en} onChange={e => setFormData({ ...formData, description_en: e.target.value })} rows={3} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("التصنيف", "Category")} *</Label>
          <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
            <SelectTrigger><SelectValue placeholder={t("اختر التصنيف", "Select category")} /></SelectTrigger>
            <SelectContent>{categories.map(c => <SelectItem key={c.value} value={c.value}>{language === "ar" ? c.label_ar : c.label_en}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("نوع التسعير", "Pricing Type")}</Label>
          <Select value={formData.price_type} onValueChange={v => setFormData({ ...formData, price_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{priceTypes.map(p => <SelectItem key={p.value} value={p.value}>{language === "ar" ? p.label_ar : p.label_en}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("السعر (ر.س)", "Price (SAR)")} *</Label>
          <Input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} placeholder="0" />
        </div>
        <div className="space-y-2">
          <Label>{t("وقت التسليم", "Delivery Time")}</Label>
          <Input value={formData.delivery_time} onChange={e => setFormData({ ...formData, delivery_time: e.target.value })} placeholder={t("مثال: 3-5 أيام", "e.g., 3-5 days")} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t("المميزات المتضمنة", "Included Features")}</Label>
        <div className="flex gap-2">
          <Input value={featureInput} onChange={e => setFeatureInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addFeature())} placeholder={t("أضف ميزة واضغط Enter", "Add feature and press Enter")} />
          <Button type="button" onClick={addFeature} size="icon" variant="outline"><Plus className="h-4 w-4" /></Button>
        </div>
        {formData.features.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {formData.features.map((f, i) => (
              <Badge key={i} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeFeature(f)}>{f}<span className="text-destructive">×</span></Badge>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label>{t("صور الخدمة", "Service Images")}{!isEdit && " *"} <span className="text-muted-foreground text-xs ms-1">({existingImageUrls.length + imagePreviews.length}/10)</span></Label>
        {existingImageUrls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {existingImageUrls.map((url, i) => (
              <div key={i} className="relative h-20 w-24 rounded-lg overflow-hidden border group">
                <NextImage src={url} alt="" width={96} height={80} className="w-full h-full object-cover" />
                <button type="button" onClick={() => setExistingImageUrls(p => p.filter((_, j) => j !== i))} className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        {imagePreviews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {imagePreviews.map((src, i) => (
              <div key={i} className="relative h-20 w-24 rounded-lg overflow-hidden border group">
                <NextImage src={src} alt="" width={96} height={80} className="w-full h-full object-cover" unoptimized />
                <button type="button" onClick={() => removeNewImage(i)} className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        {existingImageUrls.length + imagePreviews.length < 10 && (
          <div>
            <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => imageInputRef.current?.click()}>
              <ImagePlus className="h-4 w-4" />{t("إضافة صور", "Add Images")}
            </Button>
            <p className="text-xs text-muted-foreground mt-1">{t("PNG, JPG حتى 10MB لكل صورة", "PNG, JPG up to 10MB each")}</p>
          </div>
        )}
      </div>
    </div>
  )

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">

        {/* ── Page header ── */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t("خدماتي", "My Services")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {services.length > 0 && (
                processed.length !== services.length
                  ? `${processed.length} / ${services.length} ${t("خدمة", "services")}`
                  : `${services.length} ${t("خدمة", "services")}`
              )}
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowCreateDialog(true) }}>
            <Plus className="h-4 w-4 me-2" />
            {t("إضافة خدمة", "Add Service")}
          </Button>
        </div>

        {services.length > 0 && (
          <>
            {/* ── Search + Sort bar ── */}
            <div className="flex flex-wrap gap-3 mb-6">
              {/* search */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t("ابحث عن خدمة...", "Search services...")}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE) }}
                  className="pr-9"
                />
              </div>

              {/* sort buttons */}
              <div className="flex items-center gap-1.5 text-xs flex-wrap">
                <span className="text-muted-foreground">{t("ترتيب:", "Sort:")}</span>
                {([
                  ["created_at", t("الأحدث", "Date")],
                  ["price",      t("السعر",  "Price")],
                  ["name",       t("الاسم",  "Name")],
                ] as [SortField, string][]).map(([field, label]) => (
                  <Button
                    key={field}
                    variant={sortField === field ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => handleSort(field)}
                  >
                    {label}
                    <SortIcon field={field} />
                  </Button>
                ))}

                {(search || sortField !== "created_at" || sortDir !== "desc") && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSearch(""); setSortField("created_at"); setSortDir("desc"); setVisibleCount(PAGE_SIZE) }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Empty states ── */}
        {services.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <Briefcase className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-semibold mb-2 text-foreground">{t("لا توجد خدمات بعد", "No Services Yet")}</h3>
            <p className="mb-6">{t("ابدأ بإضافة خدمتك الأولى", "Start by adding your first service")}</p>
            <Button onClick={() => { resetForm(); setShowCreateDialog(true) }}>
              <Plus className="h-4 w-4 me-2" />{t("إضافة خدمة جديدة", "Add New Service")}
            </Button>
          </div>
        ) : processed.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>{t("لا توجد نتائج مطابقة", "No matching services")}</p>
            <Button variant="link" size="sm" onClick={() => { setSearch(""); setVisibleCount(PAGE_SIZE) }}>
              {t("مسح البحث", "Clear search")}
            </Button>
          </div>
        ) : (
          <>
            {/* ── Fixed 3-column grid ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {visible.map(service => {
                const name = language === "ar" ? service.name_ar : service.name_en
                const desc = language === "ar" ? service.description_ar : service.description_en
                const cover = service.image_urls?.[0]

                return (
                  <div
                    key={service.id}
                    className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow group cursor-pointer flex flex-col"
                    onClick={() => router.push(`/services/${service.id}`)}
                  >
                    {/* cover image — fixed 16:9 aspect ratio */}
                    {cover ? (
                      <div className="aspect-video overflow-hidden shrink-0">
                        <NextImage
                          src={cover}
                          alt={name}
                          width={400}
                          height={225}
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                        />
                      </div>
                    ) : (
                      <div className="aspect-video bg-muted/50 flex items-center justify-center text-muted-foreground/30 shrink-0">
                        <Briefcase className="h-10 w-10" />
                      </div>
                    )}

                    {/* body */}
                    <div className="p-4 space-y-3">
                      {/* name + status */}
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-sm leading-snug line-clamp-2 flex-1">{name}</h3>
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${service.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                          {service.is_active ? t("نشط", "Active") : t("غير نشط", "Inactive")}
                        </span>
                      </div>

                      {/* category */}
                      <Badge variant="secondary" className="text-xs">{getCategoryLabel(service.category)}</Badge>

                      {/* description */}
                      {desc && <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">{desc}</p>}

                      {/* price + delivery */}
                      <div className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1 font-bold text-primary">
                          <DollarSign className="h-3.5 w-3.5" />
                          {service.price} {t("ر.س", "SAR")}
                          <span className="font-normal text-muted-foreground">({getPriceTypeLabel(service.price_type)})</span>
                        </span>
                        {service.delivery_time && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            {service.delivery_time}
                          </span>
                        )}
                      </div>

                      {/* features */}
                      {service.features?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {service.features.slice(0, 3).map((f, i) => <Badge key={i} variant="outline" className="text-xs">{f}</Badge>)}
                          {service.features.length > 3 && <Badge variant="outline" className="text-xs">+{service.features.length - 3}</Badge>}
                        </div>
                      )}

                      {/* actions — stop propagation */}
                      <div className="flex gap-2 pt-1 border-t border-border" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="flex-1 h-8 text-xs gap-1" onClick={() => handleViewReviews(service)}>
                          <MessageCircle className="h-3.5 w-3.5" />{t("التقييمات", "Reviews")}
                        </Button>
                        <Button variant="ghost" size="sm" className="flex-1 h-8 text-xs gap-1" onClick={() => openEditDialog(service)}>
                          <Edit2 className="h-3.5 w-3.5" />{t("تعديل", "Edit")}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { setSelectedService(service); setShowDeleteDialog(true) }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => router.push(`/services/${service.id}`)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── Load More ── */}
            {hasMore && (
              <div className="text-center mt-8">
                <Button
                  variant="outline"
                  size="lg"
                  className="min-w-[200px]"
                  onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                >
                  {t("تحميل المزيد", "Load More")}
                  <span className="text-muted-foreground text-xs me-2">
                    ({visibleCount} / {processed.length})
                  </span>
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      <Footer />

      {/* ── Create Dialog ── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("إضافة خدمة جديدة", "Add New Service")}</DialogTitle>
            <DialogDescription>{t("أدخل تفاصيل الخدمة التي تريد تقديمها", "Enter the details of the service you want to offer")}</DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>{t("إلغاء", "Cancel")}</Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white me-2" />{isUploadingImages ? t("جاري رفع الصور...", "Uploading...") : t("جاري الحفظ...", "Saving...")}</> : <><Save className="h-4 w-4 me-2" />{t("حفظ", "Save")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("تعديل الخدمة", "Edit Service")}</DialogTitle>
            <DialogDescription>{t("قم بتحديث تفاصيل خدمتك", "Update your service details")}</DialogDescription>
          </DialogHeader>
          {renderFormFields(true)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>{t("إلغاء", "Cancel")}</Button>
            <Button onClick={handleEdit} disabled={isSaving}>
              {isSaving ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white me-2" />{isUploadingImages ? t("جاري رفع الصور...", "Uploading...") : t("جاري الحفظ...", "Saving...")}</> : <><Save className="h-4 w-4 me-2" />{t("حفظ التغييرات", "Save Changes")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Dialog ── */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("حذف الخدمة", "Delete Service")}</AlertDialogTitle>
            <AlertDialogDescription>{t("هل أنت متأكد من حذف هذه الخدمة؟ لا يمكن التراجع.", "Are you sure? This cannot be undone.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("حذف", "Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Reviews Dialog ── */}
      <Dialog open={showReviewsDialog} onOpenChange={setShowReviewsDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("تقييمات الخدمة", "Service Reviews")}: {selectedService ? (language === "ar" ? selectedService.name_ar : selectedService.name_en) : ""}</DialogTitle>
          </DialogHeader>
          {isLoadingReviews ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
          ) : reviewsList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>{t("لا توجد تقييمات حتى الآن", "No reviews yet")}</p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {reviewsList.map(review => (
                <div key={review.id} className="bg-muted/30 p-4 rounded-xl border">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-secondary overflow-hidden flex-shrink-0 flex items-center justify-center text-sm font-bold">
                        {review.profiles?.avatar_url ? <NextImage src={review.profiles.avatar_url} alt="" width={40} height={40} className="w-full h-full object-cover" /> : (review.profiles?.full_name?.charAt(0) || "?")}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{review.profiles?.full_name || t("مستخدم", "User")}</p>
                        <p className="text-xs text-muted-foreground">{new Date(review.created_at).toISOString().slice(0, 10)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-background px-2 py-1 rounded-full border">
                      <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                      <span className="text-xs font-bold">{review.rating}</span>
                    </div>
                  </div>
                  {review.comment && <p className="text-sm mt-3 pt-3 border-t text-foreground/90 leading-relaxed">"{review.comment}"</p>}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewsDialog(false)}>{t("إغلاق", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
