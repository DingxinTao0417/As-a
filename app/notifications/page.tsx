"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bell, CheckCheck } from "lucide-react"
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "@/app/actions/notifications"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"
import { createClient } from "@/lib/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"

export default function NotificationsPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [loadingMore,setLoadingMore]=useState(false)
  const [cursor,setCursor]=useState<{createdAt:string;id:string}|null>(null)

  const load = async (reset=true,preserveExisting=false) => {
    if(reset&&!preserveExisting)setLoading(true);else if(!reset)setLoadingMore(true)
    const result = await getMyNotifications(30,reset?null:cursor)
    if (result.success) {
      setNotifications((current)=>{
        if(reset){
          if(!preserveExisting)return result.data.notifications
          const refreshed=new Set(result.data.notifications.map((notification)=>notification.id))
          return [...result.data.notifications,...current.filter((notification)=>!refreshed.has(notification.id))]
        }
        const existing=new Set(current.map((notification)=>notification.id))
        return [...current,...result.data.notifications.filter((notification)=>!existing.has(notification.id))]
      })
      if(reset||result.data.notifications.length)setUnreadCount(result.data.unreadCount)
      if(!preserveExisting)setCursor(result.data.nextCursor)
      setLoadError(null)
    } else {setLoadError(result.error);toast({ title: t("تعذر تحميل الإشعارات", "Could not load notifications"), description: result.error, variant: "destructive" })}
    setLoading(false)
    setLoadingMore(false)
  }
  useEffect(() => { void load() }, [])
  useEffect(()=>{
    const supabase=createClient()
    let active=true
    let channel:RealtimeChannel|null=null
    void supabase.auth.getUser().then(({data,error})=>{
      if(!active||error||!data.user)return
      channel=supabase.channel(`notifications-page-${data.user.id}`).on("postgres_changes",{
        event:"*",schema:"public",table:"notifications",filter:`user_id=eq.${data.user.id}`,
      },()=>void load(true,true)).subscribe((status)=>{
        if(status==="SUBSCRIBED")void load(true,true)
      })
    })
    return()=>{active=false;if(channel)void channel.unsubscribe()}
  },[])

  const markOne = async (notification: Notification) => {
    if (notification.read_at) return
    const result = await markNotificationRead(notification.id)
    if (result.success) {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item))
      setUnreadCount((value) => Math.max(0, value - 1))
    } else toast({title:t("تعذر تحديث الإشعار","Could not update notification"),description:result.error,variant:"destructive"})
  }
  const markAll = async () => {
    setProcessing(true)
    const result = await markAllNotificationsRead()
    if (result.success) {
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || readAt })))
      setUnreadCount(0)
    } else toast({ title: t("تعذر تحديث الإشعارات", "Could not update notifications"), description: result.error, variant: "destructive" })
    setProcessing(false)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-muted/30 py-10">
        <div className="container mx-auto max-w-4xl px-4 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h1 className="flex items-center gap-2 text-3xl font-bold"><Bell className="h-7 w-7" />{t("الإشعارات", "Notifications")}</h1><p className="mt-1 text-muted-foreground">{loadError&&notifications.length===0?"—":unreadCount} {t("غير مقروء", "unread")}</p></div>
            <Button variant="outline" onClick={() => void markAll()} disabled={processing || unreadCount === 0}><CheckCheck className="me-2 h-4 w-4" />{t("تحديد الكل كمقروء", "Mark All Read")}</Button>
          </div>
          {loading ? <div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div> : loadError&&notifications.length===0 ? <LoadErrorCard title={t("تعذر تحميل الإشعارات","Could not load notifications")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()} /> : notifications.length === 0 ? <Card className="p-10 text-center text-muted-foreground">{t("لا توجد إشعارات", "No notifications")}</Card> : (
            <>{loadError&&<LoadErrorCard title={t("تعذر تحديث الإشعارات","Could not refresh notifications")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void load()} />}
            <div className="space-y-3">{notifications.map((notification) => {
              const content = <Card className={`p-4 ${notification.read_at ? "opacity-70" : "border-primary/40 bg-primary/5"}`}><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{language === "ar" ? notification.title_ar : notification.title_en}</h2><p className="mt-1 text-sm text-muted-foreground">{language === "ar" ? notification.body_ar : notification.body_en}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(notification.created_at).toLocaleString(language === "ar" ? "ar-SA" : "en-US")}</p></div>{!notification.read_at && <Badge>{t("جديد", "New")}</Badge>}</div></Card>
              return notification.link ? <Link key={notification.id} href={notification.link} onClick={() => void markOne(notification)}>{content}</Link> : <button key={notification.id} className="w-full text-start" onClick={() => void markOne(notification)}>{content}</button>
            })}</div>{cursor&&<div className="text-center"><Button variant="outline" onClick={()=>void load(false)} disabled={loadingMore}>{loadingMore?t("جاري التحميل...","Loading..."):t("تحميل إشعارات أقدم","Load Older Notifications")}</Button></div>}</>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
