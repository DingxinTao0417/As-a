import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@/lib/supabase/server"
import { safeAuthNext } from "@/components/auth-navigation"

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const next = safeAuthNext(request.nextUrl.searchParams.get("next"))

  if (code) {
    try {
      const supabase = await createServerClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) return NextResponse.redirect(new URL(next, request.nextUrl.origin))
    } catch {
      // Never expose the authorization code or provider error details in a URL.
    }
  }

  return NextResponse.redirect(new URL("/auth/login?error=auth_callback_failed", request.nextUrl.origin))
}
