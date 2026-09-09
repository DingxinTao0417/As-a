"use client"

import { useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useLanguage } from "@/components/language-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Search, Star, ExternalLink } from "lucide-react"
import {
  getAdminProviderVerificationRequests,
  reviewProviderVerification,
  revokeProviderVerification,
  type VerificationCursor,
  type VerificationRequest,
} from "@/app/actions/verification"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"
import { Textarea } from "@/components/ui/textarea"
import {
  getAdminProviderPage,
  type AdminProviderCursor,
  type AdminProviderFilter,
  type AdminProviderRow,
} from "@/app/actions/operations"

const filterOptions:AdminProviderFilter[] = ["all", "verified", "unverified"]

export default function AdminProvidersPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [providers, setProviders] = useState<AdminProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMoreProviders,setLoadingMoreProviders]=useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [providerCursor,setProviderCursor]=useState<AdminProviderCursor|null>(null)
  const [providerTotal,setProviderTotal]=useState(0)
  const providerRequestVersion=useRef(0)
  const [filter, setFilter] = useState<AdminProviderFilter>("unverified")
  const [search, setSearch] = useState("")
  const [detail, setDetail] = useState<AdminProviderRow | null>(null)
  const [verificationRequests,setVerificationRequests]=useState<VerificationRequest[]>([])
  const [verificationLoading,setVerificationLoading]=useState(true)
  const [verificationCursor,setVerificationCursor]=useState<VerificationCursor|null>(null)
  const [verificationTotal,setVerificationTotal]=useState(0)
  const [loadingMoreVerification,setLoadingMoreVerification]=useState(false)
  const [signedUrls,setSignedUrls]=useState<Record<string,string>>({})
  const [reviewing,setReviewing]=useState<{request:VerificationRequest;decision:"approved"|"rejected"}|null>(null)
  const [revoking,setRevoking]=useState<AdminProviderRow|null>(null)
  const [reviewNote,setReviewNote]=useState("")
  const [savingReview,setSavingReview]=useState(false)

  async function signVerificationDocuments(requests:VerificationRequest[]){
    const documents=requests.flatMap((request)=>request.documents||[])
    const pairs=await Promise.all(documents.map(async(document)=>{
      const {data:signed}=await createClient().storage.from("provider-verification").createSignedUrl(document.path,600)
      return [document.path,signed?.signedUrl||""] as const
    }))
    return Object.fromEntries(pairs.filter((pair)=>pair[1]))
  }

  async function fetchProviderPage(cursor:AdminProviderCursor|null=null,append=false){
    const version=append?providerRequestVersion.current:++providerRequestVersion.current
    if(append)setLoadingMoreProviders(true);else{setLoading(true);setLoadingMoreProviders(false);setLoadError(null)}
    const result=await getAdminProviderPage(search,filter,cursor)
    if(version!==providerRequestVersion.current)return
    if(!result.success){
      if(!append)setLoadError(result.error)
      toast({title:t("تعذر تحميل مقدمي الخدمات","Could not load providers"),description:result.error,variant:"destructive"})
    }else{
      setProviders((current)=>append?[...current,...result.data.providers.filter((provider)=>!current.some((item)=>item.id===provider.id))]:result.data.providers)
      setProviderCursor(result.data.nextCursor)
      if(!append||result.data.providers.length>0)setProviderTotal(result.data.total)
      setLoadError(null)
    }
    if(append)setLoadingMoreProviders(false);else setLoading(false)
  }

  async function fetchVerificationRequests(){
    setVerificationLoading(true)
    const result=await getAdminProviderVerificationRequests()
    if(!result.success){
      toast({title:t("تعذر تحميل طلبات التوثيق","Could not load verification requests"),description:result.error,variant:"destructive"})
      setVerificationLoading(false)
      return
    }
    setVerificationRequests(result.data.requests)
    setVerificationCursor(result.data.nextCursor)
    setVerificationTotal(result.data.total)
    setSignedUrls(await signVerificationDocuments(result.data.requests))
    setVerificationLoading(false)
  }

  async function refreshAfterDecision(){
    await Promise.all([fetchProviderPage(),fetchVerificationRequests()])
  }

  async function loadMoreVerificationRequests(){
    if(!verificationCursor||loadingMoreVerification)return
    setLoadingMoreVerification(true)
    const result=await getAdminProviderVerificationRequests(verificationCursor)
    if(!result.success){
      toast({title:t("تعذر تحميل طلبات أقدم","Could not load older requests"),description:result.error,variant:"destructive"})
      setLoadingMoreVerification(false)
      return
    }
    const additions=result.data.requests.filter((request)=>!verificationRequests.some((item)=>item.id===request.id))
    const newSignedUrls=await signVerificationDocuments(additions)
    setVerificationRequests((current)=>[...current,...additions])
    setSignedUrls((current)=>({...current,...newSignedUrls}))
    setVerificationCursor(result.data.nextCursor)
    setVerificationTotal(result.data.total)
    setLoadingMoreVerification(false)
  }

  useEffect(()=>{void fetchVerificationRequests()},[])
  useEffect(()=>{
    const timeout=window.setTimeout(()=>{void fetchProviderPage()},300)
    return()=>window.clearTimeout(timeout)
  },[search,filter])

  const saveReview=async()=>{
    if(!reviewing)return
    setSavingReview(true)
    const result=await reviewProviderVerification(reviewing.request.id,reviewing.decision,reviewNote)
    if(result.success){setReviewing(null);setReviewNote("");toast({title:t("تم حفظ قرار التوثيق","Verification decision saved")});await refreshAfterDecision()}
    else toast({title:t("تعذر حفظ القرار","Could not save decision"),description:result.error,variant:"destructive"})
    setSavingReview(false)
  }
  const saveRevocation=async()=>{
    if(!revoking)return
    setSavingReview(true)
    const result=await revokeProviderVerification(revoking.id,reviewNote)
    if(result.success){setRevoking(null);setReviewNote("");toast({title:t("تم إلغاء التوثيق","Verification removed")});await refreshAfterDecision()}
    else toast({title:t("تعذر إلغاء التوثيق","Could not remove verification"),description:result.error,variant:"destructive"})
    setSavingReview(false)
  }

  const filterLabels: Record<AdminProviderFilter, [string, string]> = {
    all: ["الكل", "All"],
    verified: ["موثق", "Verified"],
    unverified: ["غير موثق", "Unverified"],
  }

  const tapStatusColor = (status: string | null) => {
    switch (status) {
      case "active": return "bg-green-100 text-green-700"
      case "not_connected": return "bg-gray-100 text-gray-600"
      default: return "bg-yellow-100 text-yellow-700"
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
      </div>
    )
  }

  if(loadError){return <LoadErrorCard title={t("تعذر تحميل مقدمي الخدمات","Could not load providers")} description={loadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>void fetchProviderPage()} />}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("توثيق مقدمي الخدمة", "Provider Verification")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("مراجعة ملفات مقدمي الخدمة وتوثيقهم", "Review provider profiles and verify them")}
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="pending-verification-requests">
        <h2 id="pending-verification-requests" className="text-lg font-semibold">{t("طلبات التوثيق المعلقة","Pending Verification Requests")}</h2>
        {verificationLoading?<div className="flex h-20 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-r-transparent"/></div>:verificationRequests.filter((request)=>request.status==="pending").length===0?<Card className="p-6 text-center text-muted-foreground">{t("لا توجد طلبات معلقة","No pending requests")}</Card>:verificationRequests.filter((request)=>request.status==="pending").map((request)=><Card key={request.id} className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{language==="ar"?request.provider_name_ar:request.provider_name_en}</h3><p className="text-xs text-muted-foreground">{new Date(request.created_at).toLocaleString(language==="ar"?"ar-SA":"en-US")}</p></div><Badge>{t("بانتظار المراجعة","Pending Review")}</Badge></div>{request.note&&<p className="text-sm">{request.note}</p>}<div className="flex flex-wrap gap-2">{request.documents.map((document)=>signedUrls[document.path]?<a key={document.path} href={signedUrls[document.path]} target="_blank" rel="noreferrer noopener" className="rounded border px-2 py-1 text-sm text-primary hover:underline">{document.name}</a>:<span key={document.path} className="rounded border px-2 py-1 text-sm text-muted-foreground">{document.name} · {t("الرابط غير متاح","Link unavailable")}</span>)}</div><div className="flex gap-2"><Button size="sm" onClick={()=>{setReviewing({request,decision:"approved"});setReviewNote("")}}>{t("موافقة","Approve")}</Button><Button size="sm" variant="destructive" onClick={()=>{setReviewing({request,decision:"rejected"});setReviewNote("")}}>{t("رفض","Reject")}</Button></div></Card>)}
        {verificationCursor&&verificationRequests.length<verificationTotal&&<div className="text-center"><Button variant="outline" onClick={()=>void loadMoreVerificationRequests()} disabled={loadingMoreVerification}>{loadingMoreVerification?t("جاري التحميل...","Loading..."):t("تحميل طلبات أقدم","Load Older Requests")}</Button></div>}
      </section>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          {filterOptions.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {t(filterLabels[f][0], filterLabels[f][1])}
            </Button>
          ))}
        </div>
        <div className="relative ms-auto">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="ps-9 w-56"
            placeholder={t("بحث...", "Search...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground">{providers.length} / {providerTotal}</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-start px-4 py-3 font-medium">{t("مقدم الخدمة", "Provider")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الفئة", "Category")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("التقييم", "Rating")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("المشاريع", "Projects")}</th>
                <th className="text-start px-4 py-3 font-medium">Tap Payment</th>
                <th className="text-start px-4 py-3 font-medium">{t("تاريخ الانضمام", "Joined")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("الحالة", "Status")}</th>
                <th className="text-start px-4 py-3 font-medium">{t("إجراء", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    {t("لا يوجد مقدمو خدمة", "No providers found")}
                  </td>
                </tr>
              ) : providers.map((provider) => {
                const name = language === "ar" ? provider.name_ar : provider.name_en
                return (
                  <tr key={provider.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarImage src={provider.avatar_url || ""} />
                          <AvatarFallback>{name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{name}</div>
                          <div className="text-xs text-muted-foreground">
                            {language === "ar" ? provider.title_ar : provider.title_en}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{provider.category}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-primary text-primary" />
                        <span>{provider.rating?.toFixed(1)}</span>
                        <span className="text-muted-foreground">({provider.reviews_count})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{provider.completed_projects}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${tapStatusColor(provider.tap_account_status)}`}>
                          {provider.tap_account_status || "not_connected"}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {t("تحصيل","Charges")}: {provider.tap_charges_enabled?t("نعم","Yes"):t("لا","No")} · {t("سحب","Payouts")}: {provider.tap_payouts_enabled?t("نعم","Yes"):t("لا","No")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {provider.tap_status_checked_at
                            ?new Date(provider.tap_status_checked_at).toLocaleString(language==="ar"?"ar-SA":"en-US")
                            :t("لم يتم التحقق خارجياً","Not externally checked")}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(provider.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                    </td>
                    <td className="px-4 py-3">
                      {provider.is_verified ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200">
                          {t("موثق", "Verified")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("غير موثق", "Unverified")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDetail(provider)}>
                          {t("تفاصيل", "Details")}
                        </Button>
                        {provider.is_verified?<Button size="sm" variant="outline" onClick={()=>{setRevoking(provider);setReviewNote("")}}>{t("إلغاء التوثيق","Unverify")}</Button>:verificationRequests.some((request)=>request.provider_id===provider.id&&request.status==="pending")?<Button size="sm" onClick={()=>{const request=verificationRequests.find((item)=>item.provider_id===provider.id&&item.status==="pending")!;setReviewing({request,decision:"approved"});setReviewNote("")}}>{t("مراجعة الطلب","Review Request")}</Button>:<Button size="sm" variant="outline" disabled>{t("لا يوجد طلب","No Request")}</Button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {providerCursor&&providers.length<providerTotal&&<div className="text-center"><Button variant="outline" onClick={()=>void fetchProviderPage(providerCursor,true)} disabled={loadingMoreProviders}>{loadingMoreProviders?t("جاري التحميل...","Loading..."):t("تحميل مقدمي خدمة أقدم","Load Older Providers")}</Button></div>}

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        {detail && (
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={detail.avatar_url || ""} />
                  <AvatarFallback>
                    {(language === "ar" ? detail.name_ar : detail.name_en).charAt(0)}
                  </AvatarFallback>
                </Avatar>
                {language === "ar" ? detail.name_ar : detail.name_en}
                {detail.is_verified && (
                  <Badge className="bg-green-100 text-green-700">{t("موثق", "Verified")}</Badge>
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Title & Bio */}
              <div>
                <div className="text-sm font-medium text-muted-foreground">{t("المسمى الوظيفي", "Title")}</div>
                <div>{language === "ar" ? detail.title_ar : detail.title_en}</div>
              </div>
              {(language === "ar" ? detail.bio_ar : detail.bio_en) && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">{t("نبذة", "Bio")}</div>
                  <p className="text-sm leading-relaxed">
                    {language === "ar" ? detail.bio_ar : detail.bio_en}
                  </p>
                </div>
              )}
              {/* Skills */}
              {detail.skills?.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">{t("المهارات", "Skills")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.skills.map((s, i) => <Badge key={i} variant="outline">{s}</Badge>)}
                  </div>
                </div>
              )}
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xl font-bold">{detail.rating?.toFixed(1)}</div>
                  <div className="text-xs text-muted-foreground">{t("التقييم", "Rating")}</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xl font-bold">{detail.reviews_count}</div>
                  <div className="text-xs text-muted-foreground">{t("التقييمات", "Reviews")}</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xl font-bold">{detail.completed_projects}</div>
                  <div className="text-xs text-muted-foreground">{t("المشاريع", "Projects")}</div>
                </div>
              </div>
              {/* Portfolio */}
              {detail.portfolio_urls?.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">{t("أعمال سابقة", "Portfolio")}</div>
                  <div className="space-y-1">
                    {detail.portfolio_urls.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {/* Action */}
              <div className="pt-2 border-t flex justify-end">
                {detail.is_verified?<Button variant="outline" onClick={()=>{setRevoking(detail);setDetail(null);setReviewNote("")}}>{t("إلغاء التوثيق","Remove Verification")}</Button>:<span className="text-sm text-muted-foreground">{t("تتطلب الموافقة طلباً مع مستندات","Approval requires a request with documents")}</span>}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!reviewing} onOpenChange={(open)=>!open&&!savingReview&&setReviewing(null)}>{reviewing&&<DialogContent><DialogHeader><DialogTitle>{reviewing.decision==="approved"?t("الموافقة على التوثيق","Approve Verification"):t("رفض التوثيق","Reject Verification")}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{language==="ar"?reviewing.request.provider_name_ar:reviewing.request.provider_name_en}</p><div><label htmlFor="verification-review-note" className="mb-1 block text-sm font-medium">{t("سبب القرار","Decision reason")}</label><Textarea id="verification-review-note" value={reviewNote} maxLength={2000} rows={4} onChange={(event)=>setReviewNote(event.target.value)}/></div><DialogFooter><Button variant="outline" onClick={()=>setReviewing(null)} disabled={savingReview}>{t("إلغاء","Cancel")}</Button><Button variant={reviewing.decision==="approved"?"default":"destructive"} onClick={()=>void saveReview()} disabled={savingReview||reviewNote.trim().length<3}>{savingReview?t("جاري الحفظ...","Saving..."):t("حفظ القرار","Save Decision")}</Button></DialogFooter></DialogContent>}</Dialog>
      <Dialog open={!!revoking} onOpenChange={(open)=>!open&&!savingReview&&setRevoking(null)}>{revoking&&<DialogContent><DialogHeader><DialogTitle>{t("إلغاء توثيق مقدم الخدمة","Remove Provider Verification")}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{language==="ar"?revoking.name_ar:revoking.name_en}</p><div><label htmlFor="verification-revoke-note" className="mb-1 block text-sm font-medium">{t("سبب الإلغاء","Revocation reason")}</label><Textarea id="verification-revoke-note" value={reviewNote} maxLength={2000} rows={4} onChange={(event)=>setReviewNote(event.target.value)}/></div><DialogFooter><Button variant="outline" onClick={()=>setRevoking(null)} disabled={savingReview}>{t("إلغاء","Cancel")}</Button><Button variant="destructive" onClick={()=>void saveRevocation()} disabled={savingReview||reviewNote.trim().length<3}>{savingReview?t("جاري الحفظ...","Saving..."):t("تأكيد الإلغاء","Confirm Removal")}</Button></DialogFooter></DialogContent>}</Dialog>
    </div>
  )
}
