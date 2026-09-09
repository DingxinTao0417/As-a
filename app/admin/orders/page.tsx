"use client"

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/language-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Search, DollarSign, ShieldAlert, Download } from "lucide-react"
import { setUserAdmin, setUserSuspended } from "@/app/actions/admin"
import { exportAdminOrderReport, getAdminOrderPage, getAdminUserPage } from "@/app/actions/operations"
import { useToast } from "@/hooks/use-toast"
import { LoadErrorCard } from "@/components/load-error-card"
import { formatCurrency } from "@/lib/tap"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type OrderRow = {
  id: string
  service_name_ar: string
  service_name_en: string
  amount: number
  status: string
  created_at: string
  paid_at: string | null
  tap_charge_id: string | null
  tap_transaction_id: string | null
  seeker: { email: string; full_name: string | null } | null
  provider: { name_ar: string; name_en: string } | null
}

type UserRow = {
  id: string
  email: string
  full_name: string | null
  role: string
  is_admin: boolean
  suspended_at: string | null
  suspension_reason: string | null
  created_at: string
}

const orderStatusConfig: Record<string, { label: [string, string]; className: string }> = {
  pending: { label: ["معلق", "Pending"], className: "bg-yellow-100 text-yellow-700" },
  paid: { label: ["مدفوع", "Paid"], className: "bg-blue-100 text-blue-700" },
  revision_requested: { label: ["تعديل مطلوب", "Revision Requested"], className: "bg-orange-100 text-orange-700" },
  awaiting_confirmation: { label: ["ينتظر التأكيد", "Awaiting Confirmation"], className: "bg-purple-100 text-purple-700" },
  completed: { label: ["مكتمل", "Completed"], className: "bg-green-100 text-green-700" },
  cancelled: { label: ["ملغي", "Cancelled"], className: "bg-gray-100 text-gray-600" },
  refunded: { label: ["مسترد", "Refunded"], className: "bg-orange-100 text-orange-700" },
}

