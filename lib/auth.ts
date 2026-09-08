import { createServerClient } from "@/lib/supabase/server"

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

  // Auth sessions remain valid after soft deletion; always check account state.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("deletion_requested_at")
    .eq("id", user.id)
    .maybeSingle()
  if (profileError || !profile) {
    throw new AuthError("Account is unavailable", "ACCOUNT_UNAVAILABLE")
  }
  if (profile.deletion_requested_at) {
    throw new AuthError("Account deletion has been requested", "ACCOUNT_DISABLED")
  }

  return { user, supabase }
}

export async function requireAdmin() {
  const { user, supabase } = await requireAuth()
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle()
  if (error || profile?.is_admin !== true) {
    throw new AuthError("Administrator access required", "ADMIN_REQUIRED")
  }
  return { user, supabase }
}

export async function requireProvider() {
  const { user, supabase } = await requireAuth()
  const { data: provider, error } = await supabase
    .from("providers")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle()

  if (error || !provider) {
    throw new AuthError("Provider profile required", "PROVIDER_REQUIRED")
  }

  return { user, supabase, provider }
}
