/** Restrict authentication redirects to paths within this application. */
export function safeAuthNext(value: string | null, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return fallback
  try {
    const url = new URL(value, "https://app.invalid")
    if (url.origin !== "https://app.invalid" || url.pathname === "/auth/callback") return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
