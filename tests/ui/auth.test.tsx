import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import LoginPage from "@/app/auth/login/page"
import SignupPage from "@/app/auth/signup/page"
import ForgotPasswordPage from "@/app/auth/forgot-password/page"
import ResetPasswordPage from "@/app/auth/reset-password/page"
import { LanguageProvider } from "@/components/language-provider"
import { safeAuthNext } from "@/components/auth-navigation"
import { installBrowserStorage } from "./browser-storage"

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(), updateUser: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn(),
}))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: mocks }) }))
vi.mock("next/navigation", () => ({ useRouter: () => mocks }))
vi.mock("@/components/header", () => ({ Header: () => null }))
vi.mock("@/components/footer", () => ({ Footer: () => null }))

beforeEach(() => {
  vi.resetAllMocks()
  installBrowserStorage()
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  window.localStorage.setItem("language", "en")
  window.history.replaceState({}, "", "/")
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function fillSignup() {
  fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Test User" } })
  fireEvent.change(screen.getByLabelText("Email", { exact: true }), { target: { value: "test@example.com" } })
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "SecurePass123!" } })
  fireEvent.change(screen.getByLabelText("Repeat Password"), { target: { value: "SecurePass123!" } })
  fireEvent.click(screen.getByRole("checkbox"))
}

describe("safe auth redirects", () => {
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\nevil.example", "javascript:alert(1)", "/auth/callback", "https://app.invalid.evil/path"])("rejects %s", (value) => {
    expect(safeAuthNext(value)).toBe("/")
  })
  it("preserves a same-origin destination and query", () => {
    expect(safeAuthNext("/messages?provider=123")).toBe("/messages?provider=123")
  })
})

describe("authentication forms", () => {
  it("keeps email confirmation instructions visible instead of navigating away", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
    render(<LanguageProvider><SignupPage /></LanguageProvider>)
    fillSignup()
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
    await expect(screen.findByRole("status")).resolves.toHaveTextContent("Please check your email")
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: expect.stringContaining("/auth/callback?next=%2F") }) }))
  })

  it("sends provider signups with a session to provider onboarding", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: { access_token: "test" } }, error: null })
    render(<LanguageProvider><SignupPage /></LanguageProvider>)
    fillSignup()
    fireEvent.click(screen.getByRole("radio", { name: "Service Provider" }))
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/register/provider"))
  })

  it("shows signup validation failures without making a request", async () => {
    render(<LanguageProvider><SignupPage /></LanguageProvider>)
    fillSignup()
    fireEvent.change(screen.getByLabelText("Repeat Password"), { target: { value: "DifferentPassword" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }))
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match")
    expect(mocks.signUp).not.toHaveBeenCalled()
  })

  it("returns logged-in users to the requested internal page", async () => {
    window.history.replaceState({}, "", "/auth/login?next=%2Fmessages%3Fprovider%3D123")
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    render(<LanguageProvider><LoginPage /></LanguageProvider>)
    fireEvent.change(screen.getByLabelText("Email", { exact: true }), { target: { value: "test@example.com" } })
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "password" } })
    fireEvent.click(screen.getByRole("button", { name: /^Login$/ }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/messages?provider=123"))
  })

  it("shows login failures and unlocks the submit button", async () => {
    mocks.signInWithPassword.mockRejectedValue(new Error("Unable to connect"))
    render(<LanguageProvider><LoginPage /></LanguageProvider>)
    fireEvent.change(screen.getByLabelText("Email", { exact: true }), { target: { value: "test@example.com" } })
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "password" } })
    fireEvent.click(screen.getByRole("button", { name: /^Login$/ }))
    await expect(screen.findByRole("alert")).resolves.toHaveTextContent("Unable to connect")
    expect(screen.getByRole("button", { name: /^Login$/ })).toBeEnabled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it("requests reset mail with a callback and gives a non-enumerating confirmation", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null })
    render(<LanguageProvider><ForgotPasswordPage /></LanguageProvider>)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }))
    await expect(screen.findByRole("status")).resolves.toHaveTextContent("If an account exists")
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("test@example.com", { redirectTo: `${window.location.origin}/auth/callback?next=%2Fauth%2Freset-password` })
  })

  it("refuses a password update without a valid session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    render(<LanguageProvider><ResetPasswordPage /></LanguageProvider>)
    await expect(screen.findByRole("alert")).resolves.toHaveTextContent("invalid or expired")
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})
