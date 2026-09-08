"use client"

import { useState, useRef, useEffect } from "react"
import { MessageCircle, X } from "lucide-react"
import { useLanguage } from "./language-provider"
import { Input } from "./ui/input"
import Link from "next/link"
import { ChatRequestError, chatErrorText, sendChat } from "@/lib/chat-client"

type ChatMessage = { id: string; role: "user" | "assistant"; content: string }

export function GlobalCustomerService() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const { language, t } = useLanguage()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = input.trim()
    if (!content || isLoading) return

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput("")
    setIsLoading(true)
    setErrorStatus(null)

    try {
      const message = await sendChat(nextMessages)
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: message }])
    } catch (error) {
      setErrorStatus(error instanceof ChatRequestError ? error.status : 503)
      setMessages(messages)
      setInput(content)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        aria-label={t("مساعدة", "Help")}
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-40 w-[calc(100vw-3rem)] max-w-[380px] h-[min(500px,calc(100dvh-8rem))] bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-primary text-primary-foreground">
            <h3 className="font-semibold">{t("مساعد أسعى الذكي", "As'a AI Assistant")}</h3>
            <p className="text-xs opacity-80">{t("معلومات عامة عن المنصة؛ لا يمكنه تعديل طلباتك.", "General platform guidance; it cannot change your orders.")}</p>
            <Link href="/messages" className="text-xs underline">{t("ناقش طلبك مع مقدم الخدمة", "Discuss your order with your provider")}</Link>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center mt-8">
                {t("مرحباً! اسألني أي شيء عن المنصة", "Hi! Ask me anything about the platform")}
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
            <div ref={messagesEndRef} />
          </div>

          {errorStatus !== null && <div role="alert" className="px-4 py-2 text-sm text-destructive">
            {chatErrorText(errorStatus, language)}
            {errorStatus === 401 && <Link href="/auth/login" className="ms-2 underline">{t("تسجيل الدخول", "Sign in")}</Link>}
          </div>}
          <form onSubmit={handleSubmit} className="p-3 border-t flex gap-2">
            <Input
              maxLength={4000}
              disabled={isLoading}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("اكتب رسالتك...", "Type your message...")}
              dir={language === "ar" ? "rtl" : "ltr"}
              aria-label={t("رسالة الدعم", "Support message")}
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
