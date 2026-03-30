"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { User, Briefcase, DollarSign, Tag, X, Plus, ArrowRight, CheckCircle2 } from "lucide-react"

export default function BecomeProviderPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(1)

  // Form state
  const [formData, setFormData] = useState({
    name_ar: "",
    name_en: "",
    title_ar: "",
    title_en: "",
    bio_ar: "",
    bio_en: "",
    starting_price: "",
    avatar_url: "",
  })

  const [skills, setSkills] = useState<string[]>([])
  const [skillInput, setSkillInput] = useState("")
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])

  const categories = [
    { id: "تطوير", nameAr: "تطوير", nameEn: "Development" },
    { id: "تصميم", nameAr: "تصميم", nameEn: "Design" },
    { id: "تسويق", nameAr: "تسويق", nameEn: "Marketing" },
    { id: "كتابة", nameAr: "كتابة", nameEn: "Writing" },
    { id: "تصوير", nameAr: "تصوير", nameEn: "Photography" },
    { id: "استشارات", nameAr: "استشارات", nameEn: "Consulting" },
    { id: "برمجة", nameAr: "برمجة", nameEn: "Programming" },
    { id: "إبداع", nameAr: "إبداع", nameEn: "Creative" },
  ]

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/signup")
        return
      }

      // Check if user is already a provider
      const { data: existingProvider } = await supabase
        .from("providers")
        .select("id")
        .eq("user_id", user.id)
        .single()

      if (existingProvider) {
        // User is already a provider, redirect to dashboard
        toast({
          title: t("أنت مقدم خدمة بالفعل", "You are already a provider"),
          description: t("يمكنك إدارة خدماتك من لوحة التحكم", "You can manage your services from the dashboard"),
        })
        router.push("/dashboard")
        return
      }

      // Check user's role - seeker users cannot become providers
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()

      // If user is a seeker, they cannot register as a provider
      if (profile?.role === "seeker") {
        toast({
          title: t("غير مسموح", "Not Allowed"),
          description: t(
            "حسابات الباحثين عن خدمات لا يمكنها تقديم خدمات. يرجى إنشاء حساب مقدم خدمة جديد.",
            "Seeker accounts cannot offer services. Please create a new provider account."
          ),
          variant: "destructive",
        })
        router.push("/")
        return
      }

      setUser(user)
      setFormData((prev) => ({
        ...prev,
        name_ar: user.user_metadata?.full_name || "",
        name_en: user.user_metadata?.full_name || "",
      }))
      setLoading(false)
    }

    checkUser()
  }, [router, toast, t])

  const addSkill = () => {
    if (skillInput.trim() && !skills.includes(skillInput.trim())) {
      setSkills([...skills, skillInput.trim()])
      setSkillInput("")
    }
  }

  const removeSkill = (skill: string) => {
    setSkills(skills.filter((s) => s !== skill))
  }

  const toggleCategory = (categoryId: string) => {
    if (selectedCategories.includes(categoryId)) {
      setSelectedCategories(selectedCategories.filter((c) => c !== categoryId))
    } else {
      setSelectedCategories([...selectedCategories, categoryId])
    }
  }

  const handleSubmit = async () => {
    console.log("[v0] Starting provider registration...")
    console.log("[v0] Current user:", user)
    console.log("[v0] Form data:", formData)
    console.log("[v0] Skills:", skills)
    console.log("[v0] Categories:", selectedCategories)

    // Validation
    if (!formData.name_ar || !formData.name_en) {
      console.log("[v0] Validation failed: Missing name")
      toast({
        title: t("خطأ", "Error"),
        description: t("يرجى إدخال الاسم بالعربية والإنجليزية", "Please enter name in both Arabic and English"),
        variant: "destructive",
      })
      return
    }

    if (!formData.title_ar || !formData.title_en) {
      console.log("[v0] Validation failed: Missing title")
      toast({
        title: t("خطأ", "Error"),
        description: t(
          "يرجى إدخال المسمى الوظيفي بالعربية والإنجليزية",
          "Please enter title in both Arabic and English",
        ),
        variant: "destructive",
      })
      return
    }

    if (formData.starting_price) {
      const price = Number.parseFloat(formData.starting_price)
      if (price > 99999999) {
        console.log("[v0] Validation failed: Price too high")
        toast({
          title: t("خطأ", "Error"),
          description: t(
            "السعر الابتدائي لا يمكن أن يتجاوز 99,999,999 ريال",
            "Starting price cannot exceed 99,999,999 SAR",
          ),
          variant: "destructive",
        })
        return
      }
    }

    if (selectedCategories.length === 0) {
      console.log("[v0] Validation failed: No categories selected")
      toast({
        title: t("خطأ", "Error"),
        description: t("يرجى اختيار تصنيف واحد على الأقل", "Please select at least one category"),
        variant: "destructive",
      })
      return
    }

    if (skills.length === 0) {
      console.log("[v0] Validation failed: No skills added")
      toast({
        title: t("خطأ", "Error"),
        description: t("يرجى إضافة مهارة واحدة على الأقل", "Please add at least one skill"),
        variant: "destructive",
      })
      return
    }

    console.log("[v0] All validations passed")

    if (!user || !user.id) {
      console.error("[v0] No user found in state!")
      toast({
        title: t("خطأ", "Error"),
        description: t("يرجى تسجيل الدخول أولاً", "Please login first"),
        variant: "destructive",
      })
      router.push("/auth/login")
      return
    }

    console.log("[v0] User ID:", user.id)
    setSubmitting(true)

    try {
      const supabase = createClient()

      const providerData = {
        user_id: user.id,
        name_ar: formData.name_ar,
        name_en: formData.name_en,
        title_ar: formData.title_ar,
        title_en: formData.title_en,
        bio_ar: formData.bio_ar || null,
        bio_en: formData.bio_en || null,
        avatar_url:
          formData.avatar_url || `/placeholder.svg?height=200&width=200&text=${encodeURIComponent(formData.name_en)}`,
        rating: 5.0,
        reviews_count: 0,
        completed_projects: 0,
        starting_price: Number.parseFloat(formData.starting_price) || null,
        skills: skills,
        categories: selectedCategories,
        is_verified: false,
        display_name: formData.name_en,
        title: formData.title_en,
        bio: formData.bio_en || null,
        category: selectedCategories[0] || "تطوير",
        hourly_rate: Number.parseFloat(formData.starting_price) || 0,
      }

      console.log("[v0] Submitting provider data:", providerData)

      const result = await supabase.from("providers").insert(providerData).select().single()

      console.log("[v0] Insert result:", result)

      if (result.error) {
        console.error("[v0] Error creating provider:", result.error)
        throw result.error
      }

      console.log("[v0] Provider created successfully:", result.data)

      // Update user's profile role to "provider"
      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update({ role: "provider" })
        .eq("id", user.id)

      if (profileUpdateError) {
        console.error("[v0] Error updating profile role:", profileUpdateError)
      } else {
        console.log("[v0] Profile role updated to provider")
      }

      toast({
        title: t("تم بنجاح!", "Success!"),
        description: t("تم إنشاء ملفك كمقدم خدمة بنجاح", "Your provider profile has been created successfully"),
      })

      console.log("[v0] Redirecting to /services/seeker...")
      router.push("/services/seeker")
    } catch (error: any) {
      console.error("[v0] Error:", error)
      toast({
        title: t("حدث خطأ", "Error"),
        description:
          error.message || t("فشل إنشاء الملف، يرجى المحاولة مرة أخرى", "Failed to create profile, please try again"),
        variant: "destructive",
      })
      setSubmitting(false)
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

      <main className="flex-1 bg-muted/30 py-8 md:py-12">
        <div className="container mx-auto px-4 max-w-4xl">
          {/* Progress Steps */}
          <div className="mb-8">
            <div className="flex items-center justify-center gap-4 mb-4">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                      step >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {step > s ? <CheckCircle2 className="h-5 w-5" /> : s}
                  </div>
                  {s < 3 && <div className={`w-16 h-1 mx-2 ${step > s ? "bg-primary" : "bg-muted"}`} />}
                </div>
              ))}
            </div>
            <p className="text-center text-muted-foreground">
              {t("الخطوة", "Step")} {step} {t("من", "of")} 3
            </p>
          </div>

          {/* Step 1: Basic Info */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  {t("المعلومات الأساسية", "Basic Information")}
                </CardTitle>
                <CardDescription>
                  {t("أدخل معلوماتك الشخصية والمهنية", "Enter your personal and professional information")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name_ar">{t("الاسم بالعربية", "Name in Arabic")} *</Label>
                    <Input
                      id="name_ar"
                      value={formData.name_ar}
                      onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                      placeholder={t("أحمد محمد", "Ahmed Mohammed")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name_en">{t("الاسم بالإنجليزية", "Name in English")} *</Label>
                    <Input
                      id="name_en"
                      value={formData.name_en}
                      onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
                      placeholder="Ahmed Mohammed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="title_ar">{t("المسمى الوظيفي بالعربية", "Job Title in Arabic")} *</Label>
                    <Input
                      id="title_ar"
                      value={formData.title_ar}
                      onChange={(e) => setFormData({ ...formData, title_ar: e.target.value })}
                      placeholder={t("مطور ويب متخصص", "Full Stack Web Developer")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="title_en">{t("المسمى الوظيفي بالإنجليزية", "Job Title in English")} *</Label>
                    <Input
                      id="title_en"
                      value={formData.title_en}
                      onChange={(e) => setFormData({ ...formData, title_en: e.target.value })}
                      placeholder="Full Stack Web Developer"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="starting_price">
                    <DollarSign className="h-4 w-4 inline ml-2" />
                    {t("السعر الابتدائي (ريال سعودي)", "Starting Price (SAR)")}
                  </Label>
                  <Input
                    id="starting_price"
                    type="number"
                    min="0"
                    max="99999999"
                    step="0.01"
                    value={formData.starting_price}
                    onChange={(e) => setFormData({ ...formData, starting_price: e.target.value })}
                    placeholder="500"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("الحد الأقصى: 99,999,999 ريال", "Maximum: 99,999,999 SAR")}
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => setStep(2)}>
                    {t("التالي", "Next")}
                    <ArrowRight className="mr-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Services & Skills */}
          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5" />
                  {t("الخدمات والمهارات", "Services & Skills")}
                </CardTitle>
                <CardDescription>
                  {t("حدد تصنيفات خدماتك ومهاراتك", "Specify your service categories and skills")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Label>
                    <Tag className="h-4 w-4 inline ml-2" />
                    {t("التصنيفات", "Categories")} *
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((cat) => (
                      <Badge
                        key={cat.id}
                        variant={selectedCategories.includes(cat.id) ? "default" : "outline"}
                        className="cursor-pointer hover:bg-primary/90"
                        onClick={() => toggleCategory(cat.id)}
                      >
                        {language === "ar" ? cat.nameAr : cat.nameEn}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="skills">{t("المهارات", "Skills")} *</Label>
                  <div className="flex gap-2">
                    <Input
                      id="skills"
                      value={skillInput}
                      onChange={(e) => setSkillInput(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())}
                      placeholder={t("مثال: React، تصميم UI/UX", "Example: React, UI/UX Design")}
                    />
                    <Button type="button" onClick={addSkill} size="icon" variant="outline">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {skills.map((skill, idx) => (
                      <Badge key={idx} variant="secondary" className="gap-1">
                        {skill}
                        <X
                          className="h-3 w-3 cursor-pointer hover:text-destructive"
                          onClick={() => removeSkill(skill)}
                        />
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    {t("السابق", "Previous")}
                  </Button>
                  <Button onClick={() => setStep(3)}>
                    {t("التالي", "Next")}
                    <ArrowRight className="mr-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Bio */}
          {step === 3 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("نبذة عنك", "About You")}</CardTitle>
                <CardDescription>
                  {t("أخبر العملاء المحتملين عن خبراتك", "Tell potential clients about your experience")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="bio_ar">{t("النبذة بالعربية", "Bio in Arabic")}</Label>
                  <Textarea
                    id="bio_ar"
                    value={formData.bio_ar}
                    onChange={(e) => setFormData({ ...formData, bio_ar: e.target.value })}
                    placeholder={t(
                      "اكتب نبذة مختصرة عن خبراتك ومهاراتك...",
                      "Write a brief description about your experience and skills...",
                    )}
                    rows={4}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bio_en">{t("النبذة بالإنجليزية", "Bio in English")}</Label>
                  <Textarea
                    id="bio_en"
                    value={formData.bio_en}
                    onChange={(e) => setFormData({ ...formData, bio_en: e.target.value })}
                    placeholder="Write a brief description about your experience and skills..."
                    rows={4}
                  />
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    {t("السابق", "Previous")}
                  </Button>
                  <Button onClick={handleSubmit} disabled={submitting} size="lg" className="bg-primary">
                    {submitting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white ml-2"></div>
                        {t("جاري الإنشاء...", "Creating...")}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="ml-2 h-5 w-5" />
                        {t("إنشاء الخدمة", "Create Service")}
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
