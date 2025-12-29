// Simplified Supabase client using fetch API
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface AuthSession {
  access_token: string
  refresh_token: string
  user: {
    id: string
    email?: string
  }
}

class SupabaseClient {
  private session: AuthSession | null = null

  constructor() {
    if (typeof window !== "undefined") {
      const storedSession = localStorage.getItem("supabase_session")
      if (storedSession) {
        this.session = JSON.parse(storedSession)
      }
    }
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    console.log("[v0] Making request to:", endpoint)
    console.log("[v0] Has session:", !!this.session)
    console.log("[v0] Access token exists:", !!this.session?.access_token)

    const headers: HeadersInit = {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    }

    if (this.session?.access_token) {
      headers.Authorization = `Bearer ${this.session.access_token}`
      console.log("[v0] Added Authorization header")
    } else {
      console.warn("[v0] No access token available for request")
    }

    const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      throw new Error(error.message || `HTTP ${response.status}`)
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return null
    }

    const text = await response.text()
    if (!text || text.trim() === "") {
      return null
    }

    return JSON.parse(text)
  }

  auth = {
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      try {
        console.log("[v0] Attempting login for:", email)
        const data = await this.request("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        })

        console.log("[v0] Login successful, user:", data.user?.email)

        this.session = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          user: data.user,
        }

        if (typeof window !== "undefined") {
          localStorage.setItem("supabase_session", JSON.stringify(this.session))
          console.log("[v0] Session saved to localStorage")
        }

        return { data, error: null }
      } catch (error) {
        console.error("[v0] Login error:", error)
        return { data: null, error }
      }
    },

    signUp: async ({
      email,
      password,
      options,
    }: {
      email: string
      password: string
      options?: {
        emailRedirectTo?: string
        data?: Record<string, any>
      }
    }) => {
      try {
        console.log("[v0] Attempting signup for:", email)
        const payload: any = { email, password }

        if (options?.data) {
          payload.data = options.data
        }

        if (options?.emailRedirectTo) {
          payload.email_redirect_to = options.emailRedirectTo
        }

        const data = await this.request("/auth/v1/signup", {
          method: "POST",
          body: JSON.stringify(payload),
        })

        console.log("[v0] Signup successful")

        return { data, error: null }
      } catch (error) {
        console.error("[v0] Signup error:", error)
        return { data: null, error }
      }
    },

    signOut: async () => {
      try {
        console.log("[v0] Signing out")
        await this.request("/auth/v1/logout", {
          method: "POST",
        })

        this.session = null
        if (typeof window !== "undefined") {
          localStorage.removeItem("supabase_session")
          console.log("[v0] Session cleared from localStorage")
        }

        return { error: null }
      } catch (error) {
        console.error("[v0] Signout error:", error)
        return { error }
      }
    },

    getUser: async () => {
      if (!this.session) {
        return { data: { user: null }, error: null }
      }

      try {
        const data = await this.request("/auth/v1/user", {
          method: "GET",
        })

        return { data: { user: data }, error: null }
      } catch (error) {
        return { data: { user: null }, error }
      }
    },

    onAuthStateChange: (callback: (event: string, session: AuthSession | null) => void) => {
      // Simplified auth state change listener
      const checkAuth = () => {
        if (typeof window !== "undefined") {
          const storedSession = localStorage.getItem("supabase_session")
          const session = storedSession ? JSON.parse(storedSession) : null
          callback("SIGNED_IN", session)
        }
      }

      checkAuth()

      return {
        data: {
          subscription: {
            unsubscribe: () => {},
          },
        },
      }
    },
  }

  from(table: string) {
    return {
      select: (columns = "*") => {
        const query = columns
        const filters: string[] = []
        let orderBy = ""
        let isSingle = false

        const builder = {
          eq: (column: string, value: any) => {
            filters.push(`${column}=eq.${value}`)
            return builder
          },
          in: (column: string, values: any[]) => {
            filters.push(`${column}=in.(${values.join(",")})`)
            return builder
          },
          order: (column: string, options?: { ascending?: boolean }) => {
            orderBy = `${column}.${options?.ascending ? "asc" : "desc"}`
            return builder
          },
          single: () => {
            isSingle = true
            return builder
          },
          then: async (resolve: (value: any) => void, reject: (error: any) => void) => {
            try {
              let url = `/rest/v1/${table}?select=${encodeURIComponent(query)}`

              if (filters.length > 0) {
                url += `&${filters.join("&")}`
              }

              if (orderBy) {
                url += `&order=${orderBy}`
              }

              console.log("[v0] Fetching:", url)

              const data = await this.request(url, {
                method: "GET",
              })

              console.log("[v0] Fetch result:", data)

              // If single() was called, return first item or null
              if (isSingle) {
                resolve({ data: data && data.length > 0 ? data[0] : null, error: null })
              } else {
                resolve({ data, error: null })
              }
            } catch (error) {
              console.error("[v0] Fetch error:", error)
              resolve({ data: null, error })
            }
          },
        }

        return builder
      },

      insert: (values: any) => {
        const insertBuilder = {
          select: () => ({
            single: () => ({
              then: async (resolve: (value: any) => void) => {
                try {
                  console.log("[v0] Inserting into", table, ":", values)
                  const data = await this.request(`/rest/v1/${table}`, {
                    method: "POST",
                    body: JSON.stringify(values),
                    headers: {
                      Prefer: "return=representation",
                    },
                  })

                  console.log("[v0] Insert result:", data)
                  const result = data && data.length > 0 ? data[0] : null
                  console.log("[v0] Single result:", result)
                  resolve({ data: result, error: null })
                } catch (error) {
                  console.error("[v0] Insert error:", error)
                  resolve({ data: null, error: { message: error instanceof Error ? error.message : String(error) } })
                }
              },
            }),
            then: async (resolve: (value: any) => void) => {
              try {
                console.log("[v0] Inserting into", table, ":", values)
                const data = await this.request(`/rest/v1/${table}`, {
                  method: "POST",
                  body: JSON.stringify(values),
                  headers: {
                    Prefer: "return=representation",
                  },
                })

                console.log("[v0] Insert result:", data)
                resolve({ data, error: null })
              } catch (error) {
                console.error("[v0] Insert error:", error)
                resolve({ data: null, error: { message: error instanceof Error ? error.message : String(error) } })
              }
            },
          }),
          then: async (resolve: (value: any) => void) => {
            try {
              console.log("[v0] Inserting into", table, ":", values)
              const data = await this.request(`/rest/v1/${table}`, {
                method: "POST",
                body: JSON.stringify(values),
                headers: {
                  Prefer: "return=representation",
                },
              })

              console.log("[v0] Insert result:", data)
              resolve({ data, error: null })
            } catch (error) {
              console.error("[v0] Insert error:", error)
              resolve({ data: null, error: { message: error instanceof Error ? error.message : String(error) } })
            }
          },
        }

        return insertBuilder
      },

      update: (values: any) => {
        const filters: string[] = []

        const builder = {
          eq: (column: string, value: any) => {
            filters.push(`${column}=eq.${value}`)
            return builder
          },
          neq: (column: string, value: any) => {
            filters.push(`${column}=neq.${value}`)
            return builder
          },
          then: async (resolve: (value: any) => void, reject: (error: any) => void) => {
            try {
              let url = `/rest/v1/${table}`

              if (filters.length > 0) {
                url += `?${filters.join("&")}`
              }

              const data = await this.request(url, {
                method: "PATCH",
                body: JSON.stringify(values),
              })

              resolve({ data, error: null })
            } catch (error) {
              reject({ data: null, error })
            }
          },
        }

        return builder
      },

      delete: () => {
        const filters: string[] = []

        const builder = {
          eq: (column: string, value: any) => {
            filters.push(`${column}=eq.${value}`)
            return builder
          },
          then: async (resolve: (value: any) => void, reject: (error: any) => void) => {
            try {
              let url = `/rest/v1/${table}`

              if (filters.length > 0) {
                url += `?${filters.join("&")}`
              }

              console.log("[v0] Deleting from", table, "with filters:", filters)

              const data = await this.request(url, {
                method: "DELETE",
              })

              console.log("[v0] Delete successful")
              resolve({ data, error: null })
            } catch (error) {
              console.error("[v0] Delete error:", error)
              reject({ data: null, error })
            }
          },
        }

        return builder
      },
    }
  }
}

let clientInstance: SupabaseClient | null = null

export function createClient() {
  if (!clientInstance) {
    clientInstance = new SupabaseClient()
  }
  return clientInstance
}
