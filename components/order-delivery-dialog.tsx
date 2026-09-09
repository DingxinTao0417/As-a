"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle, ExternalLink, FileText, Paperclip, RotateCcw, Send, X } from "lucide-react"
import { confirmOrder, getOrderDeliveryRequest, requestOrderRevision, submitOrderDelivery } from "@/app/actions/orders"
import { useLanguage } from "@/components/language-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import {
  MAX_DELIVERY_FILES,
  deliveryFileAllowed,
  deliveryFilePath,
} from "@/lib/delivery-files"

export type DeliveryFile={path:string;name:string;mime:string;size:number}

export type DeliveryOrder = {
  id: string
  status: string
  delivery_version?: number | null
  latest_delivery_note?: string | null
  latest_delivery_links?: string[] | null
  latest_delivery_files?: DeliveryFile[] | null
  latest_revision_reason?: string | null
}

export function OrderDeliveryDialog({
  order,
  role,
  open,
  onOpenChange,
  onUpdated,
}: {
  order: DeliveryOrder | null
  role: "provider" | "seeker"
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated?: () => void | Promise<void>
}) {
  const { t } = useLanguage()
  const { toast } = useToast()
  const [note, setNote] = useState("")
  const [linksText, setLinksText] = useState("")
  const [deliveryFiles,setDeliveryFiles]=useState<File[]>([])
  const [signedFileUrls,setSignedFileUrls]=useState<Record<string,string>>({})
  const [signedFileError,setSignedFileError]=useState<string|null>(null)
  const [signedFileReloadKey,setSignedFileReloadKey]=useState(0)
  const [recoveryPending,setRecoveryPending]=useState(false)
  const [revisionReason, setRevisionReason] = useState("")
  const [showRevision, setShowRevision] = useState(false)
  const [processing, setProcessing] = useState(false)
  const requestId = useRef<string | null>(null)
  const uploadedPaths=useRef(new Set<string>())
  const fileInput=useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setNote("")
    setLinksText("")
    setDeliveryFiles([])
    setRecoveryPending(false)
    uploadedPaths.current.clear()
    setRevisionReason("")
    setShowRevision(false)
    requestId.current = null
  }, [open, order?.id])

  useEffect(()=>{
    let active=true
    setSignedFileUrls({})
    setSignedFileError(null)
    const files=order?.latest_delivery_files||[]
    if(!open||files.length===0)return()=>{active=false}
    void Promise.all(files.map(async(file)=>{
      const { data,error }=await createClient().storage.from("order-deliveries").createSignedUrl(file.path,600)
      return {path:file.path,url:data?.signedUrl||"",error:Boolean(error)}
    })).then((results)=>{
      if(!active)return
      setSignedFileUrls(Object.fromEntries(results.filter((result)=>result.url).map((result)=>[result.path,result.url])))
      if(results.some((result)=>result.error))setSignedFileError(t("تعذر إنشاء بعض روابط الملفات","Some file links could not be created"))
    })
    return()=>{active=false}
  },[open,order?.id,order?.delivery_version,signedFileReloadKey])

  if (!order) return null
  const links = order.latest_delivery_links || []
  const files=order.latest_delivery_files||[]
  const canSubmit = role === "provider" && ["paid", "revision_requested"].includes(order.status)
  const canReview = role === "seeker" && order.status === "awaiting_confirmation"

  const close = () => {
    if (!processing&&!recoveryPending) onOpenChange(false)
  }

  const selectFiles=(selected:File[])=>{
    if(recoveryPending)return
    const next=[...deliveryFiles]
    for(const file of selected){
      if(next.length>=MAX_DELIVERY_FILES){toast({title:t("الحد الأقصى خمسة ملفات","Maximum five files"),variant:"destructive"});break}
      if(!deliveryFileAllowed(file)){
        toast({title:t("ملف غير صالح","Invalid file"),description:t("استخدم PDF أو ZIP أو صورة أو ملف Office/نص حتى 25MB","Use a PDF, ZIP, image, Office, or text file up to 25MB"),variant:"destructive"})
        continue
      }
      if(!next.some((item)=>item.name===file.name&&item.size===file.size&&item.lastModified===file.lastModified))next.push(file)
    }
    setDeliveryFiles(next)
    requestId.current=null
    uploadedPaths.current.clear()
    if(fileInput.current)fileInput.current.value=""
  }

  const cleanupUploads=async(paths:string[])=>{
    if(paths.length===0)return true
    try{
      const { error }=await createClient().storage.from("order-deliveries").remove(paths)
      if(!error){paths.forEach((path)=>uploadedPaths.current.delete(path));return true}
    }catch{
      // A retry must keep the stable paths when the storage outcome is unknown.
    }
    return false
  }

  const submit = async () => {
    const deliveryLinks = [...new Set(
      linksText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    )]
    if (!requestId.current) requestId.current = crypto.randomUUID()
    const stableRequestId=requestId.current
    setProcessing(true)
    try{
      if(recoveryPending){
        const recovered=await getOrderDeliveryRequest(order.id,stableRequestId)
        if(!recovered.success)throw new Error(recovered.error)
        if(recovered.data.delivery){
          uploadedPaths.current.clear()
          setRecoveryPending(false)
          toast({title:t("تم استرداد نتيجة التسليم","Delivery result recovered")})
          onOpenChange(false)
          await onUpdated?.()
          return
        }
        setRecoveryPending(false)
      }
      const supabase=createClient()
      const { data:{user},error:authError }=await supabase.auth.getUser()
      if(authError||!user)throw new Error(t("تعذر التحقق من الجلسة","Could not verify your session"))
      const uploaded:DeliveryFile[]=[]
      for(let index=0;index<deliveryFiles.length;index+=1){
        const file=deliveryFiles[index]
        const path=deliveryFilePath(order.id,user.id,stableRequestId,index,file.type)
        if(!path)throw new Error(t("ملف تسليم غير صالح","Invalid delivery file"))
        const filename=path.split("/").at(-1)!
        const { data:existingFiles,error:listError }=await supabase.storage.from("order-deliveries").list(`${order.id}/${user.id}`,{limit:10,search:filename})
        if(listError)throw new Error(t("تعذر التحقق من ملفات التسليم","Delivery files could not be checked"))
        if(!existingFiles?.some((existing)=>existing.name===filename)){
          const { error }=await supabase.storage.from("order-deliveries").upload(path,file,{contentType:file.type,upsert:false})
          if(error)throw new Error(t("تعذر رفع أحد ملفات التسليم","A delivery file could not be uploaded"))
        }
        uploadedPaths.current.add(path)
        uploaded.push({path,name:file.name,mime:file.type,size:file.size})
      }
      const result = await submitOrderDelivery({orderId:order.id,clientRequestId:stableRequestId,note,links:deliveryLinks,files:uploaded})
      if(!result.success)throw new Error(result.error)
      uploadedPaths.current.clear()
      setRecoveryPending(false)
      toast({ title: t("تم إرسال التسليم", "Delivery submitted") })
      onOpenChange(false)
      await onUpdated?.()
    }catch(error){
      const paths=[...uploadedPaths.current]
      if(paths.length){await cleanupUploads(paths);setRecoveryPending(true)}
      toast({
        title:t("تعذر إرسال التسليم","Delivery could not be submitted"),
        description:paths.length
          ? t("تم رفع ملفات وقد تكون النتيجة غير معروفة. أعد المحاولة دون تغيير النموذج للتحقق","Files were uploaded and the result may be unknown. Retry without changing the form to verify it")
          : error instanceof Error?error.message:t("يرجى المحاولة مرة أخرى","Please try again"),
        variant:"destructive",
      })
    }finally{
      setProcessing(false)
    }
  }

  const confirm = async () => {
    setProcessing(true)
    const result = await confirmOrder(order.id)
    if (result.success) {
      toast({ title: t("تم قبول التسليم", "Delivery accepted") })
      onOpenChange(false)
      await onUpdated?.()
    } else {
      toast({ title: t("تعذر قبول التسليم", "Delivery could not be accepted"), description: result.error, variant: "destructive" })
    }
    setProcessing(false)
  }

  const requestRevision = async () => {
    setProcessing(true)
    const result = await requestOrderRevision(order.id, revisionReason)
    if (result.success) {
      toast({ title: t("تم إرسال طلب التعديل", "Revision request sent") })
      onOpenChange(false)
      await onUpdated?.()
    } else {
      toast({ title: t("تعذر طلب التعديل", "Revision could not be requested"), description: result.error, variant: "destructive" })
    }
    setProcessing(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("تسليم الطلب", "Order Delivery")}</DialogTitle>
          <DialogDescription>
            {canSubmit
              ? t("أضف ملخصاً واضحاً وروابط العمل النهائية", "Add a clear summary and final work links")
              : t("راجع تفاصيل التسليم قبل القبول أو طلب تعديل", "Review the delivery before accepting it or requesting a revision")}
          </DialogDescription>
        </DialogHeader>

        {(order.latest_delivery_note || links.length > 0 || files.length>0) && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <div className="font-medium">
              {t("الإصدار", "Version")} {order.delivery_version || 1}
            </div>
            {order.latest_delivery_note && <p className="whitespace-pre-wrap text-muted-foreground">{order.latest_delivery_note}</p>}
            {links.length > 0 && (
              <ul className="space-y-1.5">
                {links.map((link) => (
                  <li key={link}>
                    <a className="inline-flex max-w-full items-center gap-1 text-primary hover:underline" href={link} target="_blank" rel="noreferrer noopener">
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{link}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {files.length>0&&<div className="space-y-2 border-t pt-3"><div className="font-medium">{t("ملفات خاصة","Private files")}</div>{signedFileError&&<div className="rounded border border-destructive/30 p-2 text-destructive" role="alert">{signedFileError}<Button variant="link" size="sm" onClick={()=>setSignedFileReloadKey((key)=>key+1)}>{t("إعادة المحاولة","Retry")}</Button></div>}<ul className="space-y-1.5">{files.map((file)=><li key={file.path}>{signedFileUrls[file.path]?<a className="inline-flex max-w-full items-center gap-1 text-primary hover:underline" href={signedFileUrls[file.path]} target="_blank" rel="noreferrer noopener"><FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{file.name}</span></a>:<span className="inline-flex items-center gap-1 text-muted-foreground"><FileText className="h-3.5 w-3.5" />{file.name} · {t("الرابط غير متاح","Link unavailable")}</span>}</li>)}</ul></div>}
          </div>
        )}

        {canSubmit && (
          <div className="space-y-4">
            {order.latest_revision_reason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <span className="font-medium">{t("طلب التعديل:", "Revision request:")}</span>{" "}
                {order.latest_revision_reason}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="delivery-note">
                {t("ملخص التسليم", "Delivery summary")}
              </label>
              <Textarea
                id="delivery-note"
                value={note}
                onChange={(event) => { setNote(event.target.value); requestId.current = null }}
                disabled={processing||recoveryPending}
                maxLength={5000}
                rows={5}
                placeholder={t("اشرح ما تم تسليمه وكيفية استخدامه...", "Explain what was delivered and how to use it...")}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="delivery-files">{t("ملفات خاصة (حتى 5 ملفات، 25MB لكل ملف)","Private files (up to 5 files, 25MB each)")}</label>
              <input ref={fileInput} id="delivery-files" type="file" multiple className="hidden" accept=".pdf,.zip,.txt,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx" onChange={(event)=>selectFiles(Array.from(event.target.files||[]))} />
              <Button type="button" variant="outline" onClick={()=>fileInput.current?.click()} disabled={processing||recoveryPending||deliveryFiles.length>=MAX_DELIVERY_FILES}><Paperclip className="me-2 h-4 w-4" />{t("إضافة ملفات","Add Files")}</Button>
              {deliveryFiles.length>0&&<ul className="space-y-1">{deliveryFiles.map((file,index)=><li key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between rounded border px-3 py-2 text-sm"><span className="truncate">{file.name} · {(file.size/1024/1024).toFixed(1)} MB</span><Button type="button" variant="ghost" size="icon" aria-label={t("إزالة الملف","Remove file")} disabled={processing||recoveryPending} onClick={()=>{setDeliveryFiles((current)=>current.filter((_,itemIndex)=>itemIndex!==index));requestId.current=null;uploadedPaths.current.clear()}}><X className="h-4 w-4" /></Button></li>)}</ul>}
              {recoveryPending&&<p className="text-sm text-destructive" role="alert">{t("احتفظ بالنموذج دون تغيير واضغط إرسال مرة أخرى للتحقق من النتيجة","Keep the form unchanged and submit again to recover the result")}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="delivery-links">
                {t("روابط HTTPS، رابط واحد في كل سطر (اختياري)", "HTTPS links, one per line (optional)")}
              </label>
              <Textarea
                id="delivery-links"
                value={linksText}
                onChange={(event) => { setLinksText(event.target.value); requestId.current = null }}
                disabled={processing||recoveryPending}
                rows={3}
                placeholder="https://..."
              />
            </div>
          </div>
        )}

        {canReview && showRevision && (
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="revision-reason">
              {t("التعديل المطلوب", "Requested revision")}
            </label>
            <Textarea
              id="revision-reason"
              value={revisionReason}
              onChange={(event) => setRevisionReason(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder={t("صف التغيير المطلوب بوضوح...", "Describe the required change clearly...")}
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close} disabled={processing||recoveryPending}>{t("إلغاء", "Cancel")}</Button>
          {canSubmit && (
            <Button onClick={() => void submit()} disabled={processing || note.trim().length < 3}>
              <Send className="me-2 h-4 w-4" />
              {processing ? t("جاري الإرسال...", "Submitting...") : t("إرسال التسليم", "Submit Delivery")}
            </Button>
          )}
          {canReview && !showRevision && (
            <>
              <Button variant="outline" onClick={() => setShowRevision(true)} disabled={processing}>
                <RotateCcw className="me-2 h-4 w-4" />
                {t("طلب تعديل", "Request Revision")}
              </Button>
              <Button onClick={() => void confirm()} disabled={processing}>
                <CheckCircle className="me-2 h-4 w-4" />
                {processing ? t("جاري القبول...", "Accepting...") : t("قبول التسليم", "Accept Delivery")}
              </Button>
            </>
          )}
          {canReview && showRevision && (
            <Button onClick={() => void requestRevision()} disabled={processing || revisionReason.trim().length < 3}>
              <RotateCcw className="me-2 h-4 w-4" />
              {processing ? t("جاري الإرسال...", "Sending...") : t("إرسال طلب التعديل", "Send Revision Request")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
