// Server-side Supabase client using fetch API
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

class SupabaseServerClient {
  private async request(endpoint: string, options: RequestInit = {}) {
    const headers: HeadersInit = {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    }

    const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      throw new Error(error.message || `HTTP ${response.status}`)
    }

    return response.json()
  }

  auth = {
    getUser: async () => {
      return { data: { user: null }, error: null }
    },
  }

  from(table: string) {
    return {
      select: (columns = "*") => {
        const query = `${columns}`
        const filters: string[] = []
        let orderBy = ""

        const builder = {
          eq: (column: string, value: any) => {
            filters.push(`${column}=eq.${value}`)
            return builder
          },
          order: (column: string, options?: { ascending?: boolean }) => {
            orderBy = `${column}.${options?.ascending ? "asc" : "desc"}`
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

              resolve({ data, error: null })
            } catch (error) {
              reject({ data: null, error })
            }
          },
        }

        return builder
      },
    }
  }
}

export async function createClient() {
  return new SupabaseServerClient()
}
