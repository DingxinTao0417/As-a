"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"
import { getAdminAuditPage, type AdminAuditEntry } from "@/app/actions/admin"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"

const PAGE_SIZE = 50

export default function AdminAuditPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [entries, setEntries] = useState<AdminAuditEntry[]>([])
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    const result = await getAdminAuditPage(page, appliedQuery, PAGE_SIZE)
    if (result.success) {
      setEntries(result.data.entries)
      setTotal(result.data.total)
      setLoadError(null)
    } else {
      setLoadError(result.error)
      toast({ title: t("تعذر تحميل سجل التدقيق", "Could not load audit history"), description: result.error, variant: "destructive" })
    }
    setLoading(false)
  }, [appliedQuery, page, t, toast])

  useEffect(() => { void loadEntries() }, [loadEntries])

  const applySearch = () => {
    setPage(1)
    setAppliedQuery(query.trim())
  }
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("سجل التدقيق", "Audit Log")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("تغييرات الإدارة الحساسة مع القيم السابقة واللاحقة", "Sensitive administrator changes with before and after values")}
        </p>
      </div>

      <form className="flex max-w-xl gap-2" onSubmit={(event) => { event.preventDefault(); applySearch() }}>
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("الإجراء أو البريد أو رقم الهدف", "Action, actor email, or target ID")}
          />
        </div>
        <Button type="submit">{t("بحث", "Search")}</Button>
      </form>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
        </div>
      ) : loadError&&entries.length===0 ? (
        <LoadErrorCard title={t("تعذر تحميل سجل التدقيق","Could not load audit history")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadEntries()} />
      ) : entries.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {t("لا توجد سجلات مطابقة", "No matching audit entries")}
        </Card>
      ) : (
        <>{loadError&&<LoadErrorCard title={t("تعذر تحديث سجل التدقيق","Could not refresh audit history")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadEntries()} />}<Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-start font-medium">{t("الوقت", "Time")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("المشرف", "Actor")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("الإجراء", "Action")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("الهدف", "Target")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("قبل", "Before")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("بعد", "After")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString(language === "ar" ? "ar-SA" : "en-US")}
                    </td>
                    <td className="px-4 py-3">
                      <div>{entry.actor_email || "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{entry.actor_id}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant="secondary">{entry.action}</Badge></td>
                    <td className="px-4 py-3 font-mono text-xs">{entry.target_id}</td>
                    <td className="max-w-xs px-4 py-3">
                      <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">{JSON.stringify(entry.before_data, null, 2)}</pre>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">{JSON.stringify(entry.after_data, null, 2)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card></>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{loadError&&entries.length===0?"—":total} {t("سجل", "entries")}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label={t("الصفحة السابقة", "Previous page")} disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span>{page} / {pageCount}</span>
          <Button variant="outline" size="icon" aria-label={t("الصفحة التالية", "Next page")} disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
