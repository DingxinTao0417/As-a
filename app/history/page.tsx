"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/components/language-provider"
import { createClient } from "@/lib/supabase/client"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { History, Calendar, DollarSign } from "lucide-react"

interface ServiceHistory {
  id: string
  provider_name: string
  provider_avatar: string
  service_name_ar: string
  service_name_en: string
  service_description_ar: string
  service_description_en: string
  amount: number
  status: string
  completed_at: string
}

export default function HistoryPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<ServiceHistory[]>([])
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const loadHistory = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      setUser(user)

      // Fetch service history
      const { data, error } = await supabase
        .from("service_history")
        .select("*")
        .eq("seeker_id", user.id)
        .order("completed_at", { ascending: false })

      if (error) {
        console.error("[v0] Error fetching history:", error)
      } else {
        setHistory(data || [])
      }

      setLoading(false)
    }

    loadHistory()
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
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="mb-6">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <History className="h-8 w-8" />
              {t("سجل الخدمات", "Service History")}
            </h1>
            <p className="text-muted-foreground mt-2">
              {t("عرض جميع الخدمات التي أنجزتها", "View all services you've completed")}
            </p>
          </div>

          {history.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  {t("لا يوجد سجل خدمات حتى الآن", "No service history yet")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {history.map((item) => (
                <Card key={item.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={item.provider_avatar || "/placeholder.svg"} />
                        <AvatarFallback>{item.provider_name?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-semibold text-lg">
                              {language === "ar" ? item.service_name_ar : item.service_name_en}
                            </h3>
                            <p className="text-sm text-muted-foreground">{item.provider_name}</p>
                          </div>
                          <Badge variant={item.status === "completed" ? "default" : "secondary"}>
                            {item.status === "completed" ? t("مكتمل", "Completed") : t("ملغي", "Cancelled")}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          {language === "ar" ? item.service_description_ar : item.service_description_en}
                        </p>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            {new Date(item.completed_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                          </div>
                          <div className="flex items-center gap-1 font-semibold">
                            <DollarSign className="h-4 w-4" />
                            {item.amount} {t("ريال", "SAR")}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
