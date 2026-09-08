"use client"

import { useState } from "react"
import { Bot, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { ChatRequestError, chatErrorText, sendChat } from "@/lib/chat-client"

type ChatMessage = { id: string; role: "user" | "assistant"; content: string }

interface AICustomerServiceChatProps {
  language?: "ar" | "en"
  onClose?: () => void
}

export function AICustomerServiceChat({ language = "en", onClose }: AICustomerServiceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)

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
    <Card className="fixed bottom-4 right-4 w-[calc(100vw-2rem)] max-w-96 h-[min(500px,calc(100dvh-2rem))] flex flex-col shadow-lg z-50 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <h3 className="font-semibold">{language === "ar" ? "مساعد أسعى الذكي" : "As'a AI Assistant"}</h3>
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

      {errorStatus !== null && <div role="alert" className="px-4 py-2 text-sm text-destructive">
        {chatErrorText(errorStatus, language)}
        {errorStatus === 401 && <Link href="/auth/login" className="ms-2 underline">{language === "ar" ? "تسجيل الدخول" : "Sign in"}</Link>}
      </div>}
      <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
        <Input
          maxLength={4000}
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
