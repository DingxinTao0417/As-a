"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Briefcase, Star, Clock, CheckCircle, AlertCircle, Plus } from "lucide-react"

interface Task {
  id: string
  title: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  budget: number
  created_at: string
}

export default function DashboardPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [stats, setStats] = useState({
    activeTasks: 0,
    completedTasks: 0,
    totalSpent: 0,
    rating: 0,
  })

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      setUser(user)
      setLoading(false)
    }

    checkAuth()
  }, [router])

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
        <div className="container mx-auto px-4">
          {/* Welcome Section */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">
              {t("مرحباً بك", "Welcome back")}, {user?.email?.split("@")[0]}!
            </h1>
            <p className="text-muted-foreground">{t("إليك ملخص نشاطك", "Here's your activity summary")}</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("المهام النشطة", "Active Tasks")}</CardTitle>
                <Briefcase className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.activeTasks}</div>
                <p className="text-xs text-muted-foreground">{t("قيد التنفيذ", "In progress")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("المهام المكتملة", "Completed Tasks")}</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.completedTasks}</div>
                <p className="text-xs text-muted-foreground">{t("بنجاح", "Successfully")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("إجمالي الإنفاق", "Total Spent")}</CardTitle>
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.totalSpent} {t("ر.س", "SAR")}
                </div>
                <p className="text-xs text-muted-foreground">{t("هذا الشهر", "This month")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{t("التقييم", "Rating")}</CardTitle>
                <Star className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  {stats.rating || "N/A"}
                  {stats.rating > 0 && <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />}
                </div>
                <p className="text-xs text-muted-foreground">{t("من 5", "out of 5")}</p>
              </CardContent>
            </Card>
          </div>

          {/* Tasks Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t("مهامي", "My Tasks")}</CardTitle>
                  <CardDescription>{t("تابع تقدم مهامك", "Track your task progress")}</CardDescription>
                </div>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  {t("مهمة جديدة", "New Task")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="active" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="active">{t("نشطة", "Active")}</TabsTrigger>
                  <TabsTrigger value="completed">{t("مكتملة", "Completed")}</TabsTrigger>
                  <TabsTrigger value="all">{t("الكل", "All")}</TabsTrigger>
                </TabsList>
                <TabsContent value="active" className="mt-6">
                  <div className="text-center py-12 text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t("لا توجد مهام نشطة حالياً", "No active tasks at the moment")}</p>
                    <Button variant="link" className="mt-2">
                      {t("تصفح المحترفين", "Browse Professionals")}
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="completed" className="mt-6">
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t("لا توجد مهام مكتملة", "No completed tasks yet")}</p>
                  </div>
                </TabsContent>
                <TabsContent value="all" className="mt-6">
                  <div className="text-center py-12 text-muted-foreground">
                    <Briefcase className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t("لم تبدأ أي مهام بعد", "No tasks started yet")}</p>
                    <Button variant="link" className="mt-2" onClick={() => router.push("/services/seeker")}>
                      {t("ابدأ الآن", "Get Started")}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  )
}
