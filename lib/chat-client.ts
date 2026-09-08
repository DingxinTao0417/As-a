type Message = { role: "user" | "assistant"; content: string }

// Keep visible history, but send only a recent context that the API can accept.
export function chatPayload(history: Message[]) {
  const messages = history.slice(-20).map(({ role, content }) => ({ role, content: content.slice(0, 4000) }))
  const bytes = () => new TextEncoder().encode(JSON.stringify({ messages })).byteLength
  while (messages.length > 1 && (messages.reduce((total, message) => total + message.content.length, 0) > 12000 || bytes() > 30_000)) {
    messages.shift()
  }
  return { messages }
}

export class ChatRequestError extends Error {
  constructor(public readonly status: number) { super("Chat request failed") }
}

export async function sendChat(history: Message[]) {
  const response = await fetch("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chatPayload(history)), signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new ChatRequestError(response.status)
  const data = await response.json()
  if (typeof data.message !== "string" || !data.message.trim()) throw new ChatRequestError(502)
  return data.message as string
}

export function chatErrorText(status: number, language: "ar" | "en") {
  if (status === 401) return language === "ar" ? "سجّل الدخول لاستخدام المساعد الذكي." : "Sign in to use the AI assistant."
  if (status === 429) return language === "ar" ? "لقد وصلت إلى حد الرسائل. حاول لاحقاً." : "You have reached the message limit. Please try again later."
  return language === "ar" ? "خدمة الدردشة غير متاحة حالياً. يمكنك المحاولة لاحقاً." : "Chat is unavailable right now. Please try again later."
}
