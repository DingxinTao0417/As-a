"use client"

import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useLanguage } from "@/components/language-provider"
import { MessageCircle, Send, Search, ArrowLeft, MoreVertical, Pin, Trash2, X } from "lucide-react"
import { useState, useEffect, useRef } from "react"
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

export default function MessagesPage() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<any>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [showClearDialog, setShowClearDialog] = useState(false)

  useEffect(() => {
    checkAuthAndFetchData()
  }, [])

  useEffect(() => {
    const providerId = searchParams.get("provider")
    if (providerId && user) {
      createOrOpenConversation(providerId)
    }
  }, [searchParams, user])

  useEffect(() => {
    if (selectedConversation) {
      fetchMessages(selectedConversation)

      const interval = setInterval(() => fetchMessages(selectedConversation), 3000)
      return () => clearInterval(interval)
    }
  }, [selectedConversation])

  const checkAuthAndFetchData = async () => {
    const supabase = createClient()
    const { data } = await supabase.auth.getUser()

    console.log("[v0] Current user:", data.user?.id)

    if (!data.user) {
      router.push("/auth/login")
      return
    }

    setUser(data.user)
    await fetchConversations(data.user.id)
    setIsLoading(false)
  }

  const fetchConversations = async (userId: string) => {
    const supabase = createClient()

    try {
      console.log("[v0] Fetching conversations for user:", userId)

      const { data: seekerConvs, error: seekerError } = await supabase
        .from("conversations")
        .select("*")
        .eq("seeker_id", userId)
        .eq("is_archived_by_seeker", false)

      console.log("[v0] Seeker conversations:", seekerConvs)

      const { data: providerProfile } = await supabase.from("providers").select("id").eq("user_id", userId).single()

      console.log("[v0] Provider profile:", providerProfile)

      let providerConvs: any[] = []
      if (providerProfile) {
        const { data: pConvs } = await supabase
          .from("conversations")
          .select("*")
          .eq("provider_id", providerProfile.id)
          .eq("is_archived_by_provider", false)

        console.log("[v0] Provider conversations:", pConvs)
        providerConvs = pConvs || []
      }

      const allConvs = [...(seekerConvs || []), ...providerConvs]
      console.log("[v0] Total conversations:", allConvs.length)

      if (allConvs.length === 0) {
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

      const sortedConversations = formattedConversations.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1
        if (!a.is_pinned && b.is_pinned) return 1
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      })

      console.log("[v0] Formatted conversations:", sortedConversations)
      setConversations(sortedConversations || [])
    } catch (error) {
      console.error("[v0] Error fetching conversations:", error)
    }
  }

  const createOrOpenConversation = async (providerId: string) => {
    const supabase = createClient()

    try {
      console.log("[v0] Creating/opening conversation with provider:", providerId)

      const { data: existing } = await supabase
        .from("conversations")
        .select("*")
        .eq("seeker_id", user.id)
        .eq("provider_id", providerId)
        .single()

      if (existing) {
        console.log("[v0] Found existing conversation:", existing.id)
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
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })

      if (error) {
        console.error("[v0] Error fetching messages:", error)
        return
      }

      setMessages(data || [])

      const unreadMessages = data?.filter((m: any) => !m.is_read && m.sender_id !== user.id)
      if (unreadMessages && unreadMessages.length > 0) {
        for (const message of unreadMessages) {
          await supabase.from("messages").update({ is_read: true }).eq("id", message.id)
        }
      }
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
                    <Button onClick={sendMessage} size="icon" className="shrink-0">
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

      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("مسح المحادثة", "Clear Chat")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "هل أنت متأكد من مسح جميع الرسائل في هذه المحادثة؟ لا يمكن التراجع عن هذا الإجراء.",
                "Are you sure you want to clear all messages in this conversation? This action cannot be undone.",
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

      <Footer />
    </div>
  )
}
