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
import {
  cancelAccountDeletionRequest,
  getAccountDeletionStatus,
  requestAccountDeletion,
  type AccountDeletionRequest,
} from "@/app/actions/delete-account"
import { saveProfileAvatar, saveProfileDetails } from "@/app/actions/profile"
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
  role?: string
  created_at?: string
}

export default function ProfilePage() {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null)
  const [profileLoadAttempt, setProfileLoadAttempt] = useState(0)
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
  const [deletionRequest, setDeletionRequest] = useState<AccountDeletionRequest | null>(null)
  const [deletionStatusUnavailable, setDeletionStatusUnavailable] = useState(false)

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true)
      setProfileLoadError(null)
      const supabase = createClient()
      const { data: { user },error:authError } = await supabase.auth.getUser()

      if (authError) {
        setProfileLoadError(t("تعذر التحقق من الجلسة. يرجى المحاولة مرة أخرى","Could not verify your session. Please try again"))
        setLoading(false)
        return
      }
      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data: profileData,error:profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single()

      if (profileError || !profileData) {
        const message=t("تعذر تحميل ملفك الشخصي. يرجى المحاولة مرة أخرى","Could not load your profile. Please try again")
        setProfileLoadError(message)
        toast({ title:t("تعذر تحميل الملف الشخصي","Could not load profile"),description:message,variant:"destructive" })
        setLoading(false)
        return
      }

      const merged: Profile = {
        id: user.id,
        full_name: profileData?.full_name || user.user_metadata?.full_name || "",
        email: user.email || "",
        phone: profileData?.phone || "",
        location: profileData.location || "",
        bio: profileData.bio || "",
        avatar_url: profileData?.avatar_url || user.user_metadata?.avatar_url || "",
        role: profileData?.role || "seeker",
        created_at: profileData?.created_at,
      }

      setProfile(merged)
      setEditForm(merged)
      const deletionResult = await getAccountDeletionStatus()
      if (deletionResult.success) {
        setDeletionRequest(deletionResult.data.request)
        setDeletionStatusUnavailable(false)
      } else {
        setDeletionStatusUnavailable(true)
        toast({ title: t("تعذر تحميل حالة طلب الحذف", "Could not load deletion request status"), description: deletionResult.error, variant: "destructive" })
      }
      setLoading(false)
    }

    loadProfile()
  }, [router,profileLoadAttempt])

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }
    if (!extensions[file.type]) {
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

      const filePath = `${profile.id}/${crypto.randomUUID()}.${extensions[file.type]}`

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: false, contentType: file.type })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath)

      const saveResult = await saveProfileAvatar(publicUrl)
      if (!saveResult.success) {
        await supabase.storage.from("avatars").remove([filePath])
        throw new Error(saveResult.error)
      }

      const marker = "/storage/v1/object/public/avatars/"
      const oldPaths = saveResult.data.oldUrls.flatMap((url) => {
        try {
          const pathname = new URL(url).pathname
          const index = pathname.indexOf(marker)
          return index >= 0 ? [decodeURIComponent(pathname.slice(index + marker.length))] : []
        } catch {
          return []
        }
      })
      const { error: cleanupError } = oldPaths.length
        ? await supabase.storage.from("avatars").remove(oldPaths)
        : { error: null }

      setProfile((prev) => ({ ...prev, avatar_url: publicUrl }))
      setAvatarPreview(null)
      toast({
        title: t("تم تحديث الصورة", "Avatar updated"),
        description: cleanupError
          ? t("تم حفظ الصورة الجديدة، وتعذر تنظيف الملف القديم", "The new avatar was saved, but the old file could not be cleaned up")
          : t("تم رفع صورتك الشخصية بنجاح", "Your profile photo has been uploaded"),
        variant: cleanupError ? "destructive" : "default",
      })
    } catch (error: any) {
      setAvatarPreview(null)
      toast({
        title: t("فشل رفع الصورة", "Upload failed"),
        description: error?.message || t("حدث خطأ أثناء رفع الصورة", "An error occurred while uploading"),
        variant: "destructive",
      })
    } finally {
      URL.revokeObjectURL(previewUrl)
      setUploadingAvatar(false)
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const result=await saveProfileDetails({
        fullName:editForm.full_name,
        phone:editForm.phone || "",
        location:editForm.location || "",
        bio:editForm.bio || "",
      })
      if(!result.success)throw new Error(result.error)
      const saved=result.data.profile
      setProfile((current)=>({
        ...current,
        full_name:String(saved.full_name||""),
        phone:String(saved.phone||""),
        location:String(saved.location||""),
        bio:String(saved.bio||""),
      }))
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
    if (passwordForm.new_password.length < 8) {
      toast({
        title: t("خطأ", "Error"),
        description: t("كلمة المرور يجب أن تكون 8 أحرف على الأقل", "Password must be at least 8 characters"),
        variant: "destructive",
      })
      return
    }

    setChangingPassword(true)
    try {
      const supabase = createClient()

      const { error: reauthenticationError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: passwordForm.current_password,
      })
      if (reauthenticationError) {
        throw new Error(t("كلمة المرور الحالية غير صحيحة", "Current password is incorrect"))
      }

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
      const response=await fetch("/api/user-data-export",{method:"GET",headers:{Accept:"application/gzip"}})
      if(!response.ok){
        const failure=await response.json().catch(()=>null) as {error?:string}|null
        throw new Error(failure?.error||t("تعذر تصدير بياناتك","Unable to export your data"))
      }
      const blob=await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `asaa-user-data-${profile.id}-${new Date().toISOString().slice(0, 10)}.tar.gz`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      toast({
        title: t("تم تجهيز البيانات", "Data exported"),
        description:t("تم تنزيل أرشيف يحتوي على JSON والملفات الخاصة المتاحة","An archive containing JSON and available private files was downloaded"),
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
      setDeletionRequest(result.data.request)
      toast({
        title: t("تم إرسال طلب الحذف", "Deletion requested"),
        description: t("سيبقى الطلب قابلاً للإلغاء حتى تبدأ المعالجة", "The request remains cancellable until processing begins"),
      })
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

  const handleCancelDeletion = async () => {
    setDeletingAccount(true)
    const result = await cancelAccountDeletionRequest()
    if (result.success) {
      setDeletionRequest(result.data.request)
      toast({ title: t("تم إلغاء طلب الحذف", "Deletion request cancelled") })
    } else {
      toast({ title: t("تعذر إلغاء الطلب", "Could not cancel deletion request"), description: result.error, variant: "destructive" })
    }
    setDeletingAccount(false)
  }

  const roleLabel = profile.role === "provider"
    ? t("مقدم خدمات", "Service Provider")
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

  if (profileLoadError) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center bg-muted/30 px-4">
          <div className="max-w-md text-center" role="alert">
            <User className="mx-auto mb-4 h-12 w-12 text-destructive" />
            <h1 className="text-xl font-semibold">{t("تعذر تحميل الملف الشخصي","Could not load profile")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{profileLoadError}</p>
            <Button className="mt-4" onClick={() => setProfileLoadAttempt((attempt) => attempt + 1)}>
              {t("إعادة المحاولة","Retry")}
            </Button>
          </div>
        </main>
        <Footer />
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
                            autoComplete="current-password"
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
                            autoComplete="new-password"
                            minLength={8}
                            maxLength={128}
                            value={passwordForm.new_password}
                            onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="confirm_password">{t("تأكيد كلمة المرور", "Confirm Password")}</Label>
                          <Input
                            id="confirm_password"
                            type="password"
                            autoComplete="new-password"
                            minLength={8}
                            maxLength={128}
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
                      {profile.role === "provider"
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
                {deletionRequest?.status === "requested" && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    {t("طلب حذف الحساب قيد الانتظار ويمكن إلغاؤه قبل بدء المعالجة.", "Your account deletion request is pending and can be cancelled before processing begins.")}
                  </div>
                )}
                {deletionRequest?.status === "processing" && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    {t("بدأت معالجة طلب حذف الحساب ولم يعد قابلاً للإلغاء من هذه الصفحة.", "Account deletion processing has started and can no longer be cancelled from this page.")}
                  </div>
                )}
                {deletionStatusUnavailable && (
                  <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {t("حالة طلب الحذف غير متاحة. أعد تحميل الصفحة قبل إرسال طلب جديد.", "Deletion request status is unavailable. Reload the page before submitting a new request.")}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button variant="outline" onClick={handleExportData} disabled={exportingData} className="gap-2">
                    <Download className="h-4 w-4" />
                    {exportingData ? t("جاري التصدير...", "Exporting...") : t("تصدير بياناتي", "Export My Data")}
                  </Button>
                  {deletionRequest?.status === "requested" ? (
                    <Button variant="outline" onClick={() => void handleCancelDeletion()} disabled={deletingAccount}>
                      {deletingAccount ? t("جاري الإلغاء...", "Cancelling...") : t("إلغاء طلب الحذف", "Cancel Deletion Request")}
                    </Button>
                  ) : deletionRequest?.status === "processing" ? (
                    <Button variant="outline" disabled>{t("جاري معالجة الحذف", "Deletion Processing")}</Button>
                  ) : (
                    <Button variant="destructive" onClick={handleRequestDeletion} disabled={deletingAccount || deletionStatusUnavailable} className="gap-2">
                      <Trash2 className="h-4 w-4" />
                      {deletingAccount ? t("جاري المعالجة...", "Processing...") : t("طلب حذف حسابي", "Request Account Deletion")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <AlertDialog open={showDeleteAccountDialog} onOpenChange={setShowDeleteAccountDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("طلب حذف الحساب", "Request Account Deletion")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "هل تريد إرسال طلب حذف الحساب؟ يمكنك إلغاء الطلب قبل بدء المعالجة. لن يتم حذف البيانات أو تعطيل الحساب بمجرد إرسال الطلب.",
                "Submit an account deletion request? You can cancel it before processing begins. Submitting the request does not immediately delete data or disable the account."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={executeDeleteAccount} className="bg-destructive text-destructive-foreground">
              {t("إرسال الطلب", "Submit Request")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  )
}
