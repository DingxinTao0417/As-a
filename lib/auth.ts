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
