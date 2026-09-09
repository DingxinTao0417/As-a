import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@/lib/supabase/server"
import { safeAuthNext } from "@/components/auth-navigation"

function appOrigin(request:NextRequest){
  try{
    const configured=new URL(process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin)
    if(configured.protocol==="http:"||configured.protocol==="https:")return configured.origin
  }catch{
    // Fall back to the request origin when deployment configuration is invalid.
  }
  return request.nextUrl.origin
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const next = safeAuthNext(request.nextUrl.searchParams.get("next"))
  const origin=appOrigin(request)

  if (code) {
    try {
      const supabase = await createServerClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) return NextResponse.redirect(new URL(next, origin))
    } catch {
      // Never expose the authorization code or provider error details in a URL.
    }
  }

  return NextResponse.redirect(new URL("/auth/login?error=auth_callback_failed", origin))
}
