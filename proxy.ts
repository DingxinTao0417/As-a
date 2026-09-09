import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const protectedRoutes = ["/messages", "/dashboard", "/profile", "/favorites", "/history", "/refunds", "/disputes", "/my-services", "/verification", "/register/provider", "/support", "/notifications", "/admin"]
const providerRoutes = ["/dashboard", "/my-services", "/verification"]
const authRoutes = ["/auth/login", "/auth/signup"]

function matches(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const pathname = request.nextUrl.pathname
  const isProtected = matches(pathname, protectedRoutes)

  const redirect = (path: string, returnTo?: string) => {
    const url = request.nextUrl.clone()
    url.pathname = path
    url.search = ""
    if (returnTo) url.searchParams.set("next", returnTo)
    const response = NextResponse.redirect(url)
    // Session refresh/sign-out cookies must survive redirects as well.
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    response.headers.set("Cache-Control", "private, no-store")
    return response
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return isProtected ? redirect("/auth/login", `${pathname}${request.nextUrl.search}`) : supabaseResponse
    }

    const { data: profile, error } = await supabase.from("profiles")
      .select("is_admin, role, deletion_requested_at, suspended_at").eq("id", user.id).maybeSingle()

    if (error || !profile) {
      if (isProtected || matches(pathname, authRoutes)) {
        return new NextResponse("Account service is temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } })
      }
      return supabaseResponse
    }
    if (profile.deletion_requested_at || profile.suspended_at) {
      await supabase.auth.signOut()
      return isProtected ? redirect("/auth/login") : supabaseResponse
    }
    if (matches(pathname, authRoutes)) return redirect("/")
    if (matches(pathname, ["/admin"]) && profile.is_admin !== true) return redirect("/")
    if (matches(pathname, providerRoutes) && profile.role !== "provider") return redirect("/register/provider")
    if (isProtected) supabaseResponse.headers.set("Cache-Control", "private, no-store")
    return supabaseResponse
  } catch {
    if (isProtected) {
      return new NextResponse("Authentication service is temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } })
    }
    return supabaseResponse
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
