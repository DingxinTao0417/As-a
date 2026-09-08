export const dynamic = "force-dynamic"

// Liveness only: no credentials, database records, or internal errors in a public endpoint.
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } })
}
