"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useLanguage } from "@/components/language-provider"
import { Plus, Edit2, Trash2, Save, X, Briefcase } from "lucide-react"
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
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
  title_ar: string
  title_en: string
  bio_ar: string
  bio_en: string
  category: string
  starting_price: number
  hourly_rate: number
  is_active: boolean
  created_at: string
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

export default function MyServicesPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [user, setUser] = useState<any>(null)
  const [services, setServices] = useState<Service[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  
  const [formData, setFormData] = useState({
    name_ar: "",
    name_en: "",
    title_ar: "",
    title_en: "",
    bio_ar: "",
    bio_en: "",
    category: "",
    starting_price: "",
    hourly_rate: "",
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

    setUser(user)
    await fetchServices(user.id)
    setIsLoading(false)
  }

  const fetchServices = async (userId: string) => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .eq("user_id", userId)
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
      title_ar: "",
      title_en: "",
      bio_ar: "",
      bio_en: "",
      category: "",
      starting_price: "",
      hourly_rate: "",
    })
  }

  const handleCreate = async () => {
    if (!user) return

    setIsSaving(true)
    const supabase = createClient()

    const { error } = await supabase.from("providers").insert({
      user_id: user.id,
      name_ar: formData.name_ar,
      name_en: formData.name_en,
      title_ar: formData.title_ar,
      title_en: formData.title_en,
      bio_ar: formData.bio_ar,
      bio_en: formData.bio_en,
      category: formData.category,
      starting_price: parseFloat(formData.starting_price) || 0,
      hourly_rate: parseFloat(formData.hourly_rate) || 0,
      is_active: true,
    })

    setIsSaving(false)

    if (error) {
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
    await fetchServices(user.id)
  }

  const handleEdit = async () => {
    if (!user || !selectedService) return

    setIsSaving(true)
    const supabase = createClient()

    const { error } = await supabase
      .from("providers")
      .update({
        name_ar: formData.name_ar,
        name_en: formData.name_en,
        title_ar: formData.title_ar,
        title_en: formData.title_en,
        bio_ar: formData.bio_ar,
        bio_en: formData.bio_en,
        category: formData.category,
        starting_price: parseFloat(formData.starting_price) || 0,
        hourly_rate: parseFloat(formData.hourly_rate) || 0,
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
    await fetchServices(user.id)
  }

  const handleDelete = async () => {
    if (!user || !selectedService) return

    const supabase = createClient()

    const { error } = await supabase
      .from("providers")
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
    await fetchServices(user.id)
  }

  const openEditDialog = (service: Service) => {
    setSelectedService(service)
    setFormData({
      name_ar: service.name_ar || "",
      name_en: service.name_en || "",
      title_ar: service.title_ar || "",
      title_en: service.title_en || "",
      bio_ar: service.bio_ar || "",
      bio_en: service.bio_en || "",
      category: service.category || "",
      starting_price: service.starting_price?.toString() || "",
      hourly_rate: service.hourly_rate?.toString() || "",
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
                    <div>
                      <CardTitle className="text-lg">
                        {language === "ar" ? service.title_ar : service.title_en}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {language === "ar" ? service.name_ar : service.name_en}
                      </p>
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
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                    {language === "ar" ? service.bio_ar : service.bio_en}
                  </p>
                  <div className="flex items-center gap-4 text-sm mb-4">
                    <span className="text-muted-foreground">
                      {t("التصنيف:", "Category:")} {getCategoryLabel(service.category)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm mb-4">
                    {service.starting_price > 0 && (
                      <span>
                        {t("يبدأ من:", "Starting:")} ${service.starting_price}
                      </span>
                    )}
                    {service.hourly_rate > 0 && (
                      <span>
                        {t("بالساعة:", "Hourly:")} ${service.hourly_rate}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => openEditDialog(service)}
                    >
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />

      {/* Create Service Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("إضافة خدمة جديدة", "Add New Service")}</DialogTitle>
            <DialogDescription>
              {t("أدخل تفاصيل الخدمة التي تريد تقديمها", "Enter the details of the service you want to offer")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("الاسم (عربي)", "Name (Arabic)")}</Label>
                <Input
                  value={formData.name_ar}
                  onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                  placeholder={t("اسمك بالعربية", "Your name in Arabic")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("الاسم (إنجليزي)", "Name (English)")}</Label>
                <Input
                  value={formData.name_en}
                  onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
                  placeholder="Your name in English"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("العنوان (عربي)", "Title (Arabic)")}</Label>
                <Input
                  value={formData.title_ar}
                  onChange={(e) => setFormData({ ...formData, title_ar: e.target.value })}
                  placeholder={t("مثال: مطور ويب", "e.g., Web Developer")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("العنوان (إنجليزي)", "Title (English)")}</Label>
                <Input
                  value={formData.title_en}
                  onChange={(e) => setFormData({ ...formData, title_en: e.target.value })}
                  placeholder="e.g., Web Developer"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("التصنيف", "Category")}</Label>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("الوصف (عربي)", "Description (Arabic)")}</Label>
                <Textarea
                  value={formData.bio_ar}
                  onChange={(e) => setFormData({ ...formData, bio_ar: e.target.value })}
                  placeholder={t("وصف خدماتك بالعربية", "Describe your services in Arabic")}
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("الوصف (إنجليزي)", "Description (English)")}</Label>
                <Textarea
                  value={formData.bio_en}
                  onChange={(e) => setFormData({ ...formData, bio_en: e.target.value })}
                  placeholder="Describe your services in English"
                  rows={4}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("السعر الابتدائي ($)", "Starting Price ($)")}</Label>
                <Input
                  type="number"
                  value={formData.starting_price}
                  onChange={(e) => setFormData({ ...formData, starting_price: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("السعر بالساعة ($)", "Hourly Rate ($)")}</Label>
                <Input
                  type="number"
                  value={formData.hourly_rate}
                  onChange={(e) => setFormData({ ...formData, hourly_rate: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
          </div>
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

      {/* Edit Service Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("تعديل الخدمة", "Edit Service")}</DialogTitle>
            <DialogDescription>
              {t("قم بتحديث تفاصيل خدمتك", "Update your service details")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("الاسم (عربي)", "Name (Arabic)")}</Label>
                <Input
                  value={formData.name_ar}
                  onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("الاسم (إنجليزي)", "Name (English)")}</Label>
                <Input
                  value={formData.name_en}
                  onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("العنوان (عربي)", "Title (Arabic)")}</Label>
                <Input
                  value={formData.title_ar}
                  onChange={(e) => setFormData({ ...formData, title_ar: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("العنوان (إنجليزي)", "Title (English)")}</Label>
                <Input
                  value={formData.title_en}
                  onChange={(e) => setFormData({ ...formData, title_en: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("التصنيف", "Category")}</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                <SelectTrigger>
                  <SelectValue />
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("الوصف (عربي)", "Description (Arabic)")}</Label>
                <Textarea
                  value={formData.bio_ar}
                  onChange={(e) => setFormData({ ...formData, bio_ar: e.target.value })}
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("الوصف (إنجليزي)", "Description (English)")}</Label>
                <Textarea
                  value={formData.bio_en}
                  onChange={(e) => setFormData({ ...formData, bio_en: e.target.value })}
                  rows={4}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("السعر الابتدائي ($)", "Starting Price ($)")}</Label>
                <Input
                  type="number"
                  value={formData.starting_price}
                  onChange={(e) => setFormData({ ...formData, starting_price: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("السعر بالساعة ($)", "Hourly Rate ($)")}</Label>
                <Input
                  type="number"
                  value={formData.hourly_rate}
                  onChange={(e) => setFormData({ ...formData, hourly_rate: e.target.value })}
                />
              </div>
            </div>
          </div>
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

      {/* Delete Confirmation Dialog */}
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
    </div>
  )
}
