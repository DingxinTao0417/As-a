"use client"

import { useState } from "react"
import { MessageCircle, X } from "lucide-react"
import { useLanguage } from "./language-provider"

type ChatMessage = { id: string; role: "user" | "assistant"; content: string }

export function GlobalCustomerService() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { language, t } = useLanguage()

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = input.trim()
    if (!content || isLoading) return

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Chat request failed")
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: data.message }])
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: t("عذراً، خدمة الدردشة غير متاحة حالياً.", "Sorry, chat is unavailable right now."),
        },
      ])
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
        <div className="fixed bottom-24 right-6 z-40 w-[calc(100vw-3rem)] max-w-[380px] h-[500px] bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b bg-primary text-primary-foreground">
            <h3 className="font-semibold">{t("مساعد أسعى", "As'a Assistant")}</h3>
            <p className="text-xs opacity-80">{t("كيف يمكنني مساعدتك؟", "How can I help you?")}</p>
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
          </div>

          <form onSubmit={handleSubmit} className="p-3 border-t flex gap-2">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("اكتب رسالتك...", "Type your message...")}
              className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background"
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
