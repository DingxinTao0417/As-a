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
  AlertCircle,
} from "lucide-react"
import { useState, useEffect, useRef } from "react"
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
import {
  createServiceDraft,
  deleteService,
  getProviderServicePage,
  getServiceImageCleanupJobs,
  queueServiceImageCleanup,
  retryServiceImageCleanupJobs,
  setServicePublishIntent,
  submitServiceForReview,
  updateServiceDraft,
  type ServiceInput,
  type ProviderServiceCursor,
} from "@/app/actions/services"
import {
  enqueueServiceImageCleanup,
  readServiceImageCleanupJobs,
  writeServiceImageCleanupJobs,
  type ServiceImageCleanupJob,
} from "@/lib/service-image-cleanup"
import { getServiceReviews } from "@/app/actions/reviews"
import { LoadErrorCard } from "@/components/load-error-card"
import { getCurrentProviderContext } from "@/app/actions/providers"

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
  moderation_status?: "draft" | "pending_review" | "approved" | "rejected" | "suspended"
  moderation_note?: string | null
  provider_publish_intent?: boolean
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [servicesLoading,setServicesLoading]=useState(true)
  const [serviceCursor,setServiceCursor]=useState<ProviderServiceCursor|null>(null)
  const [serviceTotal,setServiceTotal]=useState(0)
  const [loadingMoreServices,setLoadingMoreServices]=useState(false)
  const serviceRequestVersion=useRef(0)

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
  const [reviewLoadError,setReviewLoadError]=useState<string|null>(null)
  const [reviewCursor,setReviewCursor]=useState<{createdAt:string;id:string}|null>(null)
  const [reviewTotal,setReviewTotal]=useState(0)
  const [loadingMoreReviews,setLoadingMoreReviews]=useState(false)

  // ── image upload ──
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [existingImageUrls, setExistingImageUrls] = useState<string[]>([])
  const [isUploadingImages, setIsUploadingImages] = useState(false)
  const [pendingImageCleanupCount, setPendingImageCleanupCount] = useState(0)
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

  // ─────────────────────────────────────────────
  useEffect(() => { checkAuthAndFetch() }, [loadAttempt])

  const checkAuthAndFetch = async () => {
    setIsLoading(true)
    setLoadError(null)
    const supabase = createClient()
    const { data: { user },error:authError } = await supabase.auth.getUser()
    if (authError) {setLoadError(t("تعذر التحقق من الجلسة","Could not verify your session"));setIsLoading(false);return}
    if (!user) { router.push("/auth/login"); return }

    const contextResult=await getCurrentProviderContext()
    if(!contextResult.success){
      setLoadError(t("تعذر التحقق من صلاحيات الحساب","Could not verify account permissions"))
      setIsLoading(false)
      return
    }
    if (contextResult.data.role !== "provider") {
      toast({ title: t("غير مسموح", "Not Allowed"), description: t("هذه الصفحة لمقدمي الخدمات فقط", "This page is for providers only"), variant: "destructive" })
      router.push("/"); return
    }
    const provider=contextResult.data.provider
    if (!provider) { router.push("/register/provider"); return }

    setProviderId(provider.id)
    await syncLocalCleanupQueue(provider.id)
    await refreshCleanupCount(provider.id)
    setIsLoading(false)
  }

  const fetchServices = async (cursor:ProviderServiceCursor|null=null,append=false) => {
    const version=append?serviceRequestVersion.current:++serviceRequestVersion.current
    if(append)setLoadingMoreServices(true);else{setServicesLoading(true);setLoadingMoreServices(false)}
    const result=await getProviderServicePage(search,sortField,sortDir,language,cursor,PAGE_SIZE)
    if(version!==serviceRequestVersion.current)return false
    if(!result.success){
      if(!append)setLoadError(result.error)
      toast({title:t("تعذر تحميل الخدمات","Could not load services"),description:result.error,variant:"destructive"})
      if(append)setLoadingMoreServices(false);else setServicesLoading(false)
      return false
    }
    setServices((current)=>append?[...current,...result.data.services.filter((service)=>!current.some((item)=>item.id===service.id))]:result.data.services)
    setServiceCursor(result.data.nextCursor)
    if(!append||result.data.services.length>0)setServiceTotal(result.data.total)
    setLoadError(null)
    if(append)setLoadingMoreServices(false);else setServicesLoading(false)
    return true
  }

  useEffect(()=>{
    if(!providerId)return
    const timeout=window.setTimeout(()=>{void fetchServices()},300)
    return()=>window.clearTimeout(timeout)
  },[providerId,search,sortField,sortDir,language,loadAttempt])

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("desc") }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
  }

  // ── form helpers ──
  const resetForm = () => {
    imagePreviews.forEach((url)=>URL.revokeObjectURL(url))
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
    const validMimeTypes = ["image/jpeg", "image/png", "image/webp"]
    const valid = files.filter(f => {
      if (!validMimeTypes.includes(f.type)) {
        toast({ title: t("نوع ملف غير مدعوم", "Unsupported file type"), description: f.name, variant: "destructive" })
        return false
      }
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

  const uploadImages = async (serviceId: string) => {
    const supabase = createClient()
    const uploaded: string[] = []
    const uploadedPaths: string[] = []
    const failed: string[] = []
    for (const file of imageFiles) {
      const dimensions = await new Promise<{ w: number; h: number }>(resolve => {
        const img = new Image(); const url = URL.createObjectURL(file)
        img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
        img.onerror = () => { resolve({ w: 0, h: 0 }); URL.revokeObjectURL(url) }
        img.src = url
      })
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"
      const sizeTag = dimensions.w > 0 ? `${dimensions.w}x${dimensions.h}` : "unknown"
      const filePath = `${providerId}/${serviceId}/${crypto.randomUUID()}_${sizeTag}.${ext}`
      try {
        const { error } = await supabase.storage.from("service-images").upload(filePath, file, { contentType: file.type })
        if (error) {
          failed.push(file.name)
          continue
        }
      } catch {
        failed.push(file.name)
        continue
      }
      const { data: { publicUrl } } = supabase.storage.from("service-images").getPublicUrl(filePath)
      uploaded.push(publicUrl)
      uploadedPaths.push(filePath)
    }
    return { urls: uploaded, paths: uploadedPaths, failed }
  }

  const serviceImagePath = (url: string) => {
    try {
      const marker = "/storage/v1/object/public/service-images/"
      const pathname = new URL(url).pathname
      const index = pathname.indexOf(marker)
      return index >= 0 ? decodeURIComponent(pathname.slice(index + marker.length)) : null
    } catch {
      return null
    }
  }

  const refreshCleanupCount=async(provId:string)=>{
    const paths=new Set(readServiceImageCleanupJobs(provId).flatMap((job)=>job.paths))
    const remote=await getServiceImageCleanupJobs()
    if(remote.success)for(const job of remote.data.jobs)paths.add(job.storage_path)
    setPendingImageCleanupCount(paths.size)
  }
  const syncLocalCleanupQueue=async(provId:string)=>{
    const jobs=readServiceImageCleanupJobs(provId)
    const remaining:ServiceImageCleanupJob[]=[]
    for(const job of jobs){
      const result=await queueServiceImageCleanup(job.serviceId,job.paths)
      if(!result.success)remaining.push(job)
    }
    writeServiceImageCleanupJobs(provId,remaining)
    return remaining
  }
  const rememberImageCleanup=async(serviceId:string,paths:string[])=>{
    if(!providerId||!paths.length)return false
    const saved=enqueueServiceImageCleanup(providerId,serviceId,paths)
    const remaining=await syncLocalCleanupQueue(providerId)
    await refreshCleanupCount(providerId)
    return saved&&remaining.length===0
  }

  const removeStoredImages = async (paths: string[],serviceId:string) => {
    if (paths.length === 0) return true
    try {
      const { error } = await createClient().storage.from("service-images").remove(paths)
      if(!error)return true
    } catch {
      // Preserve the paths below so the user can retry after reconnecting.
    }
    await rememberImageCleanup(serviceId,paths)
    return false
  }

  const retryImageCleanup=async()=>{
    if(!providerId||isUploadingImages)return
    setIsUploadingImages(true)
    const localRemaining=await syncLocalCleanupQueue(providerId)
    const result=await retryServiceImageCleanupJobs()
    await refreshCleanupCount(providerId)
    toast(!result.success||localRemaining.length
      ? {title:t("تعذر تنظيف بعض الصور","Some images could not be cleaned up"),description:result.success?t("ستبقى في قائمة إعادة المحاولة","They remain in the retry queue"):result.error,variant:"destructive"}
      : result.data.remaining>0
        ? {title:t("تم تنظيف دفعة من الصور","A batch of images was cleaned"),description:t("توجد دفعة أخرى بانتظار إعادة المحاولة","Another batch remains in the retry queue")}
        : {title:t("تم تنظيف الصور المتبقية","Pending images cleaned up")})
    setIsUploadingImages(false)
  }

  const currentServiceInput = (imageUrls: string[] = []): ServiceInput | null => {
    const price = Number.parseFloat(formData.price)
    if (!formData.name_ar.trim() || !formData.name_en.trim() || !formData.category
        || !Number.isFinite(price) || price < 1 || price > 1000000
        || Math.round(price * 100) / 100 !== price) return null
    return {
      nameAr: formData.name_ar,
      nameEn: formData.name_en,
      descriptionAr: formData.description_ar,
      descriptionEn: formData.description_en,
      category: formData.category as ServiceInput["category"],
      price,
      priceType: formData.price_type as ServiceInput["priceType"],
      deliveryTime: formData.delivery_time,
      features: formData.features,
      imageUrls,
    }
  }

  // ── CRUD ──
  const handleCreate = async () => {
    if (!providerId) return
    const input = currentServiceInput()
    if (!input) {
      toast({ title: t("خطأ", "Error"), description: t("تحقق من الحقول المطلوبة والسعر", "Check the required fields and price"), variant: "destructive" }); return
    }
    if (imageFiles.length === 0) {
      toast({ title: t("خطأ", "Error"), description: t("يجب إضافة صورة واحدة على الأقل", "At least one image is required"), variant: "destructive" }); return
    }
    setIsSaving(true); setIsUploadingImages(imageFiles.length > 0)
    try {
      const createResult = await createServiceDraft(input)
      if (!createResult.success) {
        toast({ title: t("فشل إنشاء المسودة", "Draft creation failed"), description: createResult.error, variant: "destructive" })
        return
      }

      const upload = await uploadImages(createResult.data.serviceId)
      if (upload.urls.length > 0) {
        const updateResult = await updateServiceDraft(createResult.data.serviceId, { ...input, imageUrls: upload.urls })
        if (!updateResult.success) {
          await removeStoredImages(upload.paths,createResult.data.serviceId)
          toast({
            title: t("تم حفظ المسودة بدون الصور", "Draft saved without images"),
            description: t("تعذر ربط الصور. افتح المسودة وحاول مرة أخرى", "Images could not be attached. Open the draft and try again"),
            variant: "destructive",
          })
          setShowCreateDialog(false); resetForm(); await fetchServices()
          return
        }
      }

      if (upload.failed.length > 0 || upload.urls.length === 0) {
        toast({
          title: t("تم حفظ الخدمة كمسودة", "Service saved as a draft"),
          description: t("فشل رفع بعض الصور. افتح المسودة لإعادة المحاولة", "Some images failed to upload. Open the draft to retry"),
          variant: "destructive",
        })
      } else {
        const submitResult = await submitServiceForReview(createResult.data.serviceId)
        toast(submitResult.success
          ? {
              title: t("تم إرسال الخدمة للمراجعة", "Service submitted for review"),
              description: t("ستظهر الخدمة بعد موافقة الإدارة", "The service will appear after administrator approval"),
            }
          : {
              title: t("تم حفظ الخدمة كمسودة", "Service saved as a draft"),
              description: submitResult.error,
              variant: "destructive",
            })
      }
      setShowCreateDialog(false); resetForm(); await fetchServices()
    } catch {
      toast({
        title: t("تعذر حفظ الخدمة", "Could not save the service"),
        description: t("تم الاحتفاظ بالنموذج. حاول مرة أخرى", "The form was kept. Try again"),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false); setIsUploadingImages(false)
    }
  }

  const handleEdit = async () => {
    if (!providerId || !selectedService) return
    if (existingImageUrls.length + imageFiles.length === 0) {
      toast({ title: t("خطأ", "Error"), description: t("يجب إضافة صورة واحدة على الأقل", "At least one image is required"), variant: "destructive" }); return
    }
    setIsSaving(true); setIsUploadingImages(imageFiles.length > 0)
    let upload = { urls: [] as string[], paths: [] as string[], failed: [] as string[] }
    try {
      if (imageFiles.length > 0) upload = await uploadImages(selectedService.id)
      const finalUrls = [...existingImageUrls, ...upload.urls]
      const input = currentServiceInput(finalUrls)
      if (!input) {
        await removeStoredImages(upload.paths,selectedService.id)
        toast({ title: t("خطأ", "Error"), description: t("تحقق من الحقول المطلوبة والسعر", "Check the required fields and price"), variant: "destructive" })
        return
      }
      const result = await updateServiceDraft(selectedService.id, input)
      if (!result.success) {
        await removeStoredImages(upload.paths,selectedService.id)
        toast({ title: t("فشل الحفظ", "Save failed"), description: result.error, variant: "destructive" })
        return
      }

      const removedPaths = selectedService.image_urls
        .filter((url) => !existingImageUrls.includes(url))
        .map(serviceImagePath)
        .filter((path): path is string => Boolean(path))
      const removedCleanly = await removeStoredImages(removedPaths,selectedService.id)
      if (upload.failed.length > 0 || !removedCleanly) {
        toast({
          title: t("تم حفظ التغييرات مع تحذير", "Changes saved with a warning"),
          description: t("تعذر إكمال بعض عمليات الصور. يمكنك المحاولة مرة أخرى", "Some image operations could not be completed. You can try again"),
          variant: "destructive",
        })
      } else {
        const submitResult = await submitServiceForReview(selectedService.id)
        toast(submitResult.success
          ? { title: t("تم إرسال التغييرات للمراجعة", "Changes submitted for review") }
          : { title: t("تم حفظ التغييرات كمسودة", "Changes saved as a draft"), description: submitResult.error, variant: "destructive" })
      }
      setShowEditDialog(false); setSelectedService(null); resetForm(); await fetchServices()
    } catch {
      await removeStoredImages(upload.paths,selectedService.id)
      toast({
        title: t("تعذر حفظ التغييرات", "Could not save changes"),
        description: t("تم الاحتفاظ بالنموذج. حاول مرة أخرى", "The form was kept. Try again"),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false); setIsUploadingImages(false)
    }
  }

  const handleDelete = async () => {
    if (!providerId || !selectedService) return
    try {
      const result = await deleteService(selectedService.id)
      if (!result.success) { toast({ title: t("فشل الحذف", "Delete failed"), description: result.error, variant: "destructive" }); return }
      const paths = result.data.imageUrls.map(serviceImagePath).filter((path): path is string => Boolean(path))
      const removedCleanly = await removeStoredImages(paths,selectedService.id)
      toast({
        title: t("تم حذف الخدمة", "Service deleted"),
        description: removedCleanly
          ? undefined
          : t("تعذر تنظيف بعض ملفات الصور وسيعاد فحصها لاحقاً", "Some image files could not be cleaned up and need a later retry"),
        variant: removedCleanly ? "default" : "destructive",
      })
      setShowDeleteDialog(false); setSelectedService(null); await fetchServices()
    } catch {
      toast({ title: t("فشل الحذف", "Delete failed"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
    }
  }

  const handlePublishIntent = async (service: Service) => {
    const publish = !service.is_active
    const result = await setServicePublishIntent(service.id, publish)
    if (!result.success) {
      toast({ title: t("فشل الحفظ", "Save failed"), description: result.error, variant: "destructive" })
      return
    }
    setServices((current) => current.map((item) => item.id === service.id
      ? { ...item, is_active: publish, provider_publish_intent: publish }
      : item))
    toast({ title: publish ? t("تم نشر الخدمة", "Service published") : t("تم إيقاف الخدمة مؤقتاً", "Service paused") })
  }

  const openEditDialog = (s: Service) => {
    setSelectedService(s)
    setFormData({ name_ar: s.name_ar || "", name_en: s.name_en || "", description_ar: s.description_ar || "", description_en: s.description_en || "", category: s.category || "", price: s.price?.toString() || "", price_type: s.price_type || "fixed", delivery_time: s.delivery_time || "", features: s.features || [] })
    setExistingImageUrls(s.image_urls || []); setImageFiles([]); setImagePreviews([])
    setShowEditDialog(true)
  }

  const loadServiceReviews=async(service:Service,cursor?:{createdAt:string;id:string},append=false)=>{
    if(append)setLoadingMoreReviews(true);else{setIsLoadingReviews(true);setReviewLoadError(null)}
    const result=await getServiceReviews(service.id,cursor,10)
    if(result.success){
      setReviewsList((current)=>append?[...current,...result.data.reviews.filter((review)=>!current.some((item)=>item.id===review.id))]:result.data.reviews)
      setReviewCursor(result.data.nextCursor);setReviewTotal(result.data.summary.total);setReviewLoadError(null)
    }else{
      setReviewLoadError(result.error)
      toast({title:t("تعذر تحميل التقييمات","Could not load reviews"),description:result.error,variant:"destructive"})
    }
    if(append)setLoadingMoreReviews(false);else setIsLoadingReviews(false)
  }

  const handleViewReviews = async (s: Service) => {
    setSelectedService(s);setShowReviewsDialog(true);setReviewsList([]);setReviewCursor(null);setReviewTotal(0)
    await loadServiceReviews(s)
  }

  const getCategoryLabel = (v: string) => { const c = categories.find(x => x.value === v); return c ? (language === "ar" ? c.label_ar : c.label_en) : v }
  const getPriceTypeLabel = (v: string) => { const p = priceTypes.find(x => x.value === v); return p ? (language === "ar" ? p.label_ar : p.label_en) : v }
  const getModerationLabel = (service: Service) => {
    switch (service.moderation_status) {
      case "draft": return t("مسودة", "Draft")
      case "pending_review": return t("بانتظار المراجعة", "Pending Review")
      case "approved": return service.is_active ? t("منشورة", "Published") : t("متوقفة مؤقتاً", "Paused")
      case "rejected": return t("مرفوضة", "Rejected")
      case "suspended": return t("موقوفة من الإدارة", "Suspended")
      default: return service.is_active ? t("نشطة", "Active") : t("غير نشطة", "Inactive")
    }
  }

  // ── shared form ──
  const renderFormFields = (isEdit = false) => (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="service-name-ar">{t("اسم الخدمة (عربي)", "Service Name (Arabic)")} *</Label>
          <Input id="service-name-ar" value={formData.name_ar} onChange={e => setFormData({ ...formData, name_ar: e.target.value })} placeholder={t("مثال: تصميم شعار", "e.g., Logo Design")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="service-name-en">{t("اسم الخدمة (إنجليزي)", "Service Name (English)")} *</Label>
          <Input id="service-name-en" value={formData.name_en} onChange={e => setFormData({ ...formData, name_en: e.target.value })} placeholder="e.g., Logo Design" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="service-description-ar">{t("الوصف (عربي)", "Description (Arabic)")}</Label>
          <Textarea id="service-description-ar" value={formData.description_ar} onChange={e => setFormData({ ...formData, description_ar: e.target.value })} rows={3} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="service-description-en">{t("الوصف (إنجليزي)", "Description (English)")}</Label>
          <Textarea id="service-description-en" value={formData.description_en} onChange={e => setFormData({ ...formData, description_en: e.target.value })} rows={3} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="service-category">{t("التصنيف", "Category")} *</Label>
          <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
            <SelectTrigger id="service-category"><SelectValue placeholder={t("اختر التصنيف", "Select category")} /></SelectTrigger>
            <SelectContent>{categories.map(c => <SelectItem key={c.value} value={c.value}>{language === "ar" ? c.label_ar : c.label_en}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="service-price-type">{t("نوع التسعير", "Pricing Type")}</Label>
          <Select value={formData.price_type} onValueChange={v => setFormData({ ...formData, price_type: v })}>
            <SelectTrigger id="service-price-type"><SelectValue /></SelectTrigger>
            <SelectContent>{priceTypes.map(p => <SelectItem key={p.value} value={p.value}>{language === "ar" ? p.label_ar : p.label_en}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="service-price">{t("السعر (ر.س)", "Price (SAR)")} *</Label>
          <Input id="service-price" type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} placeholder="0" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="service-delivery-time">{t("وقت التسليم", "Delivery Time")}</Label>
          <Input id="service-delivery-time" value={formData.delivery_time} onChange={e => setFormData({ ...formData, delivery_time: e.target.value })} placeholder={t("مثال: 3-5 أيام", "e.g., 3-5 days")} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="service-feature">{t("المميزات المتضمنة", "Included Features")}</Label>
        <div className="flex gap-2">
          <Input id="service-feature" value={featureInput} onChange={e => setFeatureInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addFeature())} placeholder={t("أضف ميزة واضغط Enter", "Add feature and press Enter")} />
          <Button type="button" onClick={addFeature} size="icon" variant="outline" aria-label={t("إضافة ميزة", "Add feature")}><Plus className="h-4 w-4" /></Button>
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
        <Label htmlFor="service-images">{t("صور الخدمة", "Service Images")}{!isEdit && " *"} <span className="text-muted-foreground text-xs ms-1">({existingImageUrls.length + imagePreviews.length}/10)</span></Label>
        {existingImageUrls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {existingImageUrls.map((url, i) => (
              <div key={i} className="relative h-20 w-24 rounded-lg overflow-hidden border group">
                <NextImage src={url} alt="" width={96} height={80} className="w-full h-full object-cover" />
                <button type="button" aria-label={t("إزالة الصورة", "Remove image")} onClick={() => setExistingImageUrls(p => p.filter((_, j) => j !== i))} className="absolute top-1 end-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        {imagePreviews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {imagePreviews.map((src, i) => (
              <div key={i} className="relative h-20 w-24 rounded-lg overflow-hidden border group">
                <NextImage src={src} alt="" width={96} height={80} className="w-full h-full object-cover" unoptimized />
                <button type="button" aria-label={t("إزالة الصورة", "Remove image")} onClick={() => removeNewImage(i)} className="absolute top-1 end-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        {existingImageUrls.length + imagePreviews.length < 10 && (
          <div>
            <input ref={imageInputRef} id="service-images" type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
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

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center" role="alert">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
            <h1 className="text-xl font-semibold">{t("تعذر تحميل خدماتك","Could not load your services")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
            <Button className="mt-4" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t("إعادة المحاولة","Retry")}</Button>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">

        {pendingImageCleanupCount>0&&<div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" role="status"><span>{t(`هناك ${pendingImageCleanupCount} ملفات صور بانتظار إعادة التنظيف`,`${pendingImageCleanupCount} image files are waiting for cleanup retry`)}</span><Button variant="outline" size="sm" onClick={()=>void retryImageCleanup()} disabled={isUploadingImages}>{isUploadingImages?t("جاري التنظيف...","Cleaning..."):t("إعادة محاولة التنظيف","Retry Cleanup")}</Button></div>}

        {/* ── Page header ── */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t("خدماتي", "My Services")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {services.length} / {serviceTotal} {t("خدمة", "services")}
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowCreateDialog(true) }}>
            <Plus className="h-4 w-4 me-2" />
            {t("إضافة خدمة", "Add Service")}
          </Button>
        </div>

        {(serviceTotal > 0 || search) && (
          <>
            {/* ── Search + Sort bar ── */}
            <div className="flex flex-wrap gap-3 mb-6">
              {/* search */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t("ابحث عن خدمة...", "Search services...")}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="ps-9"
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
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("مسح الفلاتر", "Clear filters")} onClick={() => { setSearch(""); setSortField("created_at"); setSortDir("desc") }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Empty states ── */}
        {servicesLoading&&services.length===0 ? (
          <div className="flex h-56 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent"/></div>
        ) : services.length === 0&&!search ? (
          <div className="text-center py-24 text-muted-foreground">
            <Briefcase className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <h3 className="text-xl font-semibold mb-2 text-foreground">{t("لا توجد خدمات بعد", "No Services Yet")}</h3>
            <p className="mb-6">{t("ابدأ بإضافة خدمتك الأولى", "Start by adding your first service")}</p>
            <Button onClick={() => { resetForm(); setShowCreateDialog(true) }}>
              <Plus className="h-4 w-4 me-2" />{t("إضافة خدمة جديدة", "Add New Service")}
            </Button>
          </div>
        ) : services.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>{t("لا توجد نتائج مطابقة", "No matching services")}</p>
            <Button variant="link" size="sm" onClick={() => setSearch("")}>
              {t("مسح البحث", "Clear search")}
            </Button>
          </div>
        ) : (
          <>
            {/* ── Fixed 3-column grid ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map(service => {
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
                          {getModerationLabel(service)}
                        </span>
                      </div>

                      {/* category */}
                      <Badge variant="secondary" className="text-xs">{getCategoryLabel(service.category)}</Badge>

                      {/* description */}
                      {desc && <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">{desc}</p>}
                      {service.moderation_note && (
                        <p className="text-xs text-destructive rounded-md bg-destructive/10 p-2">
                          {service.moderation_note}
                        </p>
                      )}

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
                        {service.moderation_status === "approved" && (
                          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => handlePublishIntent(service)}>
                            {service.is_active ? t("إيقاف", "Pause") : t("نشر", "Publish")}
                          </Button>
                        )}
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
            {serviceCursor&&services.length<serviceTotal && (
              <div className="text-center mt-8">
                <Button
                  variant="outline"
                  size="lg"
                  className="min-w-[200px]"
                  onClick={() => void fetchServices(serviceCursor,true)}
                  disabled={loadingMoreServices}
                >
                  {loadingMoreServices?t("جاري التحميل...","Loading..."):t("تحميل المزيد", "Load More")}
                  <span className="text-muted-foreground text-xs me-2">
                    ({services.length} / {serviceTotal})
                  </span>
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      <Footer />

      {/* ── Create Dialog ── */}
      <Dialog open={showCreateDialog} onOpenChange={(open)=>{if(!open&&isSaving)return;if(!open)resetForm();setShowCreateDialog(open)}}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("إضافة خدمة جديدة", "Add New Service")}</DialogTitle>
            <DialogDescription>{t("أدخل تفاصيل الخدمة التي تريد تقديمها", "Enter the details of the service you want to offer")}</DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => {resetForm();setShowCreateDialog(false)}} disabled={isSaving}>{t("إلغاء", "Cancel")}</Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white me-2" />{isUploadingImages ? t("جاري رفع الصور...", "Uploading...") : t("جاري الحفظ...", "Saving...")}</> : <><Save className="h-4 w-4 me-2" />{t("حفظ", "Save")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={showEditDialog} onOpenChange={(open)=>{if(!open&&isSaving)return;if(!open){resetForm();setSelectedService(null)}setShowEditDialog(open)}}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("تعديل الخدمة", "Edit Service")}</DialogTitle>
            <DialogDescription>{t("قم بتحديث تفاصيل خدمتك", "Update your service details")}</DialogDescription>
          </DialogHeader>
          {renderFormFields(true)}
          <DialogFooter>
            <Button variant="outline" onClick={() => {resetForm();setSelectedService(null);setShowEditDialog(false)}} disabled={isSaving}>{t("إلغاء", "Cancel")}</Button>
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
      <Dialog open={showReviewsDialog} onOpenChange={(open)=>{setShowReviewsDialog(open);if(!open){setReviewLoadError(null);setReviewCursor(null)}}}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("تقييمات الخدمة", "Service Reviews")}: {selectedService ? (language === "ar" ? selectedService.name_ar : selectedService.name_en) : ""} <span className="text-sm font-normal text-muted-foreground">({reviewsList.length}/{reviewTotal})</span></DialogTitle>
          </DialogHeader>
          {isLoadingReviews ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
          ) : reviewLoadError&&reviewsList.length===0 ? (
            <LoadErrorCard title={t("تعذر تحميل التقييمات","Could not load reviews")} description={reviewLoadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>selectedService&&void loadServiceReviews(selectedService)} />
          ) : reviewsList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>{t("لا توجد تقييمات حتى الآن", "No reviews yet")}</p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {reviewLoadError&&<LoadErrorCard title={t("تعذر تحديث التقييمات","Could not refresh reviews")} description={reviewLoadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>selectedService&&void loadServiceReviews(selectedService)} />}
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
              {selectedService&&reviewCursor&&reviewsList.length<reviewTotal&&<Button className="w-full" variant="outline" onClick={()=>void loadServiceReviews(selectedService,reviewCursor,true)} disabled={loadingMoreReviews}>{loadingMoreReviews?t("جاري التحميل...","Loading..."):t("تحميل تقييمات أقدم","Load Older Reviews")}</Button>}
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
