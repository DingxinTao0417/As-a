"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useLanguage } from "@/components/language-provider"
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
  Clock,
  ExternalLink,
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
import { createCheckoutSession, completeOrder, confirmOrder, verifyPayment } from "@/app/actions/orders"
import { formatCurrency } from "@/lib/stripe"
import type { RealtimeChannel } from "@supabase/supabase-js"

type Conversation = {
  id: string
  provider_id: string
  seeker_id: string
  last_message_at: string
  other_party_name: string
  other_party_avatar: string
  is_provider: boolean
  is_pinned: boolean
  is_archived: boolean
  cleared_at: string | null
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
  amount_cents: number
  platform_fee_cents: number
  provider_amount_cents: number
  status: string
  created_at: string
  paid_at?: string
  completed_at?: string
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

type ProviderService = {
  id: string
  name_ar: string
  name_en: string
  description_ar: string | null
  description_en: string | null
  price: number
  price_type: string
  category: string
  image_urls: string[]
  is_active: boolean
}

export default function MessagesPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<any>(null)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [showCreateOrder, setShowCreateOrder] = useState(false)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [processingConfirmation, setProcessingConfirmation] = useState(false)
  const [processedProviderId, setProcessedProviderId] = useState<string | null>(null)
  const [showServicesPanel, setShowServicesPanel] = useState(false)
  const [providerServices, setProviderServices] = useState<ProviderService[]>([])
  const [loadingServices, setLoadingServices] = useState(false)
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
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

  // Handle payment callback - verify and update order status when returning from Stripe
  useEffect(() => {
    const paymentStatus = searchParams.get("payment")
    const orderId = searchParams.get("order_id")

    if (paymentStatus === "success" && orderId) {
      console.log("[v0] Payment success callback detected for order:", orderId)
      verifyPayment(orderId).then((result) => {
        console.log("[v0] Payment verification result:", result)
        if (result.success) {
          // Refresh orders for the current conversation
          if (selectedConversation) {
            fetchOrders(selectedConversation)
          }
        } else {
          console.error("[v0] Payment verification failed:", result.error)
        }
      })
      // Clean up URL params
      router.replace("/messages", { scroll: false })
    }
  }, [searchParams])

  // Setup Realtime subscription for messages when conversation is selected
  useEffect(() => {
    if (selectedConversation && user) {
      const conv = conversations.find(c => c.id === selectedConversation)
      fetchMessages(selectedConversation, conv?.cleared_at)
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
  }, [user])
  
  const setupMessagesRealtime = useCallback((conversationId: string) => {
    const supabase = createClient()
    
    // Unsubscribe from previous channel if exists
    if (messagesChannelRef.current) {
      messagesChannelRef.current.unsubscribe()
    }
    
    console.log("[v0] Setting up Realtime subscription for messages in conversation:", conversationId)
    
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
        (payload) => {
          console.log("[v0] Realtime: New message received:", payload.new)
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
        (payload) => {
          console.log("[v0] Realtime: Message updated:", payload.new)
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
        (payload) => {
          console.log("[v0] Realtime: Message deleted:", payload.old)
          const deletedMsg = payload.old as Message
          setMessages(prev => prev.filter(m => m.id !== deletedMsg.id))
        }
      )
      .subscribe((status) => {
        console.log("[v0] Messages Realtime subscription status:", status)
      })
  }, [])
  
  const setupConversationsRealtime = useCallback(() => {
    if (!user) return
    
    const supabase = createClient()
    
    // Unsubscribe from previous channel if exists
    if (conversationsChannelRef.current) {
      conversationsChannelRef.current.unsubscribe()
    }
    
    console.log("[v0] Setting up Realtime subscription for conversations")
    
    conversationsChannelRef.current = supabase
      .channel('conversations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations'
        },
        (payload) => {
          console.log("[v0] Realtime: Conversation change detected:", payload.eventType, payload)
          // Refresh conversations list
          fetchConversations(user.id)
        }
      )
      .subscribe((status) => {
        console.log("[v0] Conversations Realtime subscription status:", status)
      })
  }, [user])
  
  const setupOrdersRealtime = useCallback((conversationId: string) => {
    const supabase = createClient()
    
    // Unsubscribe from previous channel if exists
    if (ordersChannelRef.current) {
      ordersChannelRef.current.unsubscribe()
    }
    
    console.log("[v0] Setting up Realtime subscription for orders in conversation:", conversationId)
    
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
        (payload) => {
          console.log("[v0] Realtime: Order change detected:", payload.eventType, payload)
          fetchOrders(conversationId)
        }
      )
      .subscribe((status) => {
        console.log("[v0] Orders Realtime subscription status:", status)
      })
  }, [])

  const checkAuthAndFetchData = async () => {
    const supabase = createClient()

    console.log("[v0] ========== AUTH CHECK START ==========")

    const { data, error } = await supabase.auth.getUser()

    if (error || !data.user) {
      console.warn("[v0] No authenticated user, redirecting to login", error?.message)
      router.push("/auth/login")
      return
    }

    setUser(data.user)

    const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single()

    setUserProfile(profile)
    console.log("[v0] User profile:", profile)

    await fetchConversations(data.user.id)
    setIsLoading(false)
    console.log("[v0] ========== AUTH CHECK END ==========")
  }

  const fetchOrders = async (conversationId: string) => {
    const supabase = createClient()

    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })

      if (error) {
        console.error("[v0] Error fetching orders:", error)
        return
      }

      setOrders(data || [])
    } catch (error) {
      console.error("[v0] Error fetching orders:", error)
    }
  }

  const parseServiceCard = (content: string): ServiceCard | null => {
    if (!content.startsWith('{"__type":"service_card"')) return null
    try { return JSON.parse(content) as ServiceCard } catch { return null }
  }

  const fetchProviderServices = async (providerId: string) => {
    setLoadingServices(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("services")
      .select("id, name_ar, name_en, description_ar, description_en, price, price_type, category, image_urls, is_active")
      .eq("provider_id", providerId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
    setProviderServices(data || [])
    setLoadingServices(false)
  }

  const sendServiceCard = async (service: ProviderService) => {
    if (!selectedConversation) return
    const card: ServiceCard = {
      __type: "service_card",
      id: service.id,
      name_ar: service.name_ar,
      name_en: service.name_en,
      description_ar: service.description_ar || "",
      description_en: service.description_en || "",
      price: service.price,
      price_type: service.price_type,
      category: service.category,
      image_url: service.image_urls?.[0] || "",
    }
    const supabase = createClient()
    await supabase.from("messages").insert({
      conversation_id: selectedConversation,
      sender_id: user.id,
      content: JSON.stringify(card),
    })
    await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", selectedConversation)
    setShowServicesPanel(false)
    await fetchMessages(selectedConversation)
    setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTo({ top: messagesContainerRef.current.scrollHeight, behavior: "smooth" })
      }
    }, 100)
  }

  const handlePayment = async (orderId: string) => {
    setProcessingPayment(true)
    try {
      console.log("[v0] Starting payment process for order:", orderId)
      const result = await createCheckoutSession(orderId)

      if (result.error) {
        alert(result.error)
        return
      }

      if (result.url) {
        console.log("[v0] Stripe checkout URL received:", result.url)

        // Try to open in a new tab first (more reliable)
        const newWindow = window.open(result.url, "_blank")

        // If popup blocker prevented opening, fallback to current window
        if (!newWindow || newWindow.closed || typeof newWindow.closed === "undefined") {
          console.log("[v0] Popup blocked, redirecting in current window")
          // Show a message and redirect after a short delay
          if (
            confirm(
              language === "ar"
                ? "سيتم توجيهك إلى صفحة الدفع. انقر موافق للمتابعة."
                : "You will be redirected to the payment page. Click OK to continue.",
            )
          ) {
            window.location.href = result.url
          }
        } else {
          console.log("[v0] Successfully opened Stripe checkout in new tab")
        }
      }
    } catch (error) {
      console.error("[v0] Payment error:", error)
      alert(language === "ar" ? "فشل في معالجة الدفع" : "Failed to process payment")
    } finally {
      setProcessingPayment(false)
    }
  }

  const handleCompleteOrder = async (orderId: string) => {
    if (
      !confirm(language === "ar" ? "هل أنت متأكد من إكمال هذا الطلب؟" : "Are you sure you want to complete this order?")
    ) {
      return
    }

    try {
      const result = await completeOrder(orderId)

      if (result.error) {
        alert(result.error)
      } else {
        alert(language === "ar" ? "تم إكمال الطلب بنجاح!" : "Order completed successfully!")
        if (selectedConversation) {
          await fetchOrders(selectedConversation)
        }
      }
    } catch (error) {
      console.error("[v0] Complete order error:", error)
      alert("Failed to complete order")
    }
  }

  const handleConfirmOrder = async (orderId: string) => {
    if (
      !confirm(
        language === "ar"
          ? "هل تؤكد استلام الخدمة وإتمام الطلب؟"
          : "Do you confirm receiving the service and completing the order?",
      )
    ) {
      return
    }

    setProcessingConfirmation(true)
    try {
      const result = await confirmOrder(orderId)

      if (result.error) {
        alert(result.error)
      } else {
        alert(language === "ar" ? "تم تأكيد الطلب بنجاح!" : "Order confirmed successfully!")
        if (selectedConversation) {
          await fetchOrders(selectedConversation)
        }
      }
    } catch (error) {
      console.error("[v0] Confirm order error:", error)
      alert("Failed to confirm order")
    } finally {
      setProcessingConfirmation(false)
    }
  }

  const fetchConversations = async (userId: string) => {
    const supabase = createClient()

    try {
      console.log("[v0] ========== FETCHING CONVERSATIONS ==========")
      console.log("[v0] Fetching conversations for user ID:", userId)

      const { data: seekerConvs, error: seekerError } = await supabase
        .from("conversations")
        .select("*")
        .eq("seeker_id", userId)

      console.log("[v0] ALL seeker conversations (before archive filter):", seekerConvs?.length || 0)
      if (seekerError) {
        console.error("[v0] Seeker query error:", seekerError)
      }
      if (seekerConvs && seekerConvs.length > 0) {
        console.log(
          "[v0] Seeker conversations details:",
          seekerConvs.map((c: any) => ({
            id: c.id,
            is_archived_by_seeker: c.is_archived_by_seeker,
            is_archived_by_provider: c.is_archived_by_provider,
          })),
        )
      }

      // Filter non-archived conversations
      const nonArchivedSeekerConvs = seekerConvs?.filter((c: any) => !c.is_archived_by_seeker) || []
      console.log("[v0] Non-archived seeker conversations:", nonArchivedSeekerConvs.length)

      // Get ALL provider profiles for this user (user may have multiple)
      const { data: providerProfiles } = await supabase.from("providers").select("id").eq("user_id", userId)

      console.log("[v0] Provider profiles found:", providerProfiles?.length || 0)
      if (providerProfiles && providerProfiles.length > 0) {
        console.log("[v0] Provider profile IDs:", providerProfiles.map((p: any) => p.id))
      }

      let nonArchivedProviderConvs: any[] = []
      if (providerProfiles && providerProfiles.length > 0) {
        // Query conversations for ALL provider profiles
        const providerIds = providerProfiles.map((p: any) => p.id)
        const { data: pConvs } = await supabase
          .from("conversations")
          .select("*")
          .in("provider_id", providerIds)

        console.log("[v0] ALL provider conversations (before archive filter):", pConvs?.length || 0)
        if (pConvs && pConvs.length > 0) {
          console.log(
            "[v0] Provider conversations details:",
            pConvs.map((c: any) => ({
              id: c.id,
              provider_id: c.provider_id,
              is_archived_by_seeker: c.is_archived_by_seeker,
              is_archived_by_provider: c.is_archived_by_provider,
            })),
          )
        }

        nonArchivedProviderConvs = pConvs?.filter((c: any) => !c.is_archived_by_provider) || []
        console.log("[v0] Non-archived provider conversations:", nonArchivedProviderConvs.length)
      }

      const allConvs = [...nonArchivedSeekerConvs, ...nonArchivedProviderConvs]
      console.log("[v0] TOTAL conversations found:", allConvs.length)

      if (allConvs.length === 0) {
        console.log("[v0] No conversations found for this user")
        console.log("[v0] ========== END FETCHING CONVERSATIONS ==========")
        setConversations([])
        return
      }

      const providerIds = [...new Set(allConvs.map((c: any) => c.provider_id))]
      const seekerIds = [...new Set(allConvs.map((c: any) => c.seeker_id))]

      const { data: providersData } = await supabase
        .from("providers")
        .select("id, name_ar, name_en, avatar_url")
        .in("id", providerIds)

      const { data: seekersData } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", seekerIds)

      console.log("[v0] Providers data:", providersData)
      console.log("[v0] Seekers data:", seekersData)

      const formattedConversations = allConvs.map((conv: any) => {
        const isUserSeeker = conv.seeker_id === userId

        if (isUserSeeker) {
          const provider = providersData?.find((p: any) => p.id === conv.provider_id)
          return {
            id: conv.id,
            provider_id: conv.provider_id,
            seeker_id: conv.seeker_id,
            last_message_at: conv.last_message_at,
            other_party_name: provider ? (language === "ar" ? provider.name_ar : provider.name_en) : "Unknown",
            other_party_avatar: provider?.avatar_url || "/placeholder.svg?height=48&width=48",
            is_provider: false,
            is_pinned: conv.is_pinned_by_seeker || false,
            is_archived: conv.is_archived_by_seeker || false,
            cleared_at: conv.seeker_cleared_at || null,
          }
        } else {
          const seeker = seekersData?.find((s: any) => s.id === conv.seeker_id)
          return {
            id: conv.id,
            provider_id: conv.provider_id,
            seeker_id: conv.seeker_id,
            last_message_at: conv.last_message_at,
            other_party_name: seeker?.full_name || "Unknown User",
            other_party_avatar: seeker?.avatar_url || "/placeholder.svg?height=48&width=48",
            is_provider: true,
            is_pinned: conv.is_pinned_by_provider || false,
            is_archived: conv.is_archived_by_provider || false,
            cleared_at: conv.provider_cleared_at || null,
          }
        }
      })

      console.log("[v0] Final formatted conversations:", formattedConversations.length)
      console.log("[v0] ========== END FETCHING CONVERSATIONS ==========")

      const sortedConversations = formattedConversations.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1
        if (!a.is_pinned && b.is_pinned) return 1
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      })

      // Deduplicate by conversation ID
      const seen = new Set<string>()
      const uniqueConversations = sortedConversations.filter((conv) => {
        if (seen.has(conv.id)) return false
        seen.add(conv.id)
        return true
      })

      setConversations(uniqueConversations || [])
    } catch (error) {
      console.error("[v0] Error fetching conversations:", error)
    }
  }

  const createOrOpenConversation = async (providerId: string) => {
    const supabase = createClient()

    try {
      console.log("[v0] Creating/opening conversation with provider:", providerId)

      // Validate that the providerId is a real provider
      const { data: providerExists, error: providerError } = await supabase
        .from("providers")
        .select("id")
        .eq("id", providerId)
        .single()

      if (providerError || !providerExists) {
        console.error("[v0] Invalid provider ID - provider does not exist:", providerId)
        router.replace("/messages", { scroll: false })
        return
      }

      const { data: existing, error: queryError } = await supabase
        .from("conversations")
        .select("*")
        .eq("seeker_id", user.id)
        .eq("provider_id", providerId)
        .single()

      console.log("[v0] Existing conversation query result:", existing, "Error:", queryError)

      if (existing) {
        console.log("[v0] Found existing conversation:", existing.id)
        console.log("[v0] Conversation archived status:", {
          is_archived_by_seeker: existing.is_archived_by_seeker,
          is_archived_by_provider: existing.is_archived_by_provider,
        })

        if (existing.is_archived_by_seeker) {
          console.log("[v0] Unarchiving conversation for seeker")
          const { error: updateError } = await supabase
            .from("conversations")
            .update({
              is_archived_by_seeker: false,
              last_message_at: new Date().toISOString(),
            })
            .eq("id", existing.id)

          if (updateError) {
            console.error("[v0] Error unarchiving conversation:", updateError)
          } else {
            console.log("[v0] Successfully unarchived conversation")
          }
        }

        // First refresh conversations list, then set selected
        await fetchConversations(user.id)
        setSelectedConversation(existing.id)
      } else {
        console.log("[v0] Creating new conversation")
        const { data: newConv, error: createError } = await supabase
          .from("conversations")
          .insert({
            seeker_id: user.id,
            provider_id: providerId,
          })
          .select()
          .single()

        console.log("[v0] New conversation created:", newConv, "Error:", createError)

        if (newConv) {
          // First refresh conversations list, then set selected
          await fetchConversations(user.id)
          setSelectedConversation(newConv.id)
        }
      }
      
      // Clear the URL parameter after processing
      router.replace("/messages", { scroll: false })
    } catch (error) {
      console.error("[v0] Error creating/opening conversation:", error)
    }
  }

  const fetchMessages = async (conversationId: string, clearedAt?: string | null) => {
    const supabase = createClient()

    try {
      console.log("[v0] ========== FETCHING MESSAGES ==========")
      console.log("[v0] Conversation ID:", conversationId)
      console.log("[v0] Current user ID:", user?.id)

      let query = supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })

      if (clearedAt) {
        query = query.gt("created_at", clearedAt)
      }

      const { data: result, error } = await query

      if (error) {
        console.error("[v0] Error fetching messages:", error)
        return
      }

      console.log("[v0] Fetched messages count:", result?.length || 0)

      setMessages(result || [])

      const unreadMessages = result?.filter((m: any) => !m.is_read && m.sender_id !== user.id)
      if (unreadMessages && unreadMessages.length > 0) {
        console.log("[v0] Marking", unreadMessages.length, "messages as read")
        for (const message of unreadMessages) {
          await supabase.from("messages").update({ is_read: true }).eq("id", message.id)
        }
      }

      if (result && result.length > 0) {
        console.log("[v0] Message sender IDs:", [...new Set(result.map((m: any) => m.sender_id))])
        console.log("[v0] Messages from current user:", result.filter((m: any) => m.sender_id === user?.id).length)
        console.log("[v0] Messages from other user:", result.filter((m: any) => m.sender_id !== user?.id).length)
      }
      console.log("[v0] ========== END FETCHING MESSAGES ==========")
    } catch (error) {
      console.error("[v0] Error fetching messages:", error)
    }
  }

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return

    const supabase = createClient()

    try {
      console.log("[v0] Sending message:", {
        conversation_id: selectedConversation,
        sender_id: user.id,
        content: newMessage,
      })

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: selectedConversation,
          sender_id: user.id,
          content: newMessage,
        })
        .select()
        .single()

      console.log("[v0] Message sent:", data, "Error:", error)

      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", selectedConversation)

      setNewMessage("")
      await fetchMessages(selectedConversation)
      await fetchConversations(user.id)

      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTo({
            top: messagesContainerRef.current.scrollHeight,
            behavior: "smooth",
          })
        }
      }, 100)
    } catch (error) {
      console.error("[v0] Error sending message:", error)
    }
  }

  const togglePin = async (conversationId: string, currentPinStatus: boolean) => {
    const supabase = createClient()
    const conversation = conversations.find((c) => c.id === conversationId)
    if (!conversation) return

    try {
      const updateField = conversation.is_provider ? "is_pinned_by_provider" : "is_pinned_by_seeker"

      await supabase
        .from("conversations")
        .update({ [updateField]: !currentPinStatus })
        .eq("id", conversationId)

      await fetchConversations(user.id)
    } catch (error) {
      console.error("[v0] Error toggling pin:", error)
    }
  }

  const archiveConversation = async (conversationId: string) => {
    const supabase = createClient()
    const conversation = conversations.find((c) => c.id === conversationId)
    if (!conversation) return

    try {
      const updateField = conversation.is_provider ? "is_archived_by_provider" : "is_archived_by_seeker"

      await supabase
        .from("conversations")
        .update({ [updateField]: true })
        .eq("id", conversationId)

      if (selectedConversation === conversationId) {
        setSelectedConversation(null)
      }

      await fetchConversations(user.id)
    } catch (error) {
      console.error("[v0] Error archiving conversation:", error)
    }
  }

  const clearChat = async () => {
    if (!selectedConversation || !currentConversation) return

    const supabase = createClient()

    try {
      const field = currentConversation.is_provider ? "provider_cleared_at" : "seeker_cleared_at"
      const { error } = await supabase
        .from("conversations")
        .update({ [field]: new Date().toISOString() })
        .eq("id", selectedConversation)

      if (error) {
        console.error("[v0] Error clearing chat:", error)
        return
      }

      setMessages([])
      setShowClearDialog(false)
      await fetchConversations(user.id)
    } catch (error) {
      console.error("[v0] Error clearing chat:", error)
    }
  }

  const currentConversation = conversations.find((c) => c.id === selectedConversation)

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
          <Card className="flex flex-col overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="font-bold text-xl mb-3">{t("المحادثات", "Messages")}</h2>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder={t("بحث...", "Search...")} className="pr-10" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                  <MessageCircle className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">{t("لا توجد محادثات بعد", "No conversations yet")}</p>
                  <Button variant="link" asChild className="mt-2">
                    <a href="/services/seeker">{t("تصفح المحترفين", "Browse Professionals")}</a>
                  </Button>
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors ${
                      selectedConversation === conv.id ? "bg-muted" : ""
                    }`}
                    onClick={() => setSelectedConversation(conv.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <img
                          src={conv.other_party_avatar || "/placeholder.svg"}
                          alt={conv.other_party_name}
                          className="h-full w-full object-cover"
                        />
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold truncate">{conv.other_party_name}</p>
                          {conv.is_pinned && <Pin className="h-4 w-4 text-primary shrink-0" />}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {new Date(conv.last_message_at).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Chat Area */}
          <Card className="flex flex-col overflow-hidden">
            {selectedConversation && currentConversation ? (
              <>
                <div className="p-4 border-b flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedConversation(null)} className="md:hidden">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Avatar className="h-10 w-10">
                    <img
                      src={currentConversation.other_party_avatar || "/placeholder.svg"}
                      alt={currentConversation.other_party_name}
                      className="h-full w-full object-cover"
                    />
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-semibold">{currentConversation.other_party_name}</p>
                    <p className="text-xs text-muted-foreground">{t("متصل", "Online")}</p>
                  </div>

                  {currentConversation.is_provider && userProfile?.role === "provider" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        console.log("[v0] ========== CREATE ORDER BUTTON CLICKED ==========")
                        console.log("[v0] Current conversation:", currentConversation)
                        console.log("[v0] Provider ID:", currentConversation.provider_id)
                        console.log("[v0] Seeker ID:", currentConversation.seeker_id)
                        console.log("[v0] Opening create order dialog...")
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
                        <Pin className="h-4 w-4 mr-2" />
                        {currentConversation.is_pinned ? t("إلغاء التثبيت", "Unpin") : t("تثبيت", "Pin")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowClearDialog(true)}>
                        <X className="h-4 w-4 mr-2" />
                        {t("مسح المحادثة", "Clear Chat")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setShowArchiveDialog(true)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t("إخفاء المحادثة", "Hide Conversation")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length === 0 && orders.length === 0 && (
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
                                      <img src={serviceCard.image_url} alt={name} className="w-full h-full object-cover" />
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
                                    <CheckCircle className="h-5 w-5 text-green-500 shrink-0 ml-2" />
                                  )}
                                </div>

                                <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                                  <div className="flex justify-between">
                                    <span>{t("المبلغ:", "Amount:")}</span>
                                    <span className="font-bold">{formatCurrency(order.amount_cents)}</span>
                                  </div>
                                  <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{t("رسوم المنصة:", "Platform Fee:")}</span>
                                    <span>-{formatCurrency(order.platform_fee_cents)}</span>
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
                                        ? "bg-yellow-100 text-yellow-800"
                                        : order.status === "paid"
                                          ? "bg-blue-100 text-blue-800"
                                          : order.status === "completed"
                                            ? "bg-green-100 text-green-800"
                                            : order.status === "awaiting_confirmation"
                                              ? "bg-purple-100 text-purple-800"
                                              : order.status === "cancelled"
                                                ? "bg-red-100 text-red-800"
                                                : "bg-gray-100 text-gray-800"
                                    }`}
                                  >
                                    {order.status === "pending" && t("قيد الانتظار", "Pending")}
                                    {order.status === "paid" && t("مدفوع", "Paid")}
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
                                            handleConfirmOrder(order.id)
                                          }}
                                          disabled={processingConfirmation}
                                          className="gap-2"
                                        >
                                          <CheckCircle className="h-4 w-4" />
                                          {processingConfirmation
                                            ? t("جاري المعالجة...", "Processing...")
                                            : t("تأكيد الاستلام", "Confirm Delivery")}
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
                                      {order.status === "paid" && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            handleCompleteOrder(order.id)
                                          }}
                                          className="gap-2"
                                        >
                                          <CheckCircle className="h-4 w-4" />
                                          {t("إكمال الطلب", "Complete Order")}
                                        </Button>
                                      )}
                                      {(order.status === "awaiting_confirmation" || order.status === "completed") && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            router.push("/dashboard")
                                          }}
                                          className="gap-2"
                                        >
                                          <Eye className="h-4 w-4" />
                                          {t("عرض التفاصيل", "View Details")}
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
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                      placeholder={t("اكتب رسالة...", "Type a message...")}
                      className="flex-1"
                    />
                    <Button onClick={sendMessage} disabled={!newMessage.trim()}>
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
          {console.log("[v0] ========== RENDERING CREATE ORDER DIALOG ==========")}
          {console.log("[v0] showCreateOrder:", showCreateOrder)}
          {console.log("[v0] selectedConversation:", selectedConversation)}
          {console.log("[v0] currentConversation:", currentConversation)}
          {console.log("[v0] Dialog props - conversationId:", selectedConversation)}
          {console.log("[v0] Dialog props - seekerId:", currentConversation.seeker_id)}
          {console.log("[v0] Dialog props - providerId:", currentConversation.provider_id)}
          <CreateOrderDialog
            conversationId={selectedConversation}
            seekerId={currentConversation.seeker_id}
            providerId={currentConversation.provider_id}
            prefill={orderPrefill ?? undefined}
            onClose={() => {
              console.log("[v0] Closing create order dialog")
              setShowCreateOrder(false)
              setOrderPrefill(null)
            }}
            onSuccess={() => {
              console.log("[v0] Order created successfully!")
              if (selectedConversation) {
                fetchOrders(selectedConversation)
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
              {t("خدمات مقدم الخدمة", "Provider Services")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {loadingServices ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : providerServices.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Briefcase className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>{t("لا توجد خدمات متاحة", "No services available")}</p>
              </div>
            ) : (
              providerServices.map((service) => {
                const name = language === "ar" ? service.name_ar : service.name_en
                const desc = language === "ar" ? service.description_ar : service.description_en
                const cover = service.image_urls?.[0]
                return (
                  <div key={service.id} className="flex gap-3 p-3 rounded-xl border bg-card hover:bg-muted/40 transition-colors">
                    {cover ? (
                      <div className="h-16 w-20 rounded-lg overflow-hidden shrink-0">
                        <img src={cover} alt={name} className="w-full h-full object-cover" />
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
                        >
                          <Send className="h-3 w-3" />
                          {t("إرسال", "Send")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
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
    </div>
  )
}
