"use client"

import { useState } from "react"
import { Bot, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type ChatMessage = { id: string; role: "user" | "assistant"; content: string }

interface AICustomerServiceChatProps {
  language?: "ar" | "en"
  onClose?: () => void
}

export function AICustomerServiceChat({ language = "en", onClose }: AICustomerServiceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)

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
          content: language === "ar" ? "عذراً، خدمة الدردشة غير متاحة حالياً." : "Sorry, chat is unavailable right now.",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="fixed bottom-4 right-4 w-[calc(100vw-2rem)] max-w-96 h-[500px] flex flex-col shadow-lg z-50 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <h3 className="font-semibold">{language === "ar" ? "مساعد أسعى" : "As'a Assistant"}</h3>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={language === "ar" ? "إغلاق" : "Close"}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={language === "ar" ? "اكتب رسالتك..." : "Type your message..."}
          disabled={isLoading}
          dir={language === "ar" ? "rtl" : "ltr"}
          aria-label={language === "ar" ? "رسالة الدعم" : "Support message"}
        />
        <Button type="submit" disabled={isLoading || !input.trim()} size="icon" aria-label={language === "ar" ? "إرسال" : "Send"}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </Card>
  )
}
