"use client"

import { useEffect, useRef, useState } from "react"
import { LifeBuoy, MessageCircle, Plus, Send } from "lucide-react"
import {
  createSupportTicket,
  getMySupportTickets,
  getSupportTicketMessages,
  replySupportTicket,
  type SupportTicket,
  type SupportTicketMessage,
} from "@/app/actions/support"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"

export default function SupportPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [messages, setMessages] = useState<SupportTicketMessage[]>([])
  const [selected, setSelected] = useState<SupportTicket | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [messagesReloadKey, setMessagesReloadKey] = useState(0)
  const [ticketCursor,setTicketCursor]=useState<{updatedAt:string;id:string}|null>(null)
  const [ticketTotal,setTicketTotal]=useState(0)
  const [loadingMoreTickets,setLoadingMoreTickets]=useState(false)
  const [messageCursor,setMessageCursor]=useState<{createdAt:string;id:string}|null>(null)
  const [loadingOlderMessages,setLoadingOlderMessages]=useState(false)
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [orderId, setOrderId] = useState("")
  const [reply, setReply] = useState("")
  const createRequestId = useRef<string | null>(null)
  const replyRequestId = useRef<string | null>(null)

  const loadTickets = async (reset=true) => {
    if(reset)setLoading(true);else setLoadingMoreTickets(true)
    const result = await getMySupportTickets(reset?null:ticketCursor)
    if (result.success) {
      setTickets((current)=>{
        if(reset)return result.data.tickets as SupportTicket[]
        const existing=new Set(current.map((ticket)=>ticket.id))
        return [...current,...(result.data.tickets as SupportTicket[]).filter((ticket)=>!existing.has(ticket.id))]
      })
      setTicketTotal(result.data.total)
      setTicketCursor(result.data.nextCursor)
      setLoadError(null)
      const requestedId = new URLSearchParams(window.location.search).get("ticket")
      if (reset&&requestedId) setSelected((result.data.tickets as SupportTicket[]).find((ticket) => ticket.id === requestedId) || null)
    } else {
      setLoadError(result.error)
      toast({ title: t("تعذر تحميل طلبات الدعم", "Could not load support tickets"), description: result.error, variant: "destructive" })
    }
    setLoading(false)
    setLoadingMoreTickets(false)
  }

  useEffect(() => { void loadTickets() }, [])

  const loadMessages=async(reset=true)=>{
    if(!selected)return
    if(!reset)setLoadingOlderMessages(true)
    const result=await getSupportTicketMessages(selected.id,reset?null:messageCursor)
    if(result.success){
      const page=result.data.messages as SupportTicketMessage[]
      setMessages((current)=>{
        if(reset)return page
        const existing=new Set(current.map((message)=>message.id))
        return [...page.filter((message)=>!existing.has(message.id)),...current]
      })
      setMessageCursor(result.data.nextCursor)
      setMessagesError(null)
    }else{
      setMessagesError(result.error)
      toast({title:t("تعذر تحميل الردود","Could not load replies"),description:result.error,variant:"destructive"})
    }
    setLoadingOlderMessages(false)
  }

  useEffect(() => {
    if (!selected) {setMessages([]);setMessagesError(null);setMessageCursor(null);return}
    let active=true
    setMessages([])
    setMessagesError(null)
    setMessageCursor(null)
    void getSupportTicketMessages(selected.id).then((result)=>{
      if(!active)return
      if(result.success){setMessages(result.data.messages as SupportTicketMessage[]);setMessageCursor(result.data.nextCursor)}
      else{setMessagesError(result.error);toast({ title:t("تعذر تحميل الردود","Could not load replies"),description:result.error,variant:"destructive" })}
    })
    return()=>{active=false}
  }, [selected?.id,messagesReloadKey])

  const createTicket = async () => {
    if (!createRequestId.current) createRequestId.current = crypto.randomUUID()
    setCreating(true)
    const result = await createSupportTicket({
      clientRequestId: createRequestId.current,
      subject,
      description,
      language,
      orderId: orderId.trim() || null,
    })
    if (result.success) {
      setCreateOpen(false)
      setSubject("")
      setDescription("")
      setOrderId("")
      createRequestId.current = null
      await loadTickets()
      setSelected(result.data.ticket)
      toast({ title: t("تم إنشاء طلب الدعم", "Support ticket created") })
    } else {
      toast({ title: t("تعذر إنشاء الطلب", "Could not create ticket"), description: result.error, variant: "destructive" })
    }
    setCreating(false)
  }

  const sendReply = async () => {
    if (!selected) return
    if (!replyRequestId.current) replyRequestId.current = crypto.randomUUID()
    setSending(true)
    const result = await replySupportTicket({
      ticketId: selected.id,
      clientRequestId: replyRequestId.current,
      body: reply,
    })
    if (result.success) {
      setMessages((current) => [...current, result.data.message])
      setReply("")
      replyRequestId.current = null
      toast({ title: t("تم إرسال الرد", "Reply sent") })
    } else {
      toast({ title: t("تعذر إرسال الرد", "Could not send reply"), description: result.error, variant: "destructive" })
    }
    setSending(false)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-muted/30 py-10">
        <div className="container mx-auto max-w-5xl px-4 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-3xl font-bold"><LifeBuoy className="h-7 w-7" />{t("طلبات الدعم", "Support Tickets")}</h1>
              <p className="mt-2 text-muted-foreground">{t("أنشئ طلباً واضحاً وتابع ردود الإدارة. لا يوجد وقت استجابة مضمون حالياً.", "Create a clear request and follow administrator replies. No response-time guarantee is currently offered.")}</p>
            </div>
            <Button onClick={() => setCreateOpen(true)}><Plus className="me-2 h-4 w-4" />{t("طلب جديد", "New Ticket")}</Button>
          </div>

          {loading ? (
            <div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div>
          ) : loadError&&tickets.length===0 ? (
            <LoadErrorCard title={t("تعذر تحميل طلبات الدعم","Could not load support tickets")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadTickets()} />
          ) : tickets.length === 0 ? (
            <Card className="p-10 text-center text-muted-foreground">{t("لا توجد طلبات دعم", "No support tickets")}</Card>
          ) : (
            <div className="space-y-4">{loadError&&<LoadErrorCard title={t("تعذر تحديث طلبات الدعم","Could not refresh support tickets")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadTickets()} />}<div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
              <div className="space-y-2">
                {tickets.map((ticket) => (
                  <button key={ticket.id} className={`w-full rounded-lg border p-4 text-start ${selected?.id === ticket.id ? "border-primary bg-primary/5" : "bg-card"}`} onClick={() => setSelected(ticket)}>
                    <div className="flex items-start justify-between gap-2"><span className="font-medium">{ticket.subject}</span><Badge variant={ticket.status === "closed" ? "outline" : "secondary"}>{ticket.status}</Badge></div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{ticket.description}</p>
                  </button>
                ))}
                {ticketCursor&&tickets.length<ticketTotal&&<div className="pt-2 text-center"><Button variant="outline" size="sm" onClick={()=>void loadTickets(false)} disabled={loadingMoreTickets}>{loadingMoreTickets?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Tickets")}</Button></div>}
              </div>
              <Card className="p-5">
                {selected ? (
                  <div className="space-y-4">
                    <div><h2 className="text-xl font-semibold">{selected.subject}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selected.description}</p>{selected.order_id && <p className="mt-2 font-mono text-xs">Order: {selected.order_id}</p>}</div>
                    <div className="space-y-3 border-t pt-4">
                      {messageCursor&&<div className="text-center"><Button variant="outline" size="sm" onClick={()=>void loadMessages(false)} disabled={loadingOlderMessages}>{loadingOlderMessages?t("جاري التحميل...","Loading..."):t("تحميل ردود أقدم","Load Older Replies")}</Button></div>}
                      {messagesError?<LoadErrorCard title={t("تعذر تحميل الردود","Could not load replies")} description={messagesError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>setMessagesReloadKey((key)=>key+1)} />:messages.length === 0 ? <p className="text-sm text-muted-foreground">{t("لا توجد ردود بعد", "No replies yet")}</p> : messages.map((message) => (
                        <div key={message.id} className="rounded-lg bg-muted p-3"><p className="whitespace-pre-wrap text-sm">{message.body}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString(language === "ar" ? "ar-SA" : "en-US")}</p></div>
                      ))}
                    </div>
                    {selected.status !== "closed" && (
                      <div className="flex gap-2 border-t pt-4">
                        <Textarea value={reply} onChange={(event) => { setReply(event.target.value); replyRequestId.current = null }} maxLength={5000} placeholder={t("أضف رداً...", "Add a reply...")} />
                        <Button size="icon" onClick={() => void sendReply()} disabled={sending || !reply.trim()} aria-label={t("إرسال الرد", "Send reply")}><Send className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </div>
                ) : <div className="flex h-48 flex-col items-center justify-center text-muted-foreground"><MessageCircle className="mb-2 h-8 w-8" />{t("اختر طلباً", "Select a ticket")}</div>}
              </Card>
            </div></div>
          )}
        </div>
      </main>
      <Footer />

      <Dialog open={createOpen} onOpenChange={(open) => !creating && setCreateOpen(open)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("طلب دعم جديد", "New Support Ticket")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><label htmlFor="support-subject" className="mb-1.5 block text-sm font-medium">{t("الموضوع", "Subject")}</label><Input id="support-subject" value={subject} maxLength={200} onChange={(event) => { setSubject(event.target.value); createRequestId.current = null }} /></div>
            <div><label htmlFor="support-description" className="mb-1.5 block text-sm font-medium">{t("التفاصيل", "Details")}</label><Textarea id="support-description" value={description} maxLength={5000} rows={6} onChange={(event) => { setDescription(event.target.value); createRequestId.current = null }} /></div>
            <div><label htmlFor="support-order" className="mb-1.5 block text-sm font-medium">{t("رقم الطلب (اختياري)", "Order ID (optional)")}</label><Input id="support-order" value={orderId} onChange={(event) => { setOrderId(event.target.value); createRequestId.current = null }} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>{t("إلغاء", "Cancel")}</Button><Button onClick={() => void createTicket()} disabled={creating || subject.trim().length < 3 || description.trim().length < 10}>{creating ? t("جاري الإنشاء...", "Creating...") : t("إنشاء الطلب", "Create Ticket")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
