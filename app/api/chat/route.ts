import { createServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const SYSTEM_PROMPT = `أنت مساعد خدمة عملاء لمنصة "أسعى" - سوق الخدمات المهنية في المملكة العربية السعودية.

You are a bilingual (Arabic/English) customer service assistant for the "As'a" (أسعى) professional services marketplace in Saudi Arabia.

Key information:
- Platform connects service seekers with verified providers
- Supports categories: Programming, Design, Marketing, Writing, Photography, Consulting
- Payment is processed securely through Tap Payment (15% platform fee)
- Payments are in SAR (Saudi Riyal)
- Supports mada cards, Visa, Mastercard, Apple Pay, STC Pay
- Providers must complete identity verification
- Funds are held in escrow until the seeker confirms delivery

Always respond in the same language the user writes in. Be helpful, concise, and professional.
If you don't know something specific about a user's order, suggest they check their messages or contact support.`

type IncomingMessage = {
  role: "user" | "assistant" | "system"
  content?: string
  parts?: Array<{ type: string; text?: string }>
}

type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

function normalizeMessages(messages: IncomingMessage[]): ChatMessage[] {
  return messages
    .map((message) => {
      const content =
        message.content || message.parts?.filter((part) => part.type === "text").map((part) => part.text || "").join("\n") || ""
      return { role: message.role, content } as ChatMessage
    })
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role === "system" ? "user" : message.role,
      content: message.content,
    }))
}

function getDeepSeekEndpoint() {
  const configured = process.env.DEEPSEEK_API_ENDPOINT?.trim()
  if (!configured) return "https://api.deepseek.com/chat/completions"
  if (configured.endsWith("/chat/completions")) return configured
  return `${configured.replace(/\/$/, "")}/chat/completions`
}

async function generateChatResponse(messages: ChatMessage[]) {
  const provider = (process.env.AI_MODEL_PROVIDER || (process.env.DEEPSEEK_API_KEY ? "deepseek" : "openai")).toLowerCase()

  if (provider === "deepseek") {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY")

    const response = await fetch(getDeepSeekEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || "deepseek-chat",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: Number(process.env.AI_MAX_TOKENS || 500),
        temperature: Number(process.env.AI_TEMPERATURE || 0.7),
      }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(`DeepSeek API error ${response.status}: ${data?.error?.message || response.statusText}`)
    }
    return data?.choices?.[0]?.message?.content || ""
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY")

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: Number(process.env.AI_MAX_TOKENS || 500),
      temperature: Number(process.env.AI_TEMPERATURE || 0.7),
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${data?.error?.message || response.statusText}`)
  }
  return data?.choices?.[0]?.message?.content || ""
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient()
    await supabase.auth.getUser()

    const { messages }: { messages?: IncomingMessage[] } = await req.json()

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "messages must contain at least one message" }, { status: 400 })
    }

    const normalizedMessages = normalizeMessages(messages)
    if (normalizedMessages.length === 0) {
      return Response.json({ error: "messages must contain text content" }, { status: 400 })
    }

    const message = await generateChatResponse(normalizedMessages)
    return Response.json({ message: message || "I'm here to help. Could you rephrase your question?" })
  } catch (error) {
    console.error("Chat API error:", error instanceof Error ? error.message : error)
    return Response.json({ error: "Chat service unavailable" }, { status: 500 })
  }
}
