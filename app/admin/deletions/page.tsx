"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import {
  getAccountDeletionRequests,
  type AccountDeletionCursor,
  type AccountDeletionFilter,
  type AccountDeletionQueueItem,
} from "@/app/actions/admin"
import { useLanguage } from "@/components/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"

const filters:AccountDeletionFilter[]=["open","requested","processing","failed","cancelled","completed","all"]
const filterLabels:Record<AccountDeletionFilter,[string,string]>={
  open:["المفتوحة","Open"],requested:["المطلوبة","Requested"],processing:["قيد المعالجة","Processing"],
  failed:["الفاشلة","Failed"],cancelled:["الملغاة","Cancelled"],completed:["المكتملة","Completed"],all:["الكل","All"],
}

export default function AdminDeletionsPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [requests, setRequests] = useState<AccountDeletionQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter,setFilter]=useState<AccountDeletionFilter>("open")
  const [cursor,setCursor]=useState<AccountDeletionCursor|null>(null)
  const [total,setTotal]=useState(0)
  const [requestedCount,setRequestedCount]=useState(0)
  const [processingCount,setProcessingCount]=useState(0)
  const [failedCount,setFailedCount]=useState(0)
  const [loadingMore,setLoadingMore]=useState(false)

  const loadRequests = useCallback(async (pageCursor:AccountDeletionCursor|null=null,append=false) => {
    if(append)setLoadingMore(true);else setLoading(true)
    const result = await getAccountDeletionRequests(filter,pageCursor)
    if (result.success) {
      setRequests((current)=>append?[...current,...result.data.requests.filter((request)=>!current.some((item)=>item.id===request.id))]:result.data.requests)
      setCursor(result.data.nextCursor);if(!append||result.data.requests.length>0)setTotal(result.data.total)
      setRequestedCount(result.data.requestedCount);setProcessingCount(result.data.processingCount);setFailedCount(result.data.failedCount)
      setLoadError(null)
    } else {
      if(!append)setLoadError(result.error)
      toast({ title: t("تعذر تحميل طلبات الحذف", "Could not load deletion requests"), description: result.error, variant: "destructive" })
    }
    if(append)setLoadingMore(false);else setLoading(false)
  }, [t, toast,filter])

  useEffect(() => { void loadRequests() }, [loadRequests])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("طلبات حذف الحساب", "Account Deletion Requests")} {requestedCount+processingCount+failedCount>0&&<Badge variant="destructive" className="ms-2">{requestedCount+processingCount+failedCount} {t("مفتوح","open")}</Badge>}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("طلبات تنتظر سياسة الاحتفاظ وخطوات المعالجة المعتمدة", "Requests awaiting approved retention rules and processing steps")}
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadRequests()} disabled={loading}>
          <RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("تحديث", "Refresh")}
        </Button>
      </div>

      <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        {t(
          "لا تبدأ هذه الصفحة حذف Auth أو الملفات. التنفيذ سيبقى معطلاً حتى يتم اعتماد قواعد الاحتفاظ والتحقق من خطوات الاسترداد.",
          "This page does not delete Auth users or files. Execution remains disabled until retention rules and recovery steps are approved.",
        )}
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((value)=><Button key={value} size="sm" variant={filter===value?"default":"outline"} onClick={()=>setFilter(value)}>{t(filterLabels[value][0],filterLabels[value][1])}{value==="requested"?` (${requestedCount})`:value==="processing"?` (${processingCount})`:value==="failed"?` (${failedCount})`:""}</Button>)}
        <span className="ms-auto text-sm text-muted-foreground">{requests.length} / {total}</span>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
        </div>
      ) : loadError&&requests.length===0 ? (
        <LoadErrorCard title={t("تعذر تحميل طلبات الحذف","Could not load deletion requests")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadRequests()} />
      ) : requests.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {t("لا توجد طلبات حذف مفتوحة", "No open deletion requests")}
        </Card>
      ) : (
        <>{loadError&&<LoadErrorCard title={t("تعذر تحديث طلبات الحذف","Could not refresh deletion requests")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void loadRequests()} />}<Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-start font-medium">{t("المستخدم", "User")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("الحالة", "Status")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("تاريخ الطلب", "Requested")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("فحص الأهلية", "Eligibility Snapshot")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("الخطوة/الخطأ", "Step / Error")}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id} className="border-b align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{request.user?.full_name || request.user?.email || "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{request.user_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={request.status === "failed" ? "destructive" : "secondary"}>{request.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {new Date(request.requested_at).toLocaleString(language === "ar" ? "ar-SA" : "en-US")}
                    </td>
                    <td className="max-w-sm px-4 py-3">
                      <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">{JSON.stringify(request.eligibility_snapshot, null, 2)}</pre>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-muted-foreground">
                      {request.last_error || request.current_step || t("بانتظار المعالجة", "Awaiting processing")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>{cursor&&requests.length<total&&<div className="text-center"><Button variant="outline" onClick={()=>void loadRequests(cursor,true)} disabled={loadingMore}>{loadingMore?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Requests")}</Button></div>}</>
      )}
    </div>
  )
}
