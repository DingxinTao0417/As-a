import { cookies } from "next/headers"

// Server-side Supabase client using fetch API
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

class SupabaseServerClient {
  private accessToken: string | null = null

  constructor(accessToken?: string) {
    this.accessToken = accessToken || null
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const requestHeaders: HeadersInit = {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    }

    if (this.accessToken) {
      requestHeaders["Authorization"] = `Bearer ${this.accessToken}`
    }

    const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
      ...options,
      headers: requestHeaders,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      throw new Error(error.message || `HTTP ${response.status}`)
    }

    return response.json()
  }

  auth = {
    getUser: async () => {
      try {
        if (!this.accessToken) {
          console.log("[v0] No access token available")
          return { data: { user: null }, error: { message: "No access token" } }
        }

        console.log("[v0] Getting user with token")
        const data = await this.request("/auth/v1/user", {
          method: "GET",
        })

        console.log("[v0] User data:", data)
        return { data: { user: data }, error: null }
      } catch (error) {
        console.error("[v0] Error getting user:", error)
        return { data: { user: null }, error }
      }
    },
  }

  from(table: string) {
    return {
      select: (columns = "*") => {
        const query = `${columns}`
        const filters: string[] = []
        let orderBy = ""
        let singleResult = false

        const builder = {
          eq: (column: string, value: any) => {
            filters.push(`${column}=eq.${value}`)
            return builder
          },
          order: (column: string, options?: { ascending?: boolean }) => {
            orderBy = `${column}.${options?.ascending ? "asc" : "desc"}`
            return builder
          },
          single: () => {
            singleResult = true
            return builder
          },
          then: async (resolve: (value: any) => void, reject: (error: any) => void) => {
            try {
              let url = `/rest/v1/${table}?select=${query}`

              if (filters.length > 0) {
                url += `&${filters.join("&")}`
              }

              if (orderBy) {
                url += `&order=${orderBy}`
              }

              const data = await this.request(url, {
                method: "GET",
              })

              if (singleResult) {
                resolve({ data: data[0] || null, error: null })
              } else {
                resolve({ data, error: null })
              }
            } catch (error) {
              reject({ data: null, error })
            }
          },
        }

        return builder
      },
      insert: (values: any) => {
        return {
          select: () => {
            let singleResult = false
            return {
              single: () => {
                singleResult = true
                return {
                  then: async (resolve: (value: any) => void, reject: (error: any) => void) => {
                    try {
                      const data = await this.request(`/rest/v1/${table}`, {
                        method: "POST",
                        body: JSON.stringify(values),
                        headers: {
                          Prefer: "return=representation",
                        },
                      })

                      if (singleResult) {
                        resolve({ data: data[0] || null, error: null })
                      } else {
                        resolve({ data, error: null })
                      }
                    } catch (error: any) {
                      console.error("[v0] Insert error:", error)
                      reject({ data: null, error })
                    }
                  },
                }
              },
              then: async (resolve: (value: any) => void, reject: (error: any) => void) => {
                try {
                  const data = await this.request(`/rest/v1/${table}`, {
                    method: "POST",
                    body: JSON.stringify(values),
                    headers: {
                      Prefer: "return=representation",
                    },
                  })

                  resolve({ data, error: null })
                } catch (error: any) {
                  console.error("[v0] Insert error:", error)
                  reject({ data: null, error })
                }
              },
            }
          },
          then: async (resolve: (value: any) => void, reject: (error: any) => void) => {
            try {
              const data = await this.request(`/rest/v1/${table}`, {
                method: "POST",
                body: JSON.stringify(values),
              })

              resolve({ data, error: null })
            } catch (error: any) {
              console.error("[v0] Insert error:", error)
              reject({ data: null, error })
            }
          },
        }
      },
      update: (values: any) => {
        const filters: string[] = []
        return {
          eq: (column: string, value: any) => {
            filters.push(`${column}=eq.${value}`)
            return {
              select: () => {
                let singleResult = false
                return {
                  single: () => {
                    singleResult = true
                    return {
                      then: async (resolve: (value: any) => void, reject: (error: any) => void) => {
                        try {
                          const url = `/rest/v1/${table}?${filters.join("&")}`
                          const data = await this.request(url, {
                            method: "PATCH",
                            body: JSON.stringify(values),
                            headers: {
                              Prefer: "return=representation",
                            },
                          })

                          if (singleResult) {
                            resolve({ data: data[0] || null, error: null })
                          } else {
                            resolve({ data, error: null })
                          }
                        } catch (error: any) {
                          console.error("[v0] Update error:", error)
                          reject({ data: null, error })
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      },
    }
  }
}

export async function createClient() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("sb-access-token")?.value

  console.log("[v0] Creating server client with token:", !!accessToken)
  return new SupabaseServerClient(accessToken)
}

export async function createServerClient() {
  return createClient()
}