export default function AdminOrdersPage() {
  const { t, language } = useLanguage()
  const { toast } = useToast()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(true)
  const [orderLoadError, setOrderLoadError] = useState<string | null>(null)
  const [userLoadError, setUserLoadError] = useState<string | null>(null)
  const [orderReloadKey, setOrderReloadKey] = useState(0)
  const [userReloadKey, setUserReloadKey] = useState(0)
  const [orderSearch, setOrderSearch] = useState("")
  const [orderStatus, setOrderStatus] = useState("all")
  const [userSearch, setUserSearch] = useState("")
  const [orderPage, setOrderPage] = useState(1)
  const [userPage, setUserPage] = useState(1)
  const [orderTotal, setOrderTotal] = useState(0)
  const [userTotal, setUserTotal] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null)
  const [suspensionDialog, setSuspensionDialog] = useState<UserRow | null>(null)
  const [suspensionReason, setSuspensionReason] = useState("")
  const [changingSuspension, setChangingSuspension] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer=window.setTimeout(async()=>{
      setOrdersLoading(true)
      const result=await getAdminOrderPage(1,50,orderSearch,orderStatus)
      if (cancelled) return
      if(result.success){setOrders((result.data.orders as Array<Record<string,unknown>>).map((row)=>({
        ...row,
        seeker:{email:String(row.seeker_email||""),full_name:typeof row.seeker_name==="string"?row.seeker_name:null},
        provider:{name_ar:String(row.provider_name_ar||""),name_en:String(row.provider_name_en||"")},
      })) as unknown as OrderRow[]);setOrderTotal(result.data.total);setOrderPage(1);setOrderLoadError(null)}
      else {setOrderLoadError(result.error);toast({title:t("تعذر تحميل الطلبات","Could not load orders"),description:result.error,variant:"destructive"})}
      setOrdersLoading(false)
    },300)
    return()=>{cancelled=true;window.clearTimeout(timer)}
  },[orderSearch,orderStatus,orderReloadKey,t,toast])

  useEffect(() => {
    let cancelled = false
    const timer=window.setTimeout(async()=>{
      setUsersLoading(true)
      const result=await getAdminUserPage(1,50,userSearch)
      if (cancelled) return
      if(result.success){setUsers(result.data.users as unknown as UserRow[]);setUserTotal(result.data.total);setUserPage(1);setUserLoadError(null)}
      else {setUserLoadError(result.error);toast({title:t("تعذر تحميل المستخدمين","Could not load users"),description:result.error,variant:"destructive"})}
      setUsersLoading(false)
    },300)
    return()=>{cancelled=true;window.clearTimeout(timer)}
  },[userSearch,userReloadKey,t,toast])

  const filteredOrders = orders
  const filteredUsers = users

  const loadMoreOrders=async()=>{
    setOrdersLoading(true)
    const next=orderPage+1
    const result=await getAdminOrderPage(next,50,orderSearch,orderStatus)
    if(result.success){
      const mapped=(result.data.orders as Array<Record<string,unknown>>).map((row)=>({
        ...row,seeker:{email:String(row.seeker_email||""),full_name:typeof row.seeker_name==="string"?row.seeker_name:null},
        provider:{name_ar:String(row.provider_name_ar||""),name_en:String(row.provider_name_en||"")},
      })) as unknown as OrderRow[]
      setOrders((current)=>[...current,...mapped]);setOrderPage(next)
    }else toast({title:t("تعذر تحميل طلبات أقدم","Could not load older orders"),description:result.error,variant:"destructive"})
    setOrdersLoading(false)
  }

  const loadMoreUsers=async()=>{
    setUsersLoading(true)
    const next=userPage+1
    const result=await getAdminUserPage(next,50,userSearch)
    if(result.success){setUsers((current)=>[...current,...result.data.users as unknown as UserRow[]]);setUserPage(next)}
    else toast({title:t("تعذر تحميل مستخدمين إضافيين","Could not load more users"),description:result.error,variant:"destructive"})
    setUsersLoading(false)
  }

  const exportOrders=async()=>{
    setExporting(true)
    const result=await exportAdminOrderReport(orderSearch,orderStatus)
    if(result.success){
      const blob=new Blob([JSON.stringify(result.data.report,null,2)],{type:"application/json"})
      const url=URL.createObjectURL(blob)
      const anchor=document.createElement("a");anchor.href=url;anchor.download=`asaa-orders-${new Date().toISOString().slice(0,10)}.json`;anchor.click();URL.revokeObjectURL(url)
    }else toast({title:t("تعذر تصدير الطلبات","Could not export orders"),description:result.error,variant:"destructive"})
    setExporting(false)
  }

  const handleToggleAdmin = async (user: UserRow) => {
    setTogglingAdmin(user.id)
    try {
      const result = await setUserAdmin(user.id, !user.is_admin)
      if (!result.success) {
        toast({ title: t("فشل الحفظ", "Save failed"), description: result.error, variant: "destructive" })
        return
      }
      setUsers((prev) =>
        prev.map((u) => u.id === user.id ? { ...u, is_admin: !u.is_admin } : u)
      )
      toast({ title: t("تم حفظ صلاحيات المستخدم", "User access saved") })
    } finally {
      setTogglingAdmin(null)
    }
  }

  const handleSuspension = async () => {
    if (!suspensionDialog) return
    setChangingSuspension(true)
    const suspended = !suspensionDialog.suspended_at
    const result = await setUserSuspended(suspensionDialog.id, suspended, suspensionReason)
    if (result.success) {
      setUsers((current) => current.map((user) => user.id === suspensionDialog.id
        ? {
            ...user,
            suspended_at: suspended ? new Date().toISOString() : null,
            suspension_reason: suspended ? suspensionReason.trim() : null,
          }
        : user))
      setSuspensionDialog(null)
      setSuspensionReason("")
      toast({ title: suspended ? t("تم إيقاف الحساب", "Account suspended") : t("تمت استعادة الحساب", "Account restored") })
    } else {
      toast({ title: t("فشل الحفظ", "Save failed"), description: result.error, variant: "destructive" })
    }
    setChangingSuspension(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("الطلبات والمستخدمون", "Orders & Users")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("مراقبة جميع الطلبات وإدارة المستخدمين", "Monitor all orders and manage users")}
        </p>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">{t("الطلبات", "Orders")}</TabsTrigger>
          <TabsTrigger value="users">{t("المستخدمون", "Users")}</TabsTrigger>
        </TabsList>

        {/* Orders Tab */}
        <TabsContent value="orders" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="ps-9 w-64"
                placeholder={t("بحث بالخدمة أو المستخدم...", "Search by service or user...")}
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
              />
            </div>
            <select
              aria-label={t("تصفية حسب حالة الطلب", "Filter by order status")}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={orderStatus}
              onChange={(event)=>setOrderStatus(event.target.value)}
            >
              <option value="all">{t("جميع الحالات","All statuses")}</option>
              {Object.entries(orderStatusConfig).map(([status,config])=><option key={status} value={status}>{t(config.label[0],config.label[1])}</option>)}
            </select>
            <Button variant="outline" onClick={()=>void exportOrders()} disabled={exporting}><Download className="me-2 h-4 w-4" />{exporting?t("جاري التصدير...","Exporting..."):t("تصدير","Export")}</Button>
            <span className="text-sm text-muted-foreground">
              {orderLoadError ? "—" : `${filteredOrders.length} / ${orderTotal}`} {t("طلب", "orders")}
            </span>
          </div>

          {ordersLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
            </div>
          ) : orderLoadError ? (
            <LoadErrorCard title={t("تعذر تحميل الطلبات","Could not load orders")} description={orderLoadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>setOrderReloadKey((key)=>key+1)} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-start px-4 py-3 font-medium">{t("الخدمة", "Service")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("العميل", "Client")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("مقدم الخدمة", "Provider")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("المبلغ", "Amount")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("الحالة", "Status")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("تاريخ الطلب", "Created")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                          {t("لا توجد طلبات", "No orders found")}
                        </td>
                      </tr>
                    ) : filteredOrders.map((order) => {
                      const cfg = orderStatusConfig[order.status] || { label: [order.status, order.status], className: "bg-gray-100 text-gray-600" }
                      const providerName = order.provider
                        ? language === "ar" ? order.provider.name_ar : order.provider.name_en
                        : "—"
                      return (
                        <tr key={order.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium">
                            <span className="line-clamp-1">
                              {language === "ar" ? order.service_name_ar : order.service_name_en}
                            </span>
                            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{order.id}</div>
                            {(order.tap_charge_id || order.tap_transaction_id) && (
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {order.tap_charge_id || order.tap_transaction_id}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <div>{order.seeker?.full_name || "—"}</div>
                            <div className="text-xs">{order.seeker?.email}</div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{providerName}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 font-semibold text-primary">
                              <DollarSign className="h-3.5 w-3.5" />
                              {formatCurrency(Number(order.amount||0),language)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={cfg.className}>
                              {t(cfg.label[0], cfg.label[1])}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(order.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {!orderLoadError&&orders.length<orderTotal&&<div className="text-center"><Button variant="outline" onClick={()=>void loadMoreOrders()} disabled={ordersLoading}>{t("تحميل المزيد","Load More")}</Button></div>}
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="ps-9 w-64"
                placeholder={t("بحث بالاسم أو البريد...", "Search by name or email...")}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {userLoadError ? "—" : `${filteredUsers.length} / ${userTotal}`} {t("مستخدم", "users")}
            </span>
          </div>

          {usersLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
            </div>
          ) : userLoadError ? (
            <LoadErrorCard title={t("تعذر تحميل المستخدمين","Could not load users")} description={userLoadError} retryLabel={t("إعادة المحاولة","Retry")} onRetry={()=>setUserReloadKey((key)=>key+1)} />
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-start px-4 py-3 font-medium">{t("المستخدم", "User")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("البريد الإلكتروني", "Email")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("الدور", "Role")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("تاريخ التسجيل", "Joined")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("الحساب", "Account")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("مشرف", "Admin")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("إجراء", "Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                          {t("لا يوجد مستخدمون", "No users found")}
                        </td>
                      </tr>
                    ) : filteredUsers.map((user) => (
                      <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{user.full_name || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                        <td className="px-4 py-3">
                          <Badge variant={user.role === "provider" ? "default" : "secondary"}>
                            {user.role === "provider" ? t("مقدم خدمة", "Provider") : t("باحث", "Seeker")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(user.created_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                        </td>
                        <td className="px-4 py-3">
                          {user.suspended_at ? (
                            <Badge variant="destructive" title={user.suspension_reason || undefined}>
                              {t("موقوف", "Suspended")}
                            </Badge>
                          ) : (
                            <Badge variant="outline">{t("نشط", "Active")}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {user.is_admin ? (
                            <Badge className="bg-purple-100 text-purple-700 gap-1">
                              <ShieldAlert className="h-3 w-3" />
                              {t("مشرف", "Admin")}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">{t("لا", "No")}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant={user.is_admin ? "outline" : "ghost"}
                              className={user.is_admin ? "text-destructive hover:text-destructive" : ""}
                              onClick={() => handleToggleAdmin(user)}
                              disabled={togglingAdmin === user.id || !!user.suspended_at}
                            >
                              {user.is_admin ? t("إلغاء الإدارة", "Remove Admin") : t("منح الإدارة", "Make Admin")}
                            </Button>
                            <Button
                              size="sm"
                              variant={user.suspended_at ? "outline" : "destructive"}
                              onClick={() => { setSuspensionDialog(user); setSuspensionReason("") }}
                              disabled={user.is_admin}
                              title={user.is_admin ? t("قم بإزالة صلاحية المشرف أولاً", "Remove administrator access first") : undefined}
                            >
                              {user.suspended_at ? t("استعادة", "Restore") : t("إيقاف", "Suspend")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {!userLoadError&&users.length<userTotal&&<div className="text-center"><Button variant="outline" onClick={()=>void loadMoreUsers()} disabled={usersLoading}>{t("تحميل المزيد","Load More")}</Button></div>}
        </TabsContent>
      </Tabs>

      <Dialog open={!!suspensionDialog} onOpenChange={(open) => !open && !changingSuspension && setSuspensionDialog(null)}>
        {suspensionDialog && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {suspensionDialog.suspended_at
                  ? t("استعادة الحساب", "Restore Account")
                  : t("إيقاف الحساب", "Suspend Account")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {suspensionDialog.full_name || suspensionDialog.email}
              </p>
              <div>
                <label htmlFor="account-status-reason" className="mb-1.5 block text-sm font-medium">
                  {t("سبب التغيير", "Reason for change")}
                </label>
                <Textarea
                  id="account-status-reason"
                  value={suspensionReason}
                  onChange={(event) => setSuspensionReason(event.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder={t("اكتب سبباً واضحاً لسجل التدقيق...", "Enter a clear reason for the audit record...")}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSuspensionDialog(null)} disabled={changingSuspension}>
                {t("إلغاء", "Cancel")}
              </Button>
              <Button
                variant={suspensionDialog.suspended_at ? "default" : "destructive"}
                onClick={() => void handleSuspension()}
                disabled={changingSuspension || suspensionReason.trim().length < 3}
              >
                {changingSuspension
                  ? t("جاري الحفظ...", "Saving...")
                  : suspensionDialog.suspended_at
                    ? t("تأكيد الاستعادة", "Confirm Restore")
                    : t("تأكيد الإيقاف", "Confirm Suspension")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
