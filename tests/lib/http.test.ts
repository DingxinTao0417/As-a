// @vitest-environment node
import { describe, expect, it } from "vitest"
import { readJsonBody } from "@/lib/http"

describe("bounded JSON request parsing", () => {
  it("parses UTF-8 JSON", async () => {
    const request = new Request("https://test.local", { method: "POST", body: JSON.stringify({ text: "مرحبا" }) })
    await expect(readJsonBody(request)).resolves.toEqual({ text: "مرحبا" })
  })
  it("rejects oversized content even when Content-Length understates it", async () => {
    const request = new Request("https://test.local", { method: "POST", headers: { "Content-Length": "1" }, body: '"123456789"' })
    await expect(readJsonBody(request, 8)).rejects.toMatchObject({ status: 413 })
  })
  it("rejects malformed JSON with a client error", async () => {
    await expect(readJsonBody(new Request("https://test.local", { method: "POST", body: "{" }))).rejects.toMatchObject({ status: 400 })
  })
})
