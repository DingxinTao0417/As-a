"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Bot, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getAIChatSession } from "@/app/actions/ai-chat"

type ChatMessage = { id: string; role: "user" | "assistant"; content: string }
const SESSION_KEY = "asaa-ai-chat-session"
const CLIENT_SESSION_KEY = "asaa-ai-chat-client-session"

interface AICustomerServiceChatProps {
  language?: "ar" | "en"
  onClose?: () => void
}

export function AICustomerServiceChat({ language = "en", onClose }: AICustomerServiceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [retryMessages, setRetryMessages] = useState<ChatMessage[] | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionClientIdRef = useRef<string | null>(null)

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
        : language === "ar" ? "عذراً، خدمة الدردشة غير متاحة حالياً." : "Sorry, chat is unavailable right now.")
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
    <Card className="fixed bottom-4 end-4 w-[calc(100vw-2rem)] max-w-96 h-[500px] flex flex-col shadow-lg z-50 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <h3 className="font-semibold">{language === "ar" ? "مساعد أسعى" : "As'a Assistant"}</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={startNewSession}>{language === "ar" ? "محادثة جديدة" : "New chat"}</Button>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={language === "ar" ? "إغلاق" : "Close"}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {language === "ar"
              ? "اسأل عن المنصة، أو أدرج رقم الطلب للتحقق من حالته إذا كنت أحد أطرافه."
              : "Ask about the platform, or include an order ID to check its status when you are a participant."}
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg p-3 text-sm whitespace-pre-wrap ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg p-3 text-sm">...</div>
          </div>
        )}
        {requestError && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="text-destructive">{requestError}</p>
            {retryMessages && (
              <Button variant="link" className="h-auto p-0" onClick={() => void sendChat(retryMessages)} disabled={isLoading}>
                {language === "ar" ? "إعادة المحاولة" : "Retry"}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
        <Link href="/support" className="text-primary hover:underline">
          {language === "ar" ? "هل تحتاج مراجعة من الإدارة؟ أنشئ طلب دعم" : "Need administrator review? Create a support ticket"}
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={language === "ar" ? "اكتب رسالتك..." : "Type your message..."}
          disabled={isLoading}
          dir={language === "ar" ? "rtl" : "ltr"}
          aria-label={language === "ar" ? "رسالة الدعم" : "Support message"}
          maxLength={4000}
        />
        <Button type="submit" disabled={isLoading || !input.trim()} size="icon" aria-label={language === "ar" ? "إرسال" : "Send"}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </Card>
  )
}
