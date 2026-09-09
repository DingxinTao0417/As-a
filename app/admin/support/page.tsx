"use client"

import { useEffect, useRef, useState } from "react"
import { RefreshCw, Send } from "lucide-react"
import {
  getAdminSupportTickets,
  getSupportTicketMessages,
  replySupportTicket,
  setSupportTicketStatus,
  type SupportTicket,
  type SupportTicketMessage,
} from "@/app/actions/support"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"

export default function AdminSupportPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [selected, setSelected] = useState<SupportTicket | null>(null)
  const [messages, setMessages] = useState<SupportTicketMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [messagesReloadKey, setMessagesReloadKey] = useState(0)
  const [ticketCursor,setTicketCursor]=useState<{updatedAt:string;id:string}|null>(null)
  const [ticketTotal,setTicketTotal]=useState(0)
  const [loadingMoreTickets,setLoadingMoreTickets]=useState(false)
  const [messageCursor,setMessageCursor]=useState<{createdAt:string;id:string}|null>(null)
  const [loadingOlderMessages,setLoadingOlderMessages]=useState(false)
  const [sending, setSending] = useState(false)
  const [reply, setReply] = useState("")
  const [nextStatus, setNextStatus] = useState<"open" | "in_progress" | "closed">("in_progress")
  const [statusReason, setStatusReason] = useState("")
  const replyRequestId = useRef<string | null>(null)

  const loadTickets = async (reset=true) => {
    if(reset)setLoading(true);else setLoadingMoreTickets(true)
    const result = await getAdminSupportTickets(reset?null:ticketCursor)
    if (result.success) {
      const page=result.data.tickets as SupportTicket[]
      setTickets((current)=>reset?page:[...current,...page.filter((ticket)=>!current.some((existing)=>existing.id===ticket.id))])
      setTicketTotal(result.data.total);setTicketCursor(result.data.nextCursor);setLoadError(null)
    }
    else {setLoadError(result.error);toast({ title: t("تعذر تحميل قائمة الدعم", "Could not load support queue"), description: result.error, variant: "destructive" })}
    setLoading(false)
    setLoadingMoreTickets(false)
  }

  useEffect(() => { void loadTickets() }, [])
  useEffect(() => {
    if (!selected) {setMessagesError(null);return setMessages([])}
    let active=true
    setMessages([])
    setMessagesError(null)
    setNextStatus(selected.status)
    setStatusReason("")
    setMessageCursor(null)
    void getSupportTicketMessages(selected.id).then((result) => {
      if(!active)return
      if (result.success) {setMessages(result.data.messages as SupportTicketMessage[]);setMessageCursor(result.data.nextCursor)}
      else {setMessagesError(result.error);toast({ title: t("تعذر تحميل الردود", "Could not load replies"), description: result.error, variant: "destructive" })}
    })
    return()=>{active=false}
  }, [selected?.id,messagesReloadKey])

  const loadOlderMessages=async()=>{
    if(!selected||!messageCursor||loadingOlderMessages)return
    setLoadingOlderMessages(true)
    const result=await getSupportTicketMessages(selected.id,messageCursor)
    if(result.success){
      const page=result.data.messages as SupportTicketMessage[]
      setMessages((current)=>[...page.filter((message)=>!current.some((existing)=>existing.id===message.id)),...current])
      setMessageCursor(result.data.nextCursor);setMessagesError(null)
    }else{setMessagesError(result.error);toast({title:t("تعذر تحميل الردود","Could not load replies"),description:result.error,variant:"destructive"})}
    setLoadingOlderMessages(false)
  }

  const sendReply = async () => {
    if (!selected) return
    if (!replyRequestId.current) replyRequestId.current = crypto.randomUUID()
    setSending(true)
    const result = await replySupportTicket({ ticketId: selected.id, clientRequestId: replyRequestId.current, body: reply })
    if (result.success) {
      setMessages((current) => [...current, result.data.message])
      setReply("")
      replyRequestId.current = null
      setSelected((current) => current ? { ...current, status: "in_progress" } : null)
      toast({ title: t("تم إرسال الرد", "Reply sent") })
    } else toast({ title: t("تعذر إرسال الرد", "Could not send reply"), description: result.error, variant: "destructive" })
    setSending(false)
  }

  const saveStatus = async () => {
    if (!selected) return
    setSending(true)
    const result = await setSupportTicketStatus(selected.id, nextStatus, statusReason)
    if (result.success) {
      setSelected((current) => current ? { ...current, status: nextStatus } : null)
      setTickets((current) => current.map((ticket) => ticket.id === selected.id ? { ...ticket, status: nextStatus } : ticket))
      setStatusReason("")
      toast({ title: t("تم تحديث الحالة", "Status updated") })
    } else toast({ title: t("تعذر تحديث الحالة", "Could not update status"), description: result.error, variant: "destructive" })
    setSending(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold">{t("قائمة الدعم", "Support Queue")}</h1><p className="mt-1 text-muted-foreground">{t("الرد على الطلبات وإدارة حالتها دون وعد بوقت استجابة", "Reply to tickets and manage status without a response-time promise")}</p></div>
        <Button variant="outline" onClick={() => void loadTickets()} disabled={loading}><RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{t("تحديث", "Refresh")}</Button>
      </div>

      {loading ? <div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-r-transparent" /></div> : loadError&&tickets.length===0 ? <LoadErrorCard title={t("تعذر تحميل قائمة الدعم","Could not load support queue")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadTickets()} /> : (
        <div className="space-y-4">{loadError&&<LoadErrorCard title={t("تعذر تحديث قائمة الدعم","Could not refresh support queue")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadTickets()} />}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="space-y-2">
            {tickets.length === 0 && <Card className="p-8 text-center text-muted-foreground">{t("لا توجد طلبات", "No tickets")}</Card>}
            {tickets.map((ticket) => (
              <button key={ticket.id} className={`w-full rounded-lg border p-4 text-start ${selected?.id === ticket.id ? "border-primary bg-primary/5" : "bg-card"}`} onClick={() => setSelected(ticket)}>
                <div className="flex items-start justify-between gap-2"><span className="font-medium">{ticket.subject}</span><Badge variant={ticket.status === "closed" ? "outline" : "secondary"}>{ticket.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{ticket.requester?.full_name || ticket.requester?.email || ticket.requester_id}</p>
              </button>
            ))}
            {ticketCursor&&tickets.length<ticketTotal&&<div className="pt-2 text-center"><Button variant="outline" size="sm" onClick={()=>void loadTickets(false)} disabled={loadingMoreTickets}>{loadingMoreTickets?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Tickets")}</Button></div>}
          </div>
          <Card className="p-5">
            {selected ? <div className="space-y-4">
              <div><div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-semibold">{selected.subject}</h2><Badge>{selected.status}</Badge></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selected.description}</p>{selected.order_id && <p className="mt-2 font-mono text-xs">Order: {selected.order_id}</p>}</div>
              <div className="max-h-72 space-y-3 overflow-y-auto border-y py-4">
                {messageCursor&&<div className="text-center"><Button variant="outline" size="sm" onClick={()=>void loadOlderMessages()} disabled={loadingOlderMessages}>{loadingOlderMessages?t("جاري التحميل...","Loading..."):t("تحميل ردود أقدم","Load Older Replies")}</Button></div>}
                {messagesError?<LoadErrorCard title={t("تعذر تحميل الردود","Could not load replies")} description={messagesError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>setMessagesReloadKey((key)=>key+1)} />:messages.length === 0 ? <p className="text-sm text-muted-foreground">{t("لا توجد ردود", "No replies")}</p> : messages.map((message) => <div key={message.id} className="rounded-lg bg-muted p-3"><p className="whitespace-pre-wrap text-sm">{message.body}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString(language === "ar" ? "ar-SA" : "en-US")}</p></div>)}
              </div>
              {selected.status !== "closed" && <div className="flex gap-2"><Textarea value={reply} onChange={(event) => { setReply(event.target.value); replyRequestId.current = null }} maxLength={5000} placeholder={t("اكتب رداً...", "Write a reply...")} /><Button size="icon" onClick={() => void sendReply()} disabled={sending || !reply.trim()} aria-label={t("إرسال الرد", "Send reply")}><Send className="h-4 w-4" /></Button></div>}
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap gap-2"><Select value={nextStatus} onValueChange={(value) => setNextStatus(value as typeof nextStatus)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">open</SelectItem><SelectItem value="in_progress">in_progress</SelectItem><SelectItem value="closed">closed</SelectItem></SelectContent></Select><Button onClick={() => void saveStatus()} disabled={sending || nextStatus === selected.status || statusReason.trim().length < 3}>{t("حفظ الحالة", "Save Status")}</Button></div>
                <Textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} maxLength={1000} placeholder={t("سبب تغيير الحالة لسجل التدقيق...", "Reason for the audit record...")} />
              </div>
            </div> : <div className="flex h-56 items-center justify-center text-muted-foreground">{t("اختر طلب دعم", "Select a support ticket")}</div>}
          </Card>
        </div></div>
      )}
    </div>
  )
}
