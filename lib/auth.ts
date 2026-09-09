import { createServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export class AuthError extends Error {
  code: string

  constructor(message: string, code = "UNAUTHORIZED") {
    super(message)
    this.name = "AuthError"
    this.code = code
  }
}

export async function requireAuth() {
  const supabase = await createServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new AuthError("Not logged in", "UNAUTHENTICATED")
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("deletion_requested_at, suspended_at")
    .eq("id", user.id)
    .maybeSingle()
  if (profileError || !profile) {
    throw new AuthError("Account service is unavailable", "ACCOUNT_UNAVAILABLE")
  }
  if (profile.deletion_requested_at || profile.suspended_at) {
    await supabase.auth.signOut()
    throw new AuthError("Account is suspended or unavailable", "ACCOUNT_DISABLED")
  }

  return { user, supabase }
}

export async function requireProvider() {
  const { user, supabase } = await requireAuth()
  const { data: provider, error } = await createAdminClient()
    .from("providers")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle()

  if (error || !provider) {
    throw new AuthError("Provider profile required", "PROVIDER_REQUIRED")
  }

  return { user, supabase, provider }
}

export async function requireAdmin() {
  const { user, supabase } = await requireAuth()
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle()

  if (error || !profile?.is_admin) {
    throw new AuthError("Administrator access required", "ADMIN_REQUIRED")
  }

  return { user, supabase }
}
