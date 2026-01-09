"use client"

import { useEffect, useState } from "react"
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { User, Mail, Phone, MapPin, Briefcase, Save, Camera } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Profile {
  full_name: string
  email: string
  phone?: string
  location?: string
  bio?: string
  avatar_url?: string
  user_type?: "seeker" | "provider"
}

export default function ProfilePage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<Profile>({
    full_name: "",
    email: "",
    phone: "",
    location: "",
    bio: "",
    avatar_url: "",
    user_type: "seeker",
  })

  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      setUser(user)
      setProfile({
        full_name: user.user_metadata?.full_name || "",
        email: user.email || "",
        phone: "",
        location: "",
        bio: "",
        avatar_url: "",
        user_type: user.user_metadata?.role || "seeker",
      })
      setLoading(false)
    }

    loadProfile()
  }, [router])

  const handleSave = async () => {
    setSaving(true)
    try {
      // Here you would update the profile in Supabase
      // await supabase.from('profiles').upsert({ ...profile, id: user.id })

      toast({
        title: t("تم الحفظ بنجاح", "Saved successfully"),
        description: t("تم تحديث معلومات الملف الشخصي", "Profile information has been updated"),
      })
    } catch (error) {
      toast({
        title: t("حدث خطأ", "Error"),
        description: t("فشل حفظ التغييرات", "Failed to save changes"),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
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
        <div className="container mx-auto px-4 max-w-4xl">
          {/* Profile Header */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="relative">
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={profile.avatar_url || "/placeholder.svg"} />
                    <AvatarFallback className="text-2xl">
                      {profile.full_name?.charAt(0) || profile.email?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <Button size="icon" variant="secondary" className="absolute bottom-0 right-0 h-8 w-8 rounded-full">
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 text-center md:text-right">
                  <h1 className="text-2xl font-bold mb-1">{profile.full_name || profile.email}</h1>
                  <p className="text-muted-foreground mb-2">{profile.email}</p>
                  <Badge variant="secondary">
                    {profile.user_type === "provider"
                      ? t("مقدم خدمات", "Service Provider")
                      : t("باحث عن خدمات", "Service Seeker")}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Profile Tabs */}
          <Tabs defaultValue="personal" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="personal">{t("المعلومات الشخصية", "Personal Info")}</TabsTrigger>
              <TabsTrigger value="security">{t("الأمان", "Security")}</TabsTrigger>
            </TabsList>

            <TabsContent value="personal">
              <Card>
                <CardHeader>
                  <CardTitle>{t("المعلومات الشخصية", "Personal Information")}</CardTitle>
                  <CardDescription>
                    {t("قم بتحديث معلوماتك الشخصية", "Update your personal information")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="full_name">
                        <User className="h-4 w-4 inline ml-2" />
                        {t("الاسم الكامل", "Full Name")}
                      </Label>
                      <Input
                        id="full_name"
                        value={profile.full_name}
                        onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                        placeholder={t("أدخل اسمك الكامل", "Enter your full name")}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">
                        <Mail className="h-4 w-4 inline ml-2" />
                        {t("البريد الإلكتروني", "Email")}
                      </Label>
                      <Input id="email" value={profile.email} disabled className="bg-muted" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="phone">
                        <Phone className="h-4 w-4 inline ml-2" />
                        {t("رقم الهاتف", "Phone Number")}
                      </Label>
                      <Input
                        id="phone"
                        value={profile.phone}
                        onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                        placeholder={t("05XXXXXXXX", "05XXXXXXXX")}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="location">
                        <MapPin className="h-4 w-4 inline ml-2" />
                        {t("الموقع", "Location")}
                      </Label>
                      <Input
                        id="location"
                        value={profile.location}
                        onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                        placeholder={t("مدينتك", "Your city")}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio">
                      <Briefcase className="h-4 w-4 inline ml-2" />
                      {t("نبذة عني", "About Me")}
                    </Label>
                    <Textarea
                      id="bio"
                      value={profile.bio}
                      onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                      placeholder={t("أخبرنا عن نفسك...", "Tell us about yourself...")}
                      rows={4}
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <Button variant="outline" onClick={() => router.push("/dashboard")}>
                      {t("إلغاء", "Cancel")}
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                      <Save className="h-4 w-4 ml-2" />
                      {saving ? t("جاري الحفظ...", "Saving...") : t("حفظ التغييرات", "Save Changes")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security">
              <Card>
                <CardHeader>
                  <CardTitle>{t("الأمان وكلمة المرور", "Security & Password")}</CardTitle>
                  <CardDescription>
                    {t("إدارة إعدادات الأمان الخاصة بك", "Manage your security settings")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current_password">{t("كلمة المرور الحالية", "Current Password")}</Label>
                    <Input id="current_password" type="password" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new_password">{t("كلمة المرور الجديدة", "New Password")}</Label>
                    <Input id="new_password" type="password" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm_password">{t("تأكيد كلمة المرور", "Confirm Password")}</Label>
                    <Input id="confirm_password" type="password" />
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <Button variant="outline">{t("إلغاء", "Cancel")}</Button>
                    <Button>{t("تحديث كلمة المرور", "Update Password")}</Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Footer />
    </div>
  )
}
