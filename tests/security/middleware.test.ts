// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), maybeSingle: vi.fn(), signOut: vi.fn() }))
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookies: { setAll: (cookies: Array<{ name: string; value: string; options?: { path: string; httpOnly?: boolean } }>) => void }
  }) => {
    options.cookies.setAll([{ name: "session", value: "refreshed", options: { path: "/", httpOnly: true } }])
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: mocks.maybeSingle }
    return { auth: { getUser: mocks.getUser, signOut: mocks.signOut }, from: () => query }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
  mocks.maybeSingle.mockResolvedValue({ data: { role: "seeker", is_admin: false, deletion_requested_at: null }, error: null })
  mocks.signOut.mockResolvedValue({ error: null })
})

describe("authentication middleware", () => {
  it("preserves refreshed cookies and the local destination on a login redirect", async () => {
    const response = await proxy(new NextRequest("https://example.test/messages?order_id=abc"))
    const destination = new URL(response.headers.get("location")!)
    expect(destination.pathname).toBe("/auth/login")
    expect(destination.searchParams.get("next")).toBe("/messages?order_id=abc")
    expect(response.cookies.get("session")?.value).toBe("refreshed")
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  })
  it("does not treat an unrelated route prefix as protected", async () => {
    const response = await proxy(new NextRequest("https://example.test/profile-public"))
    expect(response.headers.get("location")).toBeNull()
  })
  it("denies administrators based on database state and preserves refresh cookies", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user", user_metadata: { is_admin: true } } }, error: null })
    const response = await proxy(new NextRequest("https://example.test/admin/orders"))
    expect(new URL(response.headers.get("location")!).pathname).toBe("/")
    expect(response.cookies.get("session")?.value).toBe("refreshed")
  })
  it("fails closed when the protected account lookup is unavailable", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "unavailable" } })
    const response = await proxy(new NextRequest("https://example.test/admin"))
    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })
  it("signs out accounts pending deletion and denies protected pages", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { deletion_requested_at: "2026-09-08" }, error: null })
    const response = await proxy(new NextRequest("https://example.test/messages"))
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(new URL(response.headers.get("location")!).pathname).toBe("/auth/login")
  })
})
