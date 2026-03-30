"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useLanguage } from "@/components/language-provider"
import { Plus, Edit2, Trash2, Save, Briefcase, Clock, DollarSign, Star, MessageCircle } from "lucide-react"
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  const [user, setUser] = useState<any>(null)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [featureInput, setFeatureInput] = useState("")

  const [showReviewsDialog, setShowReviewsDialog] = useState(false)
  const [reviewsList, setReviewsList] = useState<ProviderReview[]>([])
  const [isLoadingReviews, setIsLoadingReviews] = useState(false)

  const [formData, setFormData] = useState({
    name_ar: "",
    name_en: "",
    description_ar: "",
    description_en: "",
    category: "",
    price: "",
    price_type: "fixed",
    delivery_time: "",
    features: [] as string[],
  })

  useEffect(() => {
    checkAuthAndFetchServices()
  }, [])

  const checkAuthAndFetchServices = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push("/auth/login")
      return
    }

    // Check if user is a provider
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profile?.role !== "provider") {
      toast({
        title: t("غير مسموح", "Not Allowed"),
        description: t("هذه الصفحة لمقدمي الخدمات فقط", "This page is for providers only"),
        variant: "destructive",
      })
      router.push("/")
      return
    }

    // Get provider ID
    const { data: provider } = await supabase
      .from("providers")
      .select("id")
      .eq("user_id", user.id)
      .single()

    if (!provider) {
      toast({
        title: t("خطأ", "Error"),
        description: t("لم يتم العثور على ملف مقدم الخدمة", "Provider profile not found"),
        variant: "destructive",
      })
      router.push("/register/provider")
      return
    }

    setUser(user)
    setProviderId(provider.id)
    await fetchServices(provider.id)
    setIsLoading(false)
  }

  const fetchServices = async (provId: string) => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("provider_id", provId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching services:", error)
      return
    }

    setServices(data || [])
  }

  const resetForm = () => {
    setFormData({
      name_ar: "",
      name_en: "",
      description_ar: "",
      description_en: "",
      category: "",
      price: "",
      price_type: "fixed",
      delivery_time: "",
      features: [],
    })
    setFeatureInput("")
  }

  const addFeature = () => {
    if (featureInput.trim() && !formData.features.includes(featureInput.trim())) {
      setFormData({ ...formData, features: [...formData.features, featureInput.trim()] })
      setFeatureInput("")
    }
  }

  const removeFeature = (feature: string) => {
    setFormData({ ...formData, features: formData.features.filter((f) => f !== feature) })
  }

  const handleCreate = async () => {
    if (!providerId) return

    if (!formData.name_ar || !formData.name_en || !formData.category || !formData.price) {
      toast({
        title: t("خطأ", "Error"),
        description: t("يرجى ملء الحقول المطلوبة", "Please fill in required fields"),
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)
    const supabase = createClient()

    const { error } = await supabase.from("services").insert({
      provider_id: providerId,
      name_ar: formData.name_ar,
      name_en: formData.name_en,
      description_ar: formData.description_ar || null,
      description_en: formData.description_en || null,
      category: formData.category,
      price: parseFloat(formData.price) || 0,
      price_type: formData.price_type,
      delivery_time: formData.delivery_time || null,
      features: formData.features,
      is_active: true,
    })

    setIsSaving(false)

    if (error) {
      console.error("[v0] Error creating service:", error)
      toast({
        title: t("خطأ", "Error"),
        description: t("فشل في إنشاء الخدمة", "Failed to create service"),
        variant: "destructive",
      })
      return
    }

    toast({
      title: t("تم بنجاح", "Success"),
      description: t("تم إنشاء الخدمة بنجاح", "Service created successfully"),
    })

    setShowCreateDialog(false)
    resetForm()
    await fetchServices(providerId)
  }

  const handleEdit = async () => {
    if (!providerId || !selectedService) return

    setIsSaving(true)
    const supabase = createClient()

    const { error } = await supabase
      .from("services")
      .update({
        name_ar: formData.name_ar,
        name_en: formData.name_en,
        description_ar: formData.description_ar || null,
        description_en: formData.description_en || null,
        category: formData.category,
        price: parseFloat(formData.price) || 0,
        price_type: formData.price_type,
        delivery_time: formData.delivery_time || null,
        features: formData.features,
      })
      .eq("id", selectedService.id)

    setIsSaving(false)

    if (error) {
      toast({
        title: t("خطأ", "Error"),
        description: t("فشل في تحديث الخدمة", "Failed to update service"),
        variant: "destructive",
      })
      return
    }

    toast({
      title: t("تم بنجاح", "Success"),
      description: t("تم تحديث الخدمة بنجاح", "Service updated successfully"),
    })

    setShowEditDialog(false)
    setSelectedService(null)
    resetForm()
    await fetchServices(providerId)
  }

  const handleDelete = async () => {
    if (!providerId || !selectedService) return

    const supabase = createClient()

    const { error } = await supabase
      .from("services")
      .delete()
      .eq("id", selectedService.id)

    if (error) {
      toast({
        title: t("خطأ", "Error"),
        description: t("فشل في حذف الخدمة", "Failed to delete service"),
        variant: "destructive",
      })
      return
    }

    toast({
      title: t("تم بنجاح", "Success"),
      description: t("تم حذف الخدمة بنجاح", "Service deleted successfully"),
    })

    setShowDeleteDialog(false)
    setSelectedService(null)
    await fetchServices(providerId)
  }

  const confirmDelete = async () => {
    if (!selectedService) return

    setIsSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from("services").delete().eq("id", selectedService.id)

    if (error) {
      toast({
        title: t("خطأ", "Error"),
        description: error.message,
        variant: "destructive",
      })
    } else {
      toast({
        title: t("تم بنجاح", "Success"),
        description: t("تم حذف الخدمة", "Service deleted successfully"),
      })
      fetchServices(providerId!)
    }

    setShowDeleteDialog(false)
    setIsSaving(false)
  }

  const handleViewReviews = async (service: Service) => {
    setSelectedService(service)
    setShowReviewsDialog(true)
    setIsLoadingReviews(true)
    const supabase = createClient()
    
    const { data } = await supabase
      .from("reviews")
      .select(`
        id, rating, comment, created_at,
        profiles!reviewer_id(full_name, avatar_url)
      `)
      .eq("service_id", service.id)
      .order("created_at", { ascending: false })
      
    setReviewsList(data || [])
    setIsLoadingReviews(false)
  }

  const openEditDialog = (service: Service) => {
    setSelectedService(service)
    setFormData({
      name_ar: service.name_ar || "",
      name_en: service.name_en || "",
      description_ar: service.description_ar || "",
      description_en: service.description_en || "",
      category: service.category || "",
      price: service.price?.toString() || "",
      price_type: service.price_type || "fixed",
      delivery_time: service.delivery_time || "",
      features: service.features || [],
    })
    setShowEditDialog(true)
  }

  const openDeleteDialog = (service: Service) => {
    setSelectedService(service)
    setShowDeleteDialog(true)
  }

  const getCategoryLabel = (value: string) => {
    const cat = categories.find(c => c.value === value)
    return cat ? (language === "ar" ? cat.label_ar : cat.label_en) : value
  }

  const getPriceTypeLabel = (value: string) => {
    const pt = priceTypes.find(p => p.value === value)
    return pt ? (language === "ar" ? pt.label_ar : pt.label_en) : value
  }

  // Shared form fields for create/edit dialogs
  const renderFormFields = () => (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("اسم الخدمة (عربي)", "Service Name (Arabic)")} *</Label>
          <Input
            value={formData.name_ar}
            onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
            placeholder={t("مثال: تصميم شعار احترافي", "e.g., Professional Logo Design")}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("اسم الخدمة (إنجليزي)", "Service Name (English)")} *</Label>
          <Input
            value={formData.name_en}
            onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
            placeholder="e.g., Professional Logo Design"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("الوصف (عربي)", "Description (Arabic)")}</Label>
          <Textarea
            value={formData.description_ar}
            onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })}
            placeholder={t("وصف تفصيلي لخدمتك", "Detailed description of your service")}
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("الوصف (إنجليزي)", "Description (English)")}</Label>
          <Textarea
            value={formData.description_en}
            onChange={(e) => setFormData({ ...formData, description_en: e.target.value })}
            placeholder="Detailed description of your service"
            rows={3}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("التصنيف", "Category")} *</Label>
          <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
            <SelectTrigger>
              <SelectValue placeholder={t("اختر التصنيف", "Select category")} />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {language === "ar" ? cat.label_ar : cat.label_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("نوع التسعير", "Pricing Type")}</Label>
          <Select value={formData.price_type} onValueChange={(v) => setFormData({ ...formData, price_type: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priceTypes.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>
                  {language === "ar" ? pt.label_ar : pt.label_en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("السعر (ر.س)", "Price (SAR)")} *</Label>
          <Input
            type="number"
            value={formData.price}
            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label>{t("وقت التسليم", "Delivery Time")}</Label>
          <Input
            value={formData.delivery_time}
            onChange={(e) => setFormData({ ...formData, delivery_time: e.target.value })}
            placeholder={t("مثال: 3-5 أيام", "e.g., 3-5 days")}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t("المميزات المتضمنة", "Included Features")}</Label>
        <div className="flex gap-2">
          <Input
            value={featureInput}
            onChange={(e) => setFeatureInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFeature())}
            placeholder={t("مثال: مراجعتان مجانيتان", "e.g., 2 free revisions")}
          />
          <Button type="button" onClick={addFeature} size="icon" variant="outline">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {formData.features.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {formData.features.map((feature, idx) => (
              <Badge key={idx} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeFeature(feature)}>
                {feature}
                <span className="text-destructive">×</span>
              </Badge>
            ))}
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">{t("خدماتي", "My Services")}</h1>
            <p className="text-muted-foreground mt-2">
              {t("إدارة الخدمات التي تقدمها", "Manage the services you offer")}
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowCreateDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t("إضافة خدمة جديدة", "Add New Service")}
          </Button>
        </div>

        {services.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Briefcase className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">
                {t("لا توجد خدمات بعد", "No Services Yet")}
              </h3>
              <p className="text-muted-foreground mb-6">
                {t("ابدأ بإضافة خدمتك الأولى للعملاء", "Start by adding your first service for clients")}
              </p>
              <Button onClick={() => { resetForm(); setShowCreateDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                {t("إضافة خدمة جديدة", "Add New Service")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <Card key={service.id} className="relative">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">
                        {language === "ar" ? service.name_ar : service.name_en}
                      </CardTitle>
                      <Badge variant="secondary" className="mt-2 text-xs">{getCategoryLabel(service.category)}</Badge>
                    </div>
                    <div className={`px-2 py-1 rounded-full text-xs ${
                      service.is_active
                        ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                        : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    }`}>
                      {service.is_active ? t("نشط", "Active") : t("غير نشط", "Inactive")}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                    {language === "ar" ? service.description_ar : service.description_en}
                  </p>
                  <div className="flex items-center gap-4 text-sm mb-4">
                    <div className="flex items-center gap-1">
                      <DollarSign className="h-4 w-4 text-primary" />
                      <span className="font-bold text-primary">{service.price} {t("ر.س", "SAR")}</span>
                      <span className="text-xs text-muted-foreground">({getPriceTypeLabel(service.price_type)})</span>
                    </div>
                  </div>
                  {service.delivery_time && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{service.delivery_time}</span>
                    </div>
                  )}
                  {service.features && service.features.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {service.features.slice(0, 3).map((f, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">{f}</Badge>
                      ))}
                      {service.features.length > 3 && (
                        <Badge variant="outline" className="text-xs">+{service.features.length - 3}</Badge>
                      )}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => handleViewReviews(service)}>
                      <MessageCircle className="h-4 w-4 text-primary" />
                      {t("عرض التقييمات", "View Reviews")}
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => openEditDialog(service)}>
                        <Edit2 className="h-4 w-4 mr-2" />
                        {t("تعديل", "Edit")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => openDeleteDialog(service)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("إضافة خدمة جديدة", "Add New Service")}</DialogTitle>
            <DialogDescription>
              {t("أدخل تفاصيل الخدمة التي تريد تقديمها", "Enter the details of the service you want to offer")}
            </DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t("إلغاء", "Cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {t("حفظ", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("تعديل الخدمة", "Edit Service")}</DialogTitle>
            <DialogDescription>
              {t("قم بتحديث تفاصيل خدمتك", "Update your service details")}
            </DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              {t("إلغاء", "Cancel")}
            </Button>
            <Button onClick={handleEdit} disabled={isSaving}>
              {isSaving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {t("حفظ التغييرات", "Save Changes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("حذف الخدمة", "Delete Service")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "هل أنت متأكد من حذف هذه الخدمة؟ لا يمكن التراجع عن هذا الإجراء.",
                "Are you sure you want to delete this service? This action cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              {t("حذف", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Reviews Dialog */}
      <Dialog open={showReviewsDialog} onOpenChange={setShowReviewsDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("تقييمات الخدمة: ", "Reviews for: ")} 
              {selectedService ? (language === "ar" ? selectedService.name_ar : selectedService.name_en) : ""}
            </DialogTitle>
            <DialogDescription>
              {t("جميع التقييمات التي تلقيتها لهذه الخدمة", "All reviews you have received for this service")}
            </DialogDescription>
          </DialogHeader>

          {isLoadingReviews ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : reviewsList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>{t("لا توجد تقييمات حتى الآن", "No reviews yet")}</p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {reviewsList.map((review) => (
                <div key={review.id} className="bg-muted/30 p-4 rounded-lg border">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-secondary overflow-hidden flex-shrink-0">
                        {review.profiles?.avatar_url ? (
                          <img src={review.profiles.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-sm font-bold">
                            {review.profiles?.full_name?.charAt(0) || "?"}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{review.profiles?.full_name || t("مستخدم", "User")}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(review.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center bg-background px-2 py-1 rounded-full border shadow-sm flex-shrink-0">
                      <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400 mr-1" />
                      <span className="text-xs font-bold">{review.rating}</span>
                    </div>
                  </div>
                  {review.comment && (
                    <p className="text-sm mt-3 pt-3 border-t text-foreground/90 leading-relaxed">
                      "{review.comment}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewsDialog(false)}>
              {t("إغلاق", "Close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
