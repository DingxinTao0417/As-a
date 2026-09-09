"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useLanguage } from "@/components/language-provider"
import Image from "next/image"
import {
  MessageCircle,
  Send,
  Search,
  ArrowLeft,
  MoreVertical,
  Pin,
  Trash2,
  X,
  DollarSign,
  CheckCircle,
  Eye,
  Briefcase,
  ExternalLink,
  AlertCircle,
} from "lucide-react"
import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter, useSearchParams } from "next/navigation"
import { Avatar } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CreateOrderDialog } from "@/components/create-order-dialog"
import { OrderDeliveryDialog } from "@/components/order-delivery-dialog"
import {
  createPaymentCharge,getConversationOrders,verifyPayment,
  type ConversationOrderCursor,
} from "@/app/actions/orders"
import { formatCurrency } from "@/lib/tap"
import { useToast } from "@/hooks/use-toast"
import type { RealtimeChannel } from "@supabase/supabase-js"
import {
  getConversationPage,
  markConversationRead,
  getConversationMessages,
  openProviderConversation,
  sendConversationMessage,
  sendServiceCardMessage,
  setConversationPreference,
} from "@/app/actions/messages"
import {
  getPublicProviderServices,
  type PublicProviderService,
  type PublicProviderServiceCursor,
} from "@/app/actions/catalog"
import { getCurrentProviderContext } from "@/app/actions/providers"

