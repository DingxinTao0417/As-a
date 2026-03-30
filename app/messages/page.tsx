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
import { CreateOrderDialog } from "@/components/create-order-dialog"
import { createCheckoutSession, completeOrder, confirmOrder } from "@/app/actions/orders"
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
  const [orders, setOrders] = useState<Order[]>([])
  const [showCreateOrder, setShowCreateOrder] = useState(false)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [processingConfirmation, setProcessingConfirmation] = useState(false)
  
  // Realtime subscriptions
  const messagesChannelRef = useRef<RealtimeChannel | null>(null)
  const conversationsChannelRef = useRef<RealtimeChannel | null>(null)
  const ordersChannelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    checkAuthAndFetchData()
    
    // Cleanup subscriptions on unmount
    return () => {
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
    if (providerId && user) {
      createOrOpenConversation(providerId)
    }
  }, [searchParams, user])

  // Setup Realtime subscription for messages when conversation is selected
  useEffect(() => {
    if (selectedConversation && user) {
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

    const { data } = await supabase.auth.getUser()

    if (!data.user) {
      console.warn("[v0] No authenticated user, redirecting to login")
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

      const { data: providerProfile } = await supabase.from("providers").select("id").eq("user_id", userId).single()

      console.log("[v0] Provider profile exists:", !!providerProfile)
      if (providerProfile) {
        console.log("[v0] Provider profile ID:", providerProfile.id)
      }

      let nonArchivedProviderConvs: any[] = []
      if (providerProfile) {
        const { data: pConvs } = await supabase.from("conversations").select("*").eq("provider_id", providerProfile.id)

        console.log("[v0] ALL provider conversations (before archive filter):", pConvs?.length || 0)
        if (pConvs && pConvs.length > 0) {
          console.log(
            "[v0] Provider conversations details:",
            pConvs.map((c: any) => ({
              id: c.id,
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

      setConversations(sortedConversations || [])
    } catch (error) {
      console.error("[v0] Error fetching conversations:", error)
    }
  }

  const createOrOpenConversation = async (providerId: string) => {
    const supabase = createClient()

    try {
      console.log("[v0] Creating/opening conversation with provider:", providerId)

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

        setSelectedConversation(existing.id)
        await fetchConversations(user.id)
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
          setSelectedConversation(newConv.id)
          await fetchConversations(user.id)
        }
      }
    } catch (error) {
      console.error("[v0] Error creating/opening conversation:", error)
    }
  }

  const fetchMessages = async (conversationId: string) => {
    const supabase = createClient()

    try {
      console.log("[v0] ========== FETCHING MESSAGES ==========")
      console.log("[v0] Conversation ID:", conversationId)
      console.log("[v0] Current user ID:", user?.id)

      const { data: result, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })

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
    if (!selectedConversation) return

    const supabase = createClient()

    try {
      await supabase.from("messages").delete().eq("conversation_id", selectedConversation)

      await supabase.from("orders").delete().eq("conversation_id", selectedConversation).eq("status", "pending")

      setMessages([])
      setOrders([])
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
                        onClick={() => archiveConversation(selectedConversation)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t("حذف المحادثة", "Delete Conversation")}
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

                  {messages.map((message) => (
                    <div
                      key={message.id}
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
                  ))}

                  {orders.map((order) => (
                    <div key={order.id} className="flex justify-center">
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
                            {order.seeker_id === user.id && (
                              <div className="flex gap-2">
                                {order.status === "pending" && (
                                  <Button
                                    size="sm"
                                    onClick={() => handlePayment(order.id)}
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
                                    onClick={() => handleConfirmOrder(order.id)}
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
                                    onClick={() => router.push("/history")}
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
                                    onClick={() => handleCompleteOrder(order.id)}
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
                                    onClick={() => router.push("/dashboard")}
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
                  ))}
                </div>

                <div className="p-4 border-t">
                  <div className="flex gap-2">
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
            onClose={() => {
              console.log("[v0] Closing create order dialog")
              setShowCreateOrder(false)
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

      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("مسح المحادثة", "Clear Chat")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "هل أنت متأكد من حذف جميع الرسائل؟ هذا الإجراء لا يمكن التراجع عنه.",
                "Are you sure you want to delete all messages? This action cannot be undone.",
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
    </div>
  )
}
