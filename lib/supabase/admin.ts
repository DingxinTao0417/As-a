import "server-only"
import { createClient } from "@supabase/supabase-js"

// Never use this for untrusted reads/writes without checking ownership in the caller.
// A fresh client cannot inherit a browser session or silently fall back to the anon key.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Server database credentials are not configured")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
