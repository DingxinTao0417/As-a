"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { MessageCircle, X } from "lucide-react"
import { useLanguage } from "./language-provider"
import { Input } from "./ui/input"
import { getAIChatSession } from "@/app/actions/ai-chat"

type ChatMessage = { id: string; role: "user" | "assistant"; content: string }
const SESSION_KEY = "asaa-ai-chat-session"
const CLIENT_SESSION_KEY = "asaa-ai-chat-client-session"

export function GlobalCustomerService() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [retryMessages, setRetryMessages] = useState<ChatMessage[] | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionClientIdRef = useRef<string | null>(null)
  const { language, t } = useLanguage()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  useEffect(() => {
    let clientSessionId = localStorage.getItem(CLIENT_SESSION_KEY)
    if (!clientSessionId) {
      clientSessionId = crypto.randomUUID()
      localStorage.setItem(CLIENT_SESSION_KEY, clientSessionId)
    }
    sessionClientIdRef.current = clientSessionId
    const storedSessionId = localStorage.getItem(SESSION_KEY)
    if (!storedSessionId) return
    void getAIChatSession(storedSessionId).then((result) => {
      if (!result.success) return
      setSessionId(result.data.sessionId)
      setMessages(result.data.messages)
    })
  }, [])

  const sendChat = async (requestMessages: ChatMessage[]) => {
    const latestUser = [...requestMessages].reverse().find((message) => message.role === "user")
    if (!latestUser || !sessionClientIdRef.current) return
    setIsLoading(true)
    setRequestError(null)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: requestMessages,
          sessionId,
          sessionClientId: sessionClientIdRef.current,
          clientRequestId: latestUser.id,
          language,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Chat request failed")
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: data.message }])
      if (typeof data.sessionId === "string") {
        setSessionId(data.sessionId)
        localStorage.setItem(SESSION_KEY, data.sessionId)
      }
      setRetryMessages(null)
    } catch (error) {
      setRequestError(error instanceof Error
        ? error.message
        : t("عذراً، خدمة الدردشة غير متاحة حالياً.", "Sorry, chat is unavailable right now."))
      setRetryMessages(requestMessages)
    } finally {
      setIsLoading(false)
    }
  }

  const startNewSession = () => {
    const clientSessionId = crypto.randomUUID()
    sessionClientIdRef.current = clientSessionId
    localStorage.setItem(CLIENT_SESSION_KEY, clientSessionId)
    localStorage.removeItem(SESSION_KEY)
    setSessionId(null)
    setMessages([])
    setRequestError(null)
    setRetryMessages(null)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = input.trim()
    if (!content || isLoading) return

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content }
    const nextMessages = [...messages, userMessage].slice(-20)
    setMessages(nextMessages)
    setInput("")
    await sendChat(nextMessages)
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 end-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        aria-label={t("مساعدة", "Help")}
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 end-6 z-40 w-[calc(100vw-3rem)] max-w-[380px] h-[500px] bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-3 p-4 border-b bg-primary text-primary-foreground">
            <div><h3 className="font-semibold">{t("مساعد أسعى", "As'a Assistant")}</h3><p className="text-xs opacity-80">{t("كيف يمكنني مساعدتك؟", "How can I help you?")}</p></div>
            <button className="text-xs underline underline-offset-2" onClick={startNewSession}>{t("محادثة جديدة", "New chat")}</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center mt-8">
                {t("مرحباً! اسألني عن المنصة، أو أدرج رقم الطلب للتحقق من حالته إذا كنت أحد أطرافه.", "Hi! Ask about the platform, or include an order ID to check its status when you are a participant.")}
              </p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                  <span className="animate-pulse">...</span>
                </div>
              </div>
            )}
            {requestError && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="text-destructive">{requestError}</p>
                {retryMessages && (
                  <button className="mt-2 text-primary hover:underline" onClick={() => void sendChat(retryMessages)} disabled={isLoading}>
                    {t("إعادة المحاولة", "Retry")}
                  </button>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t px-3 py-2 text-center text-xs text-muted-foreground">
            <Link href="/support" className="text-primary hover:underline" onClick={() => setIsOpen(false)}>
              {t("هل تحتاج مراجعة من الإدارة؟ أنشئ طلب دعم", "Need administrator review? Create a support ticket")}
            </Link>
          </div>

          <form onSubmit={handleSubmit} className="p-3 border-t flex gap-2">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("اكتب رسالتك...", "Type your message...")}
              dir={language === "ar" ? "rtl" : "ltr"}
              aria-label={t("رسالة الدعم", "Support message")}
              maxLength={4000}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
            >
              {t("إرسال", "Send")}
            </button>
          </form>
        </div>
      )}
    </>
  )
}

export default GlobalCustomerService