const formatRelativeTime = (date: Date) => {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (diffSeconds < 60) return "now"
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

type Conversation = {
  id: string
  provider_id: string
  seeker_id: string
  last_message_at: string
  other_party_name_ar: string
  other_party_name_en: string
  other_party_avatar: string
  is_provider: boolean
  is_pinned: boolean
  is_archived: boolean
  cleared_at: string | null
  unread_count: number
}

type Message = {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  created_at: string
  is_read: boolean
}

type Order = {
  id: string
  conversation_id: string
  seeker_id: string
  provider_id: string
  service_name_ar: string
  service_name_en: string
  service_description_ar?: string
  service_description_en?: string
  amount: number
  platform_fee: number
  provider_amount: number
  status: string
  created_at: string
  paid_at?: string
  completed_at?: string
  delivery_version?: number
  latest_delivery_note?: string | null
  latest_delivery_links?: string[]
  latest_delivery_files?: Array<{path:string;name:string;mime:string;size:number}>
  latest_revision_reason?: string | null
}

type ServiceCard = {
  __type: "service_card"
  id: string
  name_ar: string
  name_en: string
  description_ar: string
  description_en: string
  price: number
  price_type: string
  category: string
  image_url: string
}

type ProviderService=PublicProviderService

export default function MessagesPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [user, setUser] = useState<any>(null)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [currentProviderId,setCurrentProviderId]=useState<string|null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [newMessage, setNewMessage] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [orderCursor,setOrderCursor]=useState<ConversationOrderCursor|null>(null)
  const [orderTotal,setOrderTotal]=useState(0)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [showCreateOrder, setShowCreateOrder] = useState(false)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [processedProviderId, setProcessedProviderId] = useState<string | null>(null)
  const [showServicesPanel, setShowServicesPanel] = useState(false)
  const [providerServices, setProviderServices] = useState<ProviderService[]>([])
  const [providerServiceCursor,setProviderServiceCursor]=useState<PublicProviderServiceCursor|null>(null)
  const [providerServiceTotal,setProviderServiceTotal]=useState(0)
  const [loadingMoreServices,setLoadingMoreServices]=useState(false)
  const [loadingServices, setLoadingServices] = useState(false)
  const [servicesError, setServicesError] = useState<string | null>(null)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [sendingServiceId, setSendingServiceId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [conversationCursor, setConversationCursor] = useState<{ pinned: boolean; lastMessageAt: string; id: string } | null>(null)
  const [conversationTotal, setConversationTotal] = useState(0)
  const [conversationsLoading, setConversationsLoading] = useState(true)
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
  const [conversationsError, setConversationsError] = useState<string | null>(null)
  const [messageCursor, setMessageCursor] = useState<{ createdAt: string; id: string } | null>(null)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")
  const pendingMessageRequestId = useRef<string | null>(null)
  const pendingServiceRequestIds = useRef(new Map<string, string>())
  const conversationRequestId = useRef(0)
  const [orderPrefill, setOrderPrefill] = useState<{
    serviceNameAr: string; serviceNameEn: string
    serviceDescriptionAr: string; serviceDescriptionEn: string
    amount: string
  } | null>(null)
  
  // Realtime subscriptions
  const messagesChannelRef = useRef<RealtimeChannel | null>(null)
  const conversationsChannelRef = useRef<RealtimeChannel | null>(null)
  const ordersChannelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const supabase = createClient()

    // Listen for auth state changes — redirect to login on sign-out or token errors
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "SIGNED_OUT") {
        router.push("/auth/login")
      }
    })

    checkAuthAndFetchData()

    // Cleanup subscriptions on unmount
    return () => {
      subscription.unsubscribe()
      if (messagesChannelRef.current) {
        messagesChannelRef.current.unsubscribe()
      }
      if (conversationsChannelRef.current) {
        conversationsChannelRef.current.unsubscribe()
      }
      if (ordersChannelRef.current) {
        ordersChannelRef.current.unsubscribe()
      }
    }
  }, [])

  useEffect(() => {
    const providerId = searchParams.get("provider")
    // Only process if we have a new provider ID that hasn't been processed yet
    if (providerId && user && providerId !== processedProviderId) {
      setProcessedProviderId(providerId)
      createOrOpenConversation(providerId)
    }
  }, [searchParams, user])

  // Handle payment callback - verify and update order status when returning from Tap Payment
  useEffect(() => {
    const paymentStatus = searchParams.get("payment")
    const orderId = searchParams.get("order_id")

    if ((paymentStatus === "callback" || paymentStatus === "success") && orderId) {
      verifyPayment(orderId).then((result) => {
        if (result.success) {
          if (selectedConversation) {
            fetchOrders(selectedConversation,true)
          }
        }
      })
      // Clean up URL params
      router.replace("/messages", { scroll: false })
    }
  }, [searchParams])

  // Setup Realtime subscription for messages when conversation is selected
  useEffect(() => {
    if (selectedConversation && user) {
      setRealtimeStatus("connecting")
      setMessages([])
      setMessagesError(null)
      setOrdersError(null)
      setMessageCursor(null)
      setOrderCursor(null)
      setOrderTotal(0)
      fetchMessages(selectedConversation)
      fetchOrders(selectedConversation)
      
      // Setup realtime subscription for messages
      setupMessagesRealtime(selectedConversation)
      setupOrdersRealtime(selectedConversation)
    }
    
    return () => {
      if (messagesChannelRef.current) {
        messagesChannelRef.current.unsubscribe()
        messagesChannelRef.current = null
      }
      setRealtimeStatus("disconnected")
      if (ordersChannelRef.current) {
        ordersChannelRef.current.unsubscribe()
        ordersChannelRef.current = null
      }
    }
  }, [selectedConversation, user])
  
  // Setup Realtime subscription for conversations
  useEffect(() => {
    if (user) {
      setupConversationsRealtime()
    }
    
    return () => {
      if (conversationsChannelRef.current) {
        conversationsChannelRef.current.unsubscribe()
        conversationsChannelRef.current = null
      }
    }
  }, [user,currentProviderId])

  useEffect(() => {
    if (!user) return
    const timer = window.setTimeout(() => void fetchConversations(), 300)
    return () => window.clearTimeout(timer)
  }, [user,showArchived,searchQuery])
  
  const setupMessagesRealtime = useCallback((conversationId: string) => {
    const supabase = createClient()
    
    // Unsubscribe from previous channel if exists
    if (messagesChannelRef.current) {
      messagesChannelRef.current.unsubscribe()
    }
    
    
    messagesChannelRef.current = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload: any) => {
          const newMsg = payload.new as Message
          setMessages(prev => {
            // Avoid duplicates
            if (prev.some(m => m.id === newMsg.id)) {
              return prev
            }
            return [...prev, newMsg]
          })
          
          // Auto-scroll to bottom
          setTimeout(() => {
            if (messagesContainerRef.current) {
              messagesContainerRef.current.scrollTo({
                top: messagesContainerRef.current.scrollHeight,
                behavior: "smooth",
              })
            }
          }, 100)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload: any) => {
          const updatedMsg = payload.new as Message
          setMessages(prev => prev.map(m => m.id === updatedMsg.id ? updatedMsg : m))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload: any) => {
          const deletedMsg = payload.old as Message
          setMessages(prev => prev.filter(m => m.id !== deletedMsg.id))
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected")
          void fetchMessages(conversationId)
        } else {
          const disconnected = status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
          setRealtimeStatus(disconnected ? "disconnected" : "connecting")
          if (disconnected) {
            void supabase.auth.getUser().then(({ data,error }) => {
              if (error || !data.user) {
                void messagesChannelRef.current?.unsubscribe()
                void conversationsChannelRef.current?.unsubscribe()
                void ordersChannelRef.current?.unsubscribe()
                router.push("/auth/login")
              }
            })
          }
        }
      })
  }, [user])
  
  const setupConversationsRealtime = useCallback(() => {
    if (!user) return
    
    const supabase = createClient()
    
    // Unsubscribe from previous channel if exists
    if (conversationsChannelRef.current) {
      conversationsChannelRef.current.unsubscribe()
    }
    
    const providerIds = currentProviderId?[currentProviderId]:[]
    const handleConversationChange = () => {
      fetchConversations()
    }
    
    let channel = supabase
      .channel(`conversations-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `seeker_id=eq.${user.id}`,
        },
        handleConversationChange
      )

    if (providerIds.length > 0) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `provider_id=in.(${providerIds.join(",")})`,
        },
        handleConversationChange
      )
    }

    conversationsChannelRef.current = channel
      .subscribe()
  }, [user,currentProviderId])
  
  const setupOrdersRealtime = useCallback((conversationId: string) => {
    const supabase = createClient()
    
    // Unsubscribe from previous channel if exists
    if (ordersChannelRef.current) {
      ordersChannelRef.current.unsubscribe()
    }
    
    
    ordersChannelRef.current = supabase
      .channel(`orders:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `conversation_id=eq.${conversationId}`
        },
        () => {
          fetchOrders(conversationId,true)
        }
      )
      .subscribe()
  }, [])

  const checkAuthAndFetchData = async () => {
    const supabase = createClient()


    const { data, error } = await supabase.auth.getUser()

    if (error || !data.user) {
      router.push("/auth/login")
      return
    }

    setUser(data.user)

    const contextResult=await getCurrentProviderContext()
    if(contextResult.success){
      setUserProfile({role:contextResult.data.role})
      setCurrentProviderId(contextResult.data.provider?.id||null)
    }else{
      setUserProfile(null)
      setCurrentProviderId(null)
      toast({
        title:t("تعذر تحميل صلاحيات الحساب","Could not load account permissions"),
        description:t("قد لا تتوفر بعض الإجراءات حتى إعادة المحاولة","Some actions may remain unavailable until you retry"),
        variant:"destructive",
      })
    }

    setIsLoading(false)
  }

  const fetchOrders = async (conversationId:string,merge=false) => {
    try {
      const result=await getConversationOrders(conversationId)
      if (!result.success) {
        setOrdersError(t("تعذر تحميل الطلبات","Could not load orders"))
        toast({title:t("تعذر تحميل الطلبات","Could not load orders"),description:result.error,variant:"destructive"})
        return
      }
      const page=result.data.orders as unknown as Order[]
      setOrders((current)=>{
        if(!merge)return page
        const byId=new Map(current.map((order)=>[order.id,order]))
        for(const order of page)byId.set(order.id,order)
        return [...byId.values()]
      })
      setOrderTotal(result.data.total)
      setOrderCursor((current)=>merge?(current||result.data.nextCursor):result.data.nextCursor)
      setOrdersError(null)
    } catch {
      const message=t("يرجى المحاولة مرة أخرى","Please try again")
      setOrdersError(message)
      toast({ title:t("تعذر تحميل الطلبات","Could not load orders"),description:message,variant:"destructive" })
    }
  }

  const parseServiceCard = (content: string): ServiceCard | null => {
    try {
      const parsed = JSON.parse(content) as Partial<ServiceCard>
      return parsed.__type === "service_card"
        && typeof parsed.id === "string"
        && typeof parsed.name_ar === "string"
        && typeof parsed.name_en === "string"
        && typeof parsed.price === "number"
        && Number.isFinite(parsed.price)
        ? parsed as ServiceCard
        : null
    } catch {
      return null
    }
  }

  const fetchProviderServices = async (providerId: string) => {
    setLoadingServices(true)
    setServicesError(null)
    setProviderServices([])
    setProviderServiceCursor(null)
    setProviderServiceTotal(0)
    try {
      const result=await getPublicProviderServices(providerId)
      if(!result.success)throw new Error(result.error)
      setProviderServices(result.data.services)
      setProviderServiceCursor(result.data.nextCursor)
      setProviderServiceTotal(result.data.total)
    } catch {
      setServicesError(t("تعذر تحميل الخدمات","Could not load services"))
      toast({
        title: t("تعذر تحميل الخدمات", "Could not load services"),
        description: t("يرجى المحاولة مرة أخرى", "Please try again"),
        variant: "destructive",
      })
    } finally {
      setLoadingServices(false)
    }
  }

  const loadMoreProviderServices=async(providerId:string)=>{
    if(!providerServiceCursor||loadingMoreServices)return
    setLoadingMoreServices(true)
    const result=await getPublicProviderServices(providerId,providerServiceCursor)
    if(result.success){
      setProviderServices((current)=>[...current,...result.data.services.filter((service)=>!current.some((item)=>item.id===service.id))])
      setProviderServiceCursor(result.data.nextCursor);setProviderServiceTotal(result.data.total);setServicesError(null)
    }else{
      setServicesError(result.error)
      toast({title:t("تعذر تحميل خدمات أقدم","Could not load older services"),description:result.error,variant:"destructive"})
    }
    setLoadingMoreServices(false)
  }

  const sendServiceCard = async (service: ProviderService) => {
    if (!selectedConversation || sendingServiceId) return
    setSendingServiceId(service.id)
    try {
      const requestId = pendingServiceRequestIds.current.get(service.id) || crypto.randomUUID()
      pendingServiceRequestIds.current.set(service.id, requestId)
      const result = await sendServiceCardMessage({
        conversationId: selectedConversation,
        clientRequestId: requestId,
        serviceId: service.id,
      })
      if (!result.success) throw new Error(result.error)
      pendingServiceRequestIds.current.delete(service.id)
      setShowServicesPanel(false)
      await fetchMessages(selectedConversation)
      await fetchConversations()
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: "smooth" })
        }
      }, 100)
    } catch {
      toast({
        title: t("لم يتم إرسال الخدمة", "Service was not sent"),
        description: t("يرجى المحاولة مرة أخرى", "Please try again"),
        variant: "destructive",
      })
    } finally {
      setSendingServiceId(null)
    }
  }

  const [deliveryDialog, setDeliveryDialog] = useState<{ orderId: string; role: "provider" | "seeker" } | null>(null)

  const handlePayment = async (orderId: string) => {
    setProcessingPayment(true)
    try {
      const result = await createPaymentCharge(orderId)

      if (!result.success) {
        toast({ title: t("خطأ", "Error"), description: result.error, variant: "destructive" })
        return
      }

      if (result.data.url) {
        const newWindow = window.open(result.data.url, "_blank")
        if (!newWindow || newWindow.closed || typeof newWindow.closed === "undefined") {
          window.location.href = result.data.url
        }
      }
    } catch {
      toast({ title: t("خطأ", "Error"), description: language === "ar" ? "فشل في معالجة الدفع" : "Failed to process payment", variant: "destructive" })
    } finally {
      setProcessingPayment(false)
    }
  }

  const fetchConversations = async ({
    append = false,
    archived = showArchived,
    query = searchQuery,
  }: { append?: boolean; archived?: boolean; query?: string } = {}) => {
    const requestId = ++conversationRequestId.current
    if (append) setLoadingMoreConversations(true)
    else setConversationsLoading(true)
    try {
      const result = await getConversationPage({
        archived,
        query,
        cursor: append ? conversationCursor : null,
        pageSize: 50,
      })
      if (requestId !== conversationRequestId.current) return
      if (!result.success) {
        setConversationsError(result.error)
        toast({ title:t("تعذر تحميل المحادثات","Could not load conversations"),description:result.error,variant:"destructive" })
        return
      }
      const page = result.data.conversations as unknown as Conversation[]
      setConversations((current) => {
        if (!append) return page
        const existing = new Set(current.map((conversation) => conversation.id))
        return [...current,...page.filter((conversation) => !existing.has(conversation.id))]
      })
      if (!append || page.length > 0) setConversationTotal(result.data.total)
      setConversationCursor(result.data.nextCursor)
      setConversationsError(null)
    } catch {
      if (requestId !== conversationRequestId.current) return
      const message = t("يرجى المحاولة مرة أخرى","Please try again")
      setConversationsError(message)
      toast({ title:t("تعذر تحميل المحادثات","Could not load conversations"),description:message,variant:"destructive" })
    } finally {
      if (requestId === conversationRequestId.current) {
        setLoadingMoreConversations(false)
        setConversationsLoading(false)
      }
    }
  }

  const createOrOpenConversation = async (providerId: string) => {
    try {
      const result = await openProviderConversation(providerId)
      if (!result.success) {
        toast({ title: t("تعذر فتح المحادثة", "Could not open conversation"), description: result.error, variant: "destructive" })
        router.replace("/messages", { scroll: false })
        return
      }
      setShowArchived(false)
      setSearchQuery("")
      await fetchConversations({ archived:false,query:"" })
      setSelectedConversation(result.data.conversationId)
      router.replace("/messages", { scroll: false })
    } catch {
      toast({ title: t("تعذر فتح المحادثة", "Could not open conversation"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
      router.replace("/messages", { scroll: false })
    }
  }

  const fetchMessages = async (conversationId: string) => {
    try {
      const result = await getConversationMessages(conversationId)
      if (!result.success) {
        setMessagesError(result.error)
        toast({ title: t("تعذر تحميل الرسائل", "Could not load messages"), description: result.error, variant: "destructive" })
        return
      }
      const page = result.data.messages as Message[]
      setMessages(page)
      setMessagesError(null)
      setMessageCursor(result.data.nextCursor)

      if (page.some((message) => !message.is_read && message.sender_id !== user.id)) {
        const readResult = await markConversationRead(conversationId)
        if (!readResult.success) {
          toast({ title: t("تعذر تحديث حالة القراءة", "Could not update read status"), description: readResult.error, variant: "destructive" })
        }
        await fetchConversations()
      }
    } catch {
      const message=t("يرجى المحاولة مرة أخرى", "Please try again")
      setMessagesError(message)
      toast({ title: t("تعذر تحميل الرسائل", "Could not load messages"), description:message, variant: "destructive" })
    }
  }

  const loadOlderMessages = async () => {
    if (!selectedConversation || (!messageCursor&&!orderCursor) || loadingOlderMessages) return
    setLoadingOlderMessages(true)
    const previousHeight = messagesContainerRef.current?.scrollHeight || 0
    try {
      const [messageResult,orderResult]=await Promise.all([
        messageCursor?getConversationMessages(selectedConversation,messageCursor):Promise.resolve(null),
        orderCursor?getConversationOrders(selectedConversation,orderCursor):Promise.resolve(null),
      ])
      if(messageResult){
        if(!messageResult.success)toast({title:t("تعذر تحميل الرسائل الأقدم","Could not load older messages"),description:messageResult.error,variant:"destructive"})
        else{
          const older=messageResult.data.messages as Message[]
          setMessages((current)=>{
            const existing=new Set(current.map((message)=>message.id))
            return [...older.filter((message)=>!existing.has(message.id)),...current]
          })
          setMessageCursor(messageResult.data.nextCursor)
        }
      }
      if(orderResult){
        if(!orderResult.success)toast({title:t("تعذر تحميل الطلبات الأقدم","Could not load older orders"),description:orderResult.error,variant:"destructive"})
        else{
          const older=orderResult.data.orders as unknown as Order[]
          setOrders((current)=>{
            const existing=new Set(current.map((order)=>order.id))
            return [...older.filter((order)=>!existing.has(order.id)),...current]
          })
          setOrderCursor(orderResult.data.nextCursor);setOrderTotal(orderResult.data.total)
        }
      }
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop += messagesContainerRef.current.scrollHeight - previousHeight
        }
      })
    } catch {
      toast({ title: t("تعذر تحميل النشاط الأقدم", "Could not load older activity"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || sendingMessage) return

    setSendingMessage(true)

    try {
      const messageContent = newMessage.trim()
      const requestId = pendingMessageRequestId.current || crypto.randomUUID()
      pendingMessageRequestId.current = requestId
      const result = await sendConversationMessage({
        conversationId: selectedConversation,
        clientRequestId: requestId,
        content: messageContent,
      })
      if (!result.success) throw new Error(result.error)

      setNewMessage("")
      pendingMessageRequestId.current = null
      const sentMessage = result.data.message as Message
      setMessages((prev) => (prev.some((message) => message.id === sentMessage.id) ? prev : [...prev, sentMessage]))
      await fetchConversations()

      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTo({
            top: messagesContainerRef.current.scrollHeight,
            behavior: "smooth",
          })
        }
      }, 100)
    } catch {
      toast({
        title: t("لم يتم إرسال الرسالة", "Message was not sent"),
        description: t("تم الاحتفاظ بالنص. حاول مرة أخرى", "Your text was kept. Try again"),
        variant: "destructive",
      })
    } finally {
      setSendingMessage(false)
    }
  }

  const togglePin = async (conversationId: string, currentPinStatus: boolean) => {
    const conversation = conversations.find((c) => c.id === conversationId)
    if (!conversation) return

    try {
      const result = await setConversationPreference(conversationId, "pinned", !currentPinStatus)
      if (!result.success) throw new Error(result.error)
      await fetchConversations()
    } catch {
      toast({ title: t("فشل الحفظ", "Save failed"), description: t("تعذر تحديث التثبيت", "Could not update pin status"), variant: "destructive" })
    }
  }

  const archiveConversation = async (conversationId: string, archived = true) => {
    const conversation = conversations.find((c) => c.id === conversationId)
    if (!conversation) return

    try {
      const result = await setConversationPreference(conversationId, "archived", archived)
      if (!result.success) throw new Error(result.error)
      if (selectedConversation === conversationId) {
        setSelectedConversation(null)
      }
      await fetchConversations()
    } catch {
      toast({ title: t("فشل الحفظ", "Save failed"), description: t("تعذر تحديث حالة المحادثة", "Could not update conversation visibility"), variant: "destructive" })
    }
  }

  const clearChat = async () => {
    if (!selectedConversation || !currentConversation) return

    try {
      const result = await setConversationPreference(selectedConversation, "cleared")
      if (!result.success) throw new Error(result.error)
      setMessages([])
      setMessageCursor(null)
      setShowClearDialog(false)
      await fetchConversations()
    } catch {
      toast({ title: t("فشل المسح", "Clear failed"), description: t("يرجى المحاولة مرة أخرى", "Please try again"), variant: "destructive" })
    }
  }

  const filteredConversations = conversations
  const currentConversation = conversations.find((c) => c.id === selectedConversation)
  const conversationName = (conversation: Conversation) =>
    (language === "ar" ? conversation.other_party_name_ar : conversation.other_party_name_en)
      || t("مستخدم غير معروف","Unknown User")

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">{t("جاري التحميل...", "Loading...")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="grid md:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-200px)]">
          {/* Conversations List */}
          <Card className={`flex flex-col overflow-hidden ${selectedConversation ? "hidden md:flex" : "flex"}`}>
            <div className="p-4 border-b">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="font-bold text-xl">{showArchived ? t("المحادثات المخفية", "Hidden Messages") : t("المحادثات", "Messages")}</h2>
                <Button variant="ghost" size="sm" onClick={() => { setSelectedConversation(null); setShowArchived((value) => !value) }}>
                  {showArchived ? t("النشطة", "Active") : t("المخفية", "Hidden")}
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("بحث...", "Search...")}
                  className="ps-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label={t("بحث في المحادثات", "Search conversations")}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {conversationsLoading ? (
                <div className="flex h-full items-center justify-center" aria-label={t("جاري تحميل المحادثات","Loading conversations")}>
                  <div className="h-7 w-7 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
                </div>
              ) : conversationsError && filteredConversations.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <AlertCircle className="mb-3 h-10 w-10 text-destructive" />
                  <p className="text-sm text-muted-foreground">{conversationsError}</p>
                  <Button variant="outline" className="mt-3" onClick={() => void fetchConversations()}>
                    {t("إعادة المحاولة", "Retry")}
                  </Button>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                  <MessageCircle className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    {showArchived ? t("لا توجد محادثات مخفية", "No hidden conversations") : t("لا توجد محادثات بعد", "No conversations yet")}
                  </p>
                  {!showArchived && (
                    <Button variant="link" asChild className="mt-2">
                      <a href="/services/seeker">{t("تصفح المحترفين", "Browse Professionals")}</a>
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {filteredConversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={`p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedConversation === conv.id ? "bg-muted" : ""
                      }`}
                      onClick={() => setSelectedConversation(conv.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12">
                          <Image
                            src={conv.other_party_avatar || "/placeholder.svg"}
                            alt={conversationName(conv)}
                            width={48}
                            height={48}
                            className="h-full w-full object-cover"
                          />
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold truncate">{conversationName(conv)}</p>
                            {conv.is_pinned && <Pin className="h-4 w-4 text-primary shrink-0" />}
                            {conv.unread_count > 0 && (
                              <span className="min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                                {conv.unread_count > 99 ? "99+" : conv.unread_count}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {new Date(conv.last_message_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {conversationCursor && conversations.length < conversationTotal && (
                    <div className="p-3 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void fetchConversations({ append:true })}
                        disabled={loadingMoreConversations}
                      >
                        {loadingMoreConversations ? t("جاري التحميل...","Loading...") : t("تحميل محادثات أقدم","Load Older Conversations")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Chat Area */}
          <Card className={`flex flex-col overflow-hidden ${selectedConversation ? "flex" : "hidden md:flex"}`}>
            {selectedConversation && currentConversation ? (
              <>
                <div className="p-4 border-b flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedConversation(null)} className="md:hidden">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Avatar className="h-10 w-10">
                    <Image
                      src={currentConversation.other_party_avatar || "/placeholder.svg"}
                      alt={conversationName(currentConversation)}
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                    />
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-semibold">{conversationName(currentConversation)}</p>
                    <p className="text-xs text-muted-foreground">
                      {currentConversation.last_message_at
                        ? t("آخر نشاط ", "Last active ") + formatRelativeTime(new Date(currentConversation.last_message_at))
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground" role="status">
                      {realtimeStatus === "connected"
                        ? t("متصل", "Connected")
                        : realtimeStatus === "connecting"
                        ? t("جاري الاتصال...", "Connecting...")
                        : t("غير متصل - ستتم المزامنة عند العودة", "Offline - messages will sync when reconnected")}
                    </p>
                  </div>

                  {currentConversation.is_provider && userProfile?.role === "provider" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowCreateOrder(true)
                      }}
                      className="gap-2"
                    >
                      <DollarSign className="h-4 w-4" />
                      {t("إنشاء عرض سعر", "Create Quote")}
                    </Button>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align={language === "ar" ? "start" : "end"}>
                      <DropdownMenuItem onClick={() => togglePin(selectedConversation, currentConversation.is_pinned)}>
                        <Pin className="h-4 w-4 me-2" />
                        {currentConversation.is_pinned ? t("إلغاء التثبيت", "Unpin") : t("تثبيت", "Pin")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowClearDialog(true)}>
                        <X className="h-4 w-4 me-2" />
                        {t("مسح المحادثة", "Clear Chat")}
                      </DropdownMenuItem>
                      {currentConversation.is_archived ? (
                        <DropdownMenuItem onClick={() => archiveConversation(selectedConversation, false)}>
                          <MessageCircle className="h-4 w-4 me-2" />
                          {t("استعادة المحادثة", "Restore Conversation")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => setShowArchiveDialog(true)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 me-2" />
                          {t("إخفاء المحادثة", "Hide Conversation")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                  {(messagesError || ordersError) && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
                      <p className="font-medium text-destructive">{t("لم يكتمل تحميل المحادثة","Conversation did not fully load")}</p>
                      <p className="mt-1 text-muted-foreground">{[messagesError,ordersError].filter(Boolean).join(" · ")}</p>
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => {
                        void fetchMessages(selectedConversation)
                        void fetchOrders(selectedConversation)
                      }}>
                        {t("إعادة المحاولة","Retry")}
                      </Button>
                    </div>
                  )}
                  {(messageCursor||orderCursor) && (
                    <div className="flex justify-center">
                      <Button variant="outline" size="sm" onClick={loadOlderMessages} disabled={loadingOlderMessages}>
                        {loadingOlderMessages ? t("جاري التحميل...", "Loading...") : t("تحميل نشاط أقدم", "Load older activity")}
                        {orderTotal>0&&<span className="ms-1 text-xs text-muted-foreground">({orders.length}/{orderTotal} {t("طلبات","orders")})</span>}
                      </Button>
                    </div>
                  )}
                  {!messagesError && !ordersError && messages.length === 0 && orders.length === 0 && (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center max-w-md p-6 bg-muted/30 rounded-lg">
                        <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                        <h3 className="font-semibold mb-2">
                          {currentConversation.is_provider
                            ? t("ابدأ المحادثة أو قدم عرض سعر", "Start chatting or create a quote")
                            : t("ابدأ المحادثة", "Start the conversation")}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {currentConversation.is_provider
                            ? t(
                                "بعد مناقشة التفاصيل، يمكنك إنشاء عرض سعر للخدمة",
                                "After discussing details, you can create a quote for the service",
                              )
                            : t(
                                "ناقش احتياجاتك مع مقدم الخدمة وستحصل على عرض سعر",
                                "Discuss your needs with the provider and you'll receive a quote",
                              )}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Merge messages and orders into a single chronological timeline */}
                  {[
                    ...messages.map((m) => ({ type: 'message' as const, data: m, time: m.created_at })),
                    ...orders.map((o) => ({ type: 'order' as const, data: o, time: o.created_at })),
                  ]
                    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
                    .map((item) => {
                      if (item.type === 'message') {
                        const message = item.data as Message
                        const serviceCard = parseServiceCard(message.content)

                        if (serviceCard) {
                          const isMine = message.sender_id === user.id
                          const name = language === "ar" ? serviceCard.name_ar : serviceCard.name_en
                          const desc = language === "ar" ? serviceCard.description_ar : serviceCard.description_en
                          return (
                            <div key={`msg-${message.id}`} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                              <div className="max-w-[340px] w-full">
                                <Card className="overflow-hidden border-2 border-primary/20 shadow-sm">
                                  {serviceCard.image_url && (
                                    <div className="aspect-video overflow-hidden">
                                      <Image src={serviceCard.image_url} alt={name} width={340} height={200} className="w-full h-full object-cover" />
                                    </div>
                                  )}
                                  <div className="p-3 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="font-semibold text-sm leading-snug">{name}</p>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 shrink-0 text-muted-foreground"
                                        onClick={() => router.push(`/services/${serviceCard.id}`)}
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                    {desc && <p className="text-xs text-muted-foreground line-clamp-2">{desc}</p>}
                                    <div className="flex items-center justify-between pt-1 border-t">
                                      <span className="text-sm font-bold text-primary">
                                        {serviceCard.price} {t("ر.س", "SAR")}
                                      </span>
                                      {currentConversation?.is_provider && (
                                        <Button
                                          size="sm"
                                          className="h-7 text-xs gap-1"
                                          onClick={() => {
                                            setOrderPrefill({
                                              serviceNameAr: serviceCard.name_ar,
                                              serviceNameEn: serviceCard.name_en,
                                              serviceDescriptionAr: serviceCard.description_ar,
                                              serviceDescriptionEn: serviceCard.description_en,
                                              amount: String(serviceCard.price),
                                            })
                                            setShowCreateOrder(true)
                                          }}
                                        >
                                          <DollarSign className="h-3 w-3" />
                                          {t("إنشاء عرض", "Quote")}
                                        </Button>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground/60">
                                      {new Date(message.created_at).toLocaleTimeString(language === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                                    </p>
                                  </div>
                                </Card>
                              </div>
                            </div>
                          )
                        }

                        return (
                          <div
                            key={`msg-${message.id}`}
                            className={`flex ${message.sender_id === user.id ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                                message.sender_id === user.id ? "bg-primary text-primary-foreground" : "bg-muted"
                              }`}
                            >
                              <p className="text-sm">{message.content}</p>
                              <p className="text-xs opacity-70 mt-1">
                                {new Date(message.created_at).toLocaleTimeString(language === "ar" ? "ar-SA" : "en-US", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                        )
                      } else {
                        const order = item.data as Order
                        return (
                          <div key={`order-${order.id}`} className="flex justify-center">
                            <Card className="max-w-md w-full p-4 bg-card border-2">
                              <div className="space-y-3">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <h3 className="font-bold text-lg">
                                      {language === "ar" ? order.service_name_ar : order.service_name_en}
                                    </h3>
                                    {(language === "ar" ? order.service_description_ar : order.service_description_en) && (
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {language === "ar" ? order.service_description_ar : order.service_description_en}
                                      </p>
                                    )}
                                  </div>
                                  {order.status === "completed" && (
                                    <CheckCircle className="h-5 w-5 text-green-500 shrink-0 ms-2" />
                                  )}
                                </div>

                                <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                                  <div className="flex justify-between">
                                    <span>{t("المبلغ:", "Amount:")}</span>
                                    <span className="font-bold">{formatCurrency(order.amount,language)}</span>
                                  </div>
                                  <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{t("رسوم المنصة:", "Platform Fee:")}</span>
                                    <span>-{formatCurrency(order.platform_fee,language)}</span>
                                  </div>
                                  {order.paid_at && (
                                    <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t">
                                      <span>{t("تاريخ الدفع:", "Paid on:")}</span>
                                      <span>
                                        {new Date(order.paid_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                                      </span>
                                    </div>
                                  )}
                                  {order.completed_at && (
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                      <span>{t("تاريخ الإنجاز:", "Completed on:")}</span>
                                      <span>
                                        {new Date(order.completed_at).toLocaleDateString(
                                          language === "ar" ? "ar-SA" : "en-US",
                                        )}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-2">
                                  <span
                                    className={`text-xs px-2 py-1 rounded-full ${
                                      order.status === "pending"
                                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                        : order.status === "paid"
                                          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                                        : order.status === "revision_requested"
                                          ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                                        : order.status === "completed"
                                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                            : order.status === "awaiting_confirmation"
                                              ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                                              : order.status === "cancelled"
                                                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                                : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                                    }`}
                                  >
                                    {order.status === "pending" && t("قيد الانتظار", "Pending")}
                                    {order.status === "paid" && t("مدفوع", "Paid")}
                                    {order.status === "revision_requested" && t("تعديل مطلوب", "Revision Requested")}
                                    {order.status === "completed" && t("مكتمل", "Completed")}
                                    {order.status === "cancelled" && t("ملغي", "Cancelled")}
                                    {order.status === "awaiting_confirmation" &&
                                      t("في انتظار التأكيد", "Awaiting Confirmation")}
                                  </span>

                                  {/* Seeker buttons */}
                                  {/* Seeker buttons */}
                                  {order.seeker_id === user.id && (
                                    <div className="flex gap-2">
                                      {order.status === "pending" && (
                                        <Button
                                          size="sm"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            handlePayment(order.id)
                                          }}
                                          disabled={processingPayment}
                                          className="gap-2"
                                        >
                                          <DollarSign className="h-4 w-4" />
                                          {processingPayment
                                            ? t("جاري المعالجة...", "Processing...")
                                            : t("ادفع الآن", "Pay Now")}
                                        </Button>
                                      )}
                                      {order.status === "awaiting_confirmation" && (
                                        <Button
                                          size="sm"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setDeliveryDialog({ orderId: order.id, role: "seeker" })
                                          }}
                                          className="gap-2"
                                        >
                                          <CheckCircle className="h-4 w-4" />
                                          {t("مراجعة التسليم", "Review Delivery")}
                                        </Button>
                                      )}
                                      {(order.status === "paid" || order.status === "completed") && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            router.push("/history")
                                          }}
                                          className="gap-2"
                                        >
                                          <Eye className="h-4 w-4" />
                                          {t("عرض التفاصيل", "View Details")}
                                        </Button>
                                      )}
                                    </div>
                                  )}

                                  {/* Provider buttons - only show when user is provider */}
                                  {currentConversation?.is_provider && (
                                    <>
                                      {(order.status === "paid" || order.status === "revision_requested") && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setDeliveryDialog({ orderId: order.id, role: "provider" })
                                          }}
                                          className="gap-2"
                                        >
                                          <CheckCircle className="h-4 w-4" />
                                          {order.status === "revision_requested"
                                            ? t("إعادة التسليم", "Resubmit")
                                            : t("تسليم الطلب", "Deliver Order")}
                                        </Button>
                                      )}
                                      {(order.status === "awaiting_confirmation" || order.status === "completed") && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setDeliveryDialog({ orderId: order.id, role: "provider" })
                                          }}
                                          className="gap-2"
                                        >
                                          <Eye className="h-4 w-4" />
                                          {t("عرض التسليم", "View Delivery")}
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </Card>
                          </div>
                        )
                      }
                    })}
                </div>

                <div className="p-4 border-t">
                  <div className="flex gap-2">
                    {!currentConversation.is_provider && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        title={t("تصفح الخدمات", "Browse Services")}
                        onClick={() => {
                          fetchProviderServices(currentConversation.provider_id)
                          setShowServicesPanel(true)
                        }}
                      >
                        <Briefcase className="h-4 w-4" />
                      </Button>
                    )}
                    <Input
                      value={newMessage}
                      onChange={(e) => {
                        if (e.target.value !== newMessage) pendingMessageRequestId.current = null
                        setNewMessage(e.target.value)
                      }}
                      maxLength={10000}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          sendMessage()
                        }
                      }}
                      placeholder={t("اكتب رسالة...", "Type a message...")}
                      className="flex-1"
                    />
                    <Button onClick={sendMessage} disabled={!newMessage.trim() || sendingMessage}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageCircle className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-semibold mb-2">{t("اختر محادثة", "Select a conversation")}</p>
                  <p className="text-muted-foreground">
                    {t("اختر محادثة من القائمة للبدء", "Select a conversation from the list to start")}
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </main>

      <Footer />

      {showCreateOrder && selectedConversation && currentConversation && (
        <>
          <CreateOrderDialog
            conversationId={selectedConversation}
            prefill={orderPrefill ?? undefined}
            onClose={() => {
              setShowCreateOrder(false)
              setOrderPrefill(null)
            }}
            onSuccess={() => {
              if (selectedConversation) {
                fetchOrders(selectedConversation,true)
              }
            }}
          />
        </>
      )}

      {/* Services Panel — seeker browses provider services */}
      <Dialog open={showServicesPanel} onOpenChange={setShowServicesPanel}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              {t("خدمات مقدم الخدمة", "Provider Services")} <span className="text-sm font-normal text-muted-foreground">({providerServices.length}/{providerServiceTotal})</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pe-1">
            {loadingServices ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : servicesError&&providerServices.length===0 ? (
              <div className="py-10 text-center" role="alert">
                <p className="text-sm text-destructive">{servicesError}</p>
                {currentConversation && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchProviderServices(currentConversation.provider_id)}>
                    {t("إعادة المحاولة","Retry")}
                  </Button>
                )}
              </div>
            ) : providerServices.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Briefcase className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>{t("لا توجد خدمات متاحة", "No services available")}</p>
              </div>
            ) : (
              <>{servicesError&&<div className="rounded border border-destructive/30 p-3 text-sm text-destructive" role="alert">{t("تعذر تحديث الخدمات؛ المعروض هو آخر بيانات ناجحة","Service refresh failed; showing the last successful data")}</div>}{providerServices.map((service) => {
                const name = language === "ar" ? service.name_ar : service.name_en
                const desc = language === "ar" ? service.description_ar : service.description_en
                const cover = service.image_urls?.[0]
                return (
                  <div key={service.id} className="flex gap-3 p-3 rounded-xl border bg-card hover:bg-muted/40 transition-colors">
                    {cover ? (
                      <div className="h-16 w-20 rounded-lg overflow-hidden shrink-0">
                        <Image src={cover} alt={name} width={80} height={64} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="h-16 w-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Briefcase className="h-6 w-6 text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-snug line-clamp-1">{name}</p>
                      {desc && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{desc}</p>}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm font-bold text-primary">
                          {service.price} {t("ر.س", "SAR")}
                          {service.price_type === "hourly" && <span className="font-normal text-xs text-muted-foreground"> /{t("ساعة", "hr")}</span>}
                        </span>
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => sendServiceCard(service)}
                          disabled={sendingServiceId !== null}
                        >
                          <Send className="h-3 w-3" />
                          {t("إرسال", "Send")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}{currentConversation&&providerServiceCursor&&providerServices.length<providerServiceTotal&&<Button variant="outline" onClick={()=>void loadMoreProviderServices(currentConversation.provider_id)} disabled={loadingMoreServices}>{loadingMoreServices?t("جاري التحميل...","Loading..."):t("تحميل خدمات أقدم","Load Older Services")}</Button>}</>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("مسح المحادثة", "Clear Chat")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "سيتم إخفاء جميع الرسائل من طرفك فقط. لن يتأثر الطرف الآخر، وستظل سجلات الطلبات محفوظة.",
                "All messages will be hidden from your side only. The other party won't be affected, and order records will remain.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={clearChat} className="bg-destructive text-destructive-foreground">
              {t("مسح", "Clear")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("إخفاء المحادثة", "Hide Conversation")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "ستُخفى هذه المحادثة من قائمتك فقط. لن يتأثر الطرف الآخر، وستظل المحادثة موجودة إذا تواصل معك مجدداً.",
                "This conversation will be hidden from your list only. The other party won't be affected, and it will reappear if they message you again.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { archiveConversation(selectedConversation!); setShowArchiveDialog(false) }}
              className="bg-destructive text-destructive-foreground"
            >
              {t("إخفاء", "Hide")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OrderDeliveryDialog
        order={deliveryDialog ? orders.find((order) => order.id === deliveryDialog.orderId) || null : null}
        role={deliveryDialog?.role || "seeker"}
        open={!!deliveryDialog}
        onOpenChange={(open) => !open && setDeliveryDialog(null)}
        onUpdated={async () => {
          setDeliveryDialog(null)
          if (selectedConversation) await fetchOrders(selectedConversation)
        }}
      />
    </div>
  )
}
