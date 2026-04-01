"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useLanguage } from "@/components/language-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Search, DollarSign, ShieldAlert } from "lucide-react"

type OrderRow = {
  id: string
  service_name_ar: string
  service_name_en: string
  amount_cents: number
  status: string
  created_at: string
  paid_at: string | null
  seeker: { email: string; full_name: string | null } | null
  provider: { name_ar: string; name_en: string } | null
}

type UserRow = {
  id: string
  email: string
  full_name: string | null
  role: string
  is_admin: boolean
  created_at: string
}

const orderStatusConfig: Record<string, { label: [string, string]; className: string }> = {
  pending: { label: ["معلق", "Pending"], className: "bg-yellow-100 text-yellow-700" },
  paid: { label: ["مدفوع", "Paid"], className: "bg-blue-100 text-blue-700" },
  awaiting_confirmation: { label: ["ينتظر التأكيد", "Awaiting Confirmation"], className: "bg-purple-100 text-purple-700" },
  completed: { label: ["مكتمل", "Completed"], className: "bg-green-100 text-green-700" },
  cancelled: { label: ["ملغي", "Cancelled"], className: "bg-gray-100 text-gray-600" },
  refunded: { label: ["مسترد", "Refunded"], className: "bg-orange-100 text-orange-700" },
}

export default function AdminOrdersPage() {
  const { t, language } = useLanguage()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [usersLoading, setUsersLoading] = useState(true)
  const [orderSearch, setOrderSearch] = useState("")
  const [userSearch, setUserSearch] = useState("")
  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null)

  useEffect(() => {
    async function fetchOrders() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id, service_name_ar, service_name_en, amount_cents, status, created_at, paid_at,
          seeker:profiles!orders_seeker_id_fkey(email, full_name),
          provider:providers!orders_provider_id_fkey(name_ar, name_en)
        `)
        .order("created_at", { ascending: false })
        .limit(200)
      if (error) console.error("[admin] orders fetch error:", error)
      setOrders((data as unknown as OrderRow[]) || [])
      setOrdersLoading(false)
    }

    async function fetchUsers() {
      const supabase = createClient()
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, is_admin, created_at")
        .order("created_at", { ascending: false })
      setUsers((data as UserRow[]) || [])
      setUsersLoading(false)
    }

    fetchOrders()
    fetchUsers()
  }, [])

  const filteredOrders = orders.filter((o) => {
    if (orderSearch === "") return true
    const name = language === "ar" ? o.service_name_ar : o.service_name_en
    const seekerEmail = o.seeker?.email || ""
    return (
      name.toLowerCase().includes(orderSearch.toLowerCase()) ||
      seekerEmail.toLowerCase().includes(orderSearch.toLowerCase())
    )
  })

  const filteredUsers = users.filter((u) => {
    if (userSearch === "") return true
    return (
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.full_name || "").toLowerCase().includes(userSearch.toLowerCase())
    )
  })

  const handleToggleAdmin = async (user: UserRow) => {
    setTogglingAdmin(user.id)
    const supabase = createClient()
    await supabase.from("profiles").update({ is_admin: !user.is_admin }).eq("id", user.id)
    setUsers((prev) =>
      prev.map((u) => u.id === user.id ? { ...u, is_admin: !u.is_admin } : u)
    )
    setTogglingAdmin(null)
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
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="ps-9 w-64"
                placeholder={t("بحث بالخدمة أو المستخدم...", "Search by service or user...")}
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {filteredOrders.length} {t("طلب", "orders")}
            </span>
          </div>

          {ordersLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
            </div>
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
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <div>{order.seeker?.full_name || "—"}</div>
                            <div className="text-xs">{order.seeker?.email}</div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{providerName}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 font-semibold text-primary">
                              <DollarSign className="h-3.5 w-3.5" />
                              {(order.amount_cents / 100).toFixed(2)}
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
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="mt-6 space-y-4">
          <div className="flex items-center gap-3">
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
              {filteredUsers.length} {t("مستخدم", "users")}
            </span>
          </div>

          {usersLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
            </div>
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
                      <th className="text-start px-4 py-3 font-medium">{t("مشرف", "Admin")}</th>
                      <th className="text-start px-4 py-3 font-medium">{t("إجراء", "Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
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
                          <Button
                            size="sm"
                            variant={user.is_admin ? "outline" : "ghost"}
                            className={user.is_admin ? "text-destructive hover:text-destructive" : ""}
                            onClick={() => handleToggleAdmin(user)}
                            disabled={togglingAdmin === user.id}
                          >
                            {user.is_admin ? t("إلغاء الإدارة", "Remove Admin") : t("منح الإدارة", "Make Admin")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
