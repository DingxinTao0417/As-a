// @vitest-environment node
import { describe, expect, it } from "vitest"
import { chatPayload } from "@/lib/chat-client"

describe("client chat context budget", () => {
  it("retains the newest user message after a long conversation", () => {
    const history = Array.from({ length: 30 }, (_, index) => ({ role: "user" as const, content: String(index) }))
    const payload = chatPayload(history)
    expect(payload.messages).toHaveLength(20)
    expect(payload.messages.at(-1)?.content).toBe("29")
    expect(history).toHaveLength(30)
  })
  it("fits the message, aggregate and UTF-8 byte limits", () => {
    const payload = chatPayload(Array.from({ length: 20 }, () => ({ role: "user" as const, content: "汉".repeat(5000) })))
    expect(payload.messages.every((message) => message.content.length <= 4000)).toBe(true)
    expect(payload.messages.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(12000)
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThanOrEqual(30_000)
  })
})
