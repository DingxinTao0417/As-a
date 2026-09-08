"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Mail,
  Phone,
  MapPin,
  Pencil,
  Save,
  User,
  ShieldCheck,
  Star,
  MessageCircle,
  Camera,
  Loader2,
  Download,
  Trash2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { exportUserData } from "@/app/actions/user-data"
import { requestAccountDeletion } from "@/app/actions/delete-account"
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

interface Profile {
  id: string
  full_name: string
  email: string
  phone?: string
  location?: string
  bio?: string
  avatar_url?: string
  user_type?: "seeker" | "provider" | "both"
  role?: string
  created_at?: string
}

export default function ProfilePage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [profile, setProfile] = useState<Profile>({
    id: "",
    full_name: "",
    email: "",
    phone: "",
    location: "",
    bio: "",
    avatar_url: "",
    user_type: "seeker",
    role: "seeker",
  })
  const [editForm, setEditForm] = useState<Profile>({ ...profile })
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  })
  const [changingPassword, setChangingPassword] = useState(false)
  const [exportingData, setExportingData] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false)

  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single()

      const merged: Profile = {
        id: user.id,
        full_name: profileData?.full_name || user.user_metadata?.full_name || "",
        email: user.email || "",
        phone: profileData?.phone || "",
        // location & bio are stored in user_metadata (not in profiles table)
        location: user.user_metadata?.location || "",
        bio: user.user_metadata?.bio || "",
        avatar_url: profileData?.avatar_url || user.user_metadata?.avatar_url || "",
        user_type: profileData?.user_type || user.user_metadata?.role || "seeker",
        role: profileData?.role || "seeker",
        created_at: profileData?.created_at,
      }

      setProfile(merged)
      setEditForm(merged)
      setLoading(false)
    }

    loadProfile()
  }, [router])

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate type
    if (!file.type.startsWith("image/")) {
      toast({
        title: t("خطأ", "Error"),
        description: t("يرجى اختيار صورة فقط", "Please select an image file"),
        variant: "destructive",
      })
      return
    }

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: t("الملف كبير جداً", "File too large"),
        description: t("الحد الأقصى لحجم الصورة هو 5MB", "Maximum image size is 5MB"),
        variant: "destructive",
      })
      return
    }

    // Show local preview immediately
    const previewUrl = URL.createObjectURL(file)
    setAvatarPreview(previewUrl)

    setUploadingAvatar(true)
    try {
      const supabase = createClient()

      // Proactively remove all possible old avatar filenames (remove() is a no-op for non-existent files)
      const possibleOldPaths = ["avatar", "avatar.jpg", "avatar.jpeg", "avatar.png", "avatar.webp", "avatar.gif"].map(
        (name) => `${profile.id}/${name}`
      )
      await supabase.storage.from("avatars").remove(possibleOldPaths)

      // Fixed filename per user — upsert as safety net
      const filePath = `${profile.id}/avatar`

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true, contentType: file.type })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath)

      // Cache-busting so the browser doesn't show old avatar
      const urlWithBust = `${publicUrl}?t=${Date.now()}`

      // Update profiles table
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ avatar_url: urlWithBust })
        .eq("id", profile.id)

      if (profileError) throw profileError

      // Also update providers table if the user has a provider profile
      // (service pages read avatar_url from providers, not profiles)
      const { error: providerError } = await supabase
        .from("providers")
        .update({ avatar_url: urlWithBust })
        .eq("user_id", profile.id)
        .select("id")

      if (providerError) {
        // provider avatar update failed silently
      }

      setProfile((prev) => ({ ...prev, avatar_url: urlWithBust }))
      setAvatarPreview(null)
      toast({
        title: t("تم تحديث الصورة", "Avatar updated"),
        description: t("تم رفع صورتك الشخصية بنجاح", "Your profile photo has been uploaded"),
      })
    } catch (error: any) {
      setAvatarPreview(null)
      toast({
        title: t("فشل رفع الصورة", "Upload failed"),
        description: error?.message || t("حدث خطأ أثناء رفع الصورة", "An error occurred while uploading"),
        variant: "destructive",
      })
    } finally {
      setUploadingAvatar(false)
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const supabase = createClient()

      // Save columns that exist in profiles table
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({
          id: profile.id,
          email: profile.email,
          full_name: editForm.full_name,
          phone: editForm.phone,
          updated_at: new Date().toISOString(),
        })

      if (profileError) throw profileError

      // Save location & bio to auth user_metadata (not in profiles table)
      const { error: metaError } = await supabase.auth.updateUser({
        data: {
          location: editForm.location,
          bio: editForm.bio,
        },
      })

      if (metaError) throw metaError

      setProfile({ ...profile, ...editForm })
      setDialogOpen(false)
      toast({
        title: t("تم الحفظ بنجاح", "Saved successfully"),
        description: t("تم تحديث معلومات ملفك الشخصي", "Your profile has been updated"),
      })
    } catch (error: any) {
      toast({
        title: t("حدث خطأ", "Error"),
        description: error?.message || t("فشل حفظ التغييرات", "Failed to save changes"),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password) {
      toast({
        title: t("خطأ", "Error"),
        description: t("يرجى ملء جميع الحقول", "Please fill in all fields"),
        variant: "destructive",
      })
      return
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast({
        title: t("خطأ", "Error"),
        description: t("كلمتا المرور غير متطابقتين", "Passwords do not match"),
        variant: "destructive",
      })
      return
    }
    if (passwordForm.new_password.length < 6) {
      toast({
        title: t("خطأ", "Error"),
        description: t("كلمة المرور يجب أن تكون 6 أحرف على الأقل", "Password must be at least 6 characters"),
        variant: "destructive",
      })
      return
    }

    setChangingPassword(true)
    try {
      const supabase = createClient()

      const { error } = await supabase.auth.updateUser({
        password: passwordForm.new_password,
      })
      if (error) throw error

      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" })
      setDialogOpen(false)
      toast({
        title: t("تم التحديث", "Updated"),
        description: t("تم تغيير كلمة المرور بنجاح", "Password changed successfully"),
      })
    } catch (error: any) {
      toast({
        title: t("حدث خطأ", "Error"),
        description: error?.message || t("فشل تغيير كلمة المرور", "Failed to change password"),
        variant: "destructive",
      })
    } finally {
      setChangingPassword(false)
    }
  }

  const handleExportData = async () => {
    setExportingData(true)
    try {
      const result = await exportUserData()
      if (!result.success) throw new Error(result.error)

      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `asaa-user-data-${profile.id}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      toast({
        title: t("تم تجهيز البيانات", "Data exported"),
        description: t("تم تنزيل نسخة من بياناتك", "A copy of your data has been downloaded"),
      })
    } catch (error: any) {
      toast({
        title: t("فشل تصدير البيانات", "Data export failed"),
        description: error?.message || t("تعذر تصدير بياناتك", "Unable to export your data"),
        variant: "destructive",
      })
    } finally {
      setExportingData(false)
    }
  }

  const handleRequestDeletion = async () => {
    setShowDeleteAccountDialog(true)
  }

  const executeDeleteAccount = async () => {
    setShowDeleteAccountDialog(false)
    setDeletingAccount(true)
    try {
      const result = await requestAccountDeletion()
      if (!result.success) throw new Error(result.error)
      toast({
        title: t("تم إرسال طلب الحذف", "Deletion requested"),
        description: t("تم تسجيل خروجك بعد طلب حذف الحساب", "You have been signed out after requesting account deletion"),
      })
      router.push("/")
    } catch (error: any) {
      toast({
        title: t("تعذر حذف الحساب", "Account deletion failed"),
        description: error?.message || t("يرجى المحاولة لاحقاً", "Please try again later"),
        variant: "destructive",
      })
    } finally {
      setDeletingAccount(false)
    }
  }

  const roleLabel =
    profile.user_type === "provider"
      ? t("مقدم خدمات", "Service Provider")
      : profile.user_type === "both"
      ? t("مقدم خدمات وباحث", "Provider & Seeker")
      : t("باحث عن خدمات", "Service Seeker")

  const joinedYear = profile.created_at
    ? new Date(profile.created_at).getFullYear()
    : new Date().getFullYear()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 bg-muted/30">
        {/* Hero / Cover Section */}
        <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-b">
          <div className="container mx-auto px-4 max-w-4xl py-12">
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              {/* Avatar */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => !uploadingAvatar && fileInputRef.current?.click()}
                  className="group relative block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  title={t("تغيير الصورة الشخصية", "Change profile photo")}
                >
                  <Avatar className="h-28 w-28 ring-4 ring-background shadow-xl">
                    <AvatarImage src={avatarPreview || profile.avatar_url || "/placeholder.svg"} />
                    <AvatarFallback className="text-3xl font-bold bg-primary/10 text-primary">
                      {profile.full_name?.charAt(0)?.toUpperCase() ||
                        profile.email?.charAt(0)?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {/* Overlay */}
                  <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {uploadingAvatar ? (
                      <Loader2 className="h-7 w-7 text-white animate-spin" />
                    ) : (
                      <Camera className="h-7 w-7 text-white" />
                    )}
                  </div>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </div>

              {/* Name & Role */}
              <div className="flex-1 text-center md:text-start">
                <h1 className="text-3xl font-bold mb-1">
                  {profile.full_name || t("المستخدم", "User")}
                </h1>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-2">
                  <Badge variant="secondary" className="text-sm px-3 py-1">
                    {roleLabel}
                  </Badge>
                  {profile.location && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {profile.location}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Star className="h-3.5 w-3.5" />
                    {t(`عضو منذ ${joinedYear}`, `Member since ${joinedYear}`)}
                  </span>
                </div>
              </div>

              {/* Edit Button */}
              <div className="shrink-0">
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      onClick={() => setEditForm({ ...profile })}
                      className="gap-2"
                    >
                      <Pencil className="h-4 w-4" />
                      {t("تعديل الملف الشخصي", "Edit Profile")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                      <DialogTitle>{t("تعديل الملف الشخصي", "Edit Profile")}</DialogTitle>
                    </DialogHeader>
                    <Tabs defaultValue="info" className="mt-2">
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="info">
                          <User className="h-4 w-4 ms-1" />
                          {t("المعلومات", "Info")}
                        </TabsTrigger>
                        <TabsTrigger value="password">
                          <ShieldCheck className="h-4 w-4 ms-1" />
                          {t("كلمة المرور", "Password")}
                        </TabsTrigger>
                      </TabsList>

                      {/* Info Tab */}
                      <TabsContent value="info" className="space-y-4 pt-4">
                        <div className="space-y-2">
                          <Label htmlFor="edit_full_name">{t("الاسم الكامل", "Full Name")}</Label>
                          <Input
                            id="edit_full_name"
                            value={editForm.full_name}
                            onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                            placeholder={t("أدخل اسمك", "Enter your name")}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>{t("البريد الإلكتروني", "Email")}</Label>
                          <Input value={profile.email} disabled className="bg-muted" />
                          <p className="text-xs text-muted-foreground">
                            {t("لا يمكن تغيير البريد الإلكتروني", "Email cannot be changed")}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="edit_phone">{t("رقم الهاتف", "Phone")}</Label>
                            <Input
                              id="edit_phone"
                              value={editForm.phone}
                              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                              placeholder="05XXXXXXXX"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="edit_location">{t("الموقع", "Location")}</Label>
                            <Input
                              id="edit_location"
                              value={editForm.location}
                              onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                              placeholder={t("مدينتك", "Your city")}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="edit_bio">{t("نبذة عني", "About Me")}</Label>
                          <Textarea
                            id="edit_bio"
                            value={editForm.bio}
                            onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                            placeholder={t("أخبرنا عن نفسك...", "Tell us about yourself...")}
                            rows={4}
                          />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            {t("إلغاء", "Cancel")}
                          </Button>
                          <Button onClick={handleSave} disabled={saving} className="gap-2">
                            <Save className="h-4 w-4" />
                            {saving ? t("جاري الحفظ...", "Saving...") : t("حفظ التغييرات", "Save Changes")}
                          </Button>
                        </div>
                      </TabsContent>

                      {/* Password Tab */}
                      <TabsContent value="password" className="space-y-4 pt-4">
                        <div className="space-y-2">
                          <Label htmlFor="current_password">{t("كلمة المرور الحالية", "Current Password")}</Label>
                          <Input
                            id="current_password"
                            type="password"
                            value={passwordForm.current_password}
                            onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                            placeholder={t("أدخل كلمة المرور الحالية", "Enter current password")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new_password">{t("كلمة المرور الجديدة", "New Password")}</Label>
                          <Input
                            id="new_password"
                            type="password"
                            value={passwordForm.new_password}
                            onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="confirm_password">{t("تأكيد كلمة المرور", "Confirm Password")}</Label>
                          <Input
                            id="confirm_password"
                            type="password"
                            value={passwordForm.confirm_password}
                            onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                          />
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                          <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            {t("إلغاء", "Cancel")}
                          </Button>
                          <Button onClick={handleChangePassword} disabled={changingPassword} className="gap-2">
                            <ShieldCheck className="h-4 w-4" />
                            {changingPassword ? t("جاري التحديث...", "Updating...") : t("تغيير كلمة المرور", "Change Password")}
                          </Button>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 max-w-4xl py-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left Column - Contact & Info */}
            <div className="space-y-4">
              {/* Contact Card */}
              <div className="bg-card rounded-xl border p-5 space-y-4">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                  {t("معلومات التواصل", "Contact Info")}
                </h2>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t("البريد الإلكتروني", "Email")}</p>
                      <p className="text-sm font-medium truncate">{profile.email}</p>
                    </div>
                  </div>

                  {profile.phone ? (
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Phone className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("الهاتف", "Phone")}</p>
                        <p className="text-sm font-medium">{profile.phone}</p>
                      </div>
                    </div>
                  ) : null}

                  {profile.location ? (
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <MapPin className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("الموقع", "Location")}</p>
                        <p className="text-sm font-medium">{profile.location}</p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {!profile.phone && !profile.location && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    {t("أضف معلومات التواصل لتكتمل صفحتك", "Add contact info to complete your profile")}
                  </p>
                )}
              </div>

              {/* Quick Stats */}
              <div className="bg-card rounded-xl border p-5 space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                  {t("إحصائيات", "Stats")}
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/40 rounded-lg p-3 text-center">
                    <MessageCircle className="h-5 w-5 mx-auto mb-1 text-primary" />
                    <p className="text-xs text-muted-foreground">{t("النوع", "Type")}</p>
                    <p className="text-xs font-semibold mt-0.5">
                      {profile.user_type === "provider"
                        ? t("مقدم", "Provider")
                        : t("باحث", "Seeker")}
                    </p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3 text-center">
                    <Star className="h-5 w-5 mx-auto mb-1 text-primary" />
                    <p className="text-xs text-muted-foreground">{t("عضو منذ", "Since")}</p>
                    <p className="text-xs font-semibold mt-0.5">{joinedYear}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Bio */}
            <div className="md:col-span-2 space-y-4">
              <div className="bg-card rounded-xl border p-5">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3">
                  {t("نبذة عني", "About Me")}
                </h2>
                {profile.bio ? (
                  <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
                    {profile.bio}
                  </p>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                      <User className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t("لا توجد نبذة بعد", "No bio yet")}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("أضف نبذة تعريفية لتعريف الآخرين بك", "Add a bio to introduce yourself")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialogOpen(true)}
                      className="gap-1"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t("إضافة نبذة", "Add Bio")}
                    </Button>
                  </div>
                )}
              </div>

              {/* Profile Completeness */}
              <div className="bg-card rounded-xl border p-5">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-4">
                  {t("اكتمال الملف الشخصي", "Profile Completeness")}
                </h2>
                <div className="space-y-2">
                  {[
                    { label: t("الاسم الكامل", "Full Name"), done: !!profile.full_name },
                    { label: t("البريد الإلكتروني", "Email"), done: !!profile.email },
                    { label: t("رقم الهاتف", "Phone Number"), done: !!profile.phone },
                    { label: t("الموقع", "Location"), done: !!profile.location },
                    { label: t("نبذة عني", "About Me"), done: !!profile.bio },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2">
                      <div
                        className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 ${
                          item.done ? "bg-green-500" : "bg-muted"
                        }`}
                      >
                        {item.done && (
                          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  {(() => {
                    const fields = [
                      !!profile.full_name,
                      !!profile.email,
                      !!profile.phone,
                      !!profile.location,
                      !!profile.bio,
                    ]
                    const pct = Math.round((fields.filter(Boolean).length / fields.length) * 100)
                    return (
                      <>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">{t("مكتمل", "Complete")}</span>
                          <span className="font-semibold">{pct}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>

              <div className="bg-card rounded-xl border border-destructive/20 p-5">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-3">
                  {t("البيانات والخصوصية", "Data & Privacy")}
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {t(
                    "يمكنك تنزيل نسخة من بياناتك أو طلب حذف حسابك وفق سياسة الخصوصية.",
                    "Download a copy of your data or request account deletion under the privacy policy."
                  )}
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button variant="outline" onClick={handleExportData} disabled={exportingData} className="gap-2">
                    <Download className="h-4 w-4" />
                    {exportingData ? t("جاري التصدير...", "Exporting...") : t("تصدير بياناتي", "Export My Data")}
                  </Button>
                  <Button variant="destructive" onClick={handleRequestDeletion} disabled={deletingAccount} className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    {deletingAccount ? t("جاري المعالجة...", "Processing...") : t("حذف حسابي", "Delete My Account")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <AlertDialog open={showDeleteAccountDialog} onOpenChange={setShowDeleteAccountDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("حذف الحساب", "Delete Account")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "هل تريد طلب حذف حسابك؟ سيتم تعطيل الوصول وإخفاء خدماتك وتسجيل خروجك. تبقى سجلات المحادثات والمعاملات لحين تطبيق سياسة الاحتفاظ.",
                "Request account deletion? Your access will be disabled, listings hidden, and you will be signed out. Conversation and transaction records remain pending the retention process."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={executeDeleteAccount} className="bg-destructive text-destructive-foreground">
              {t("حذف حسابي", "Delete My Account")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  )
}
