import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Header } from "@/components/header"
import { LanguageProvider } from "@/components/language-provider"
import { installBrowserStorage } from "./browser-storage"

const mocks = vi.hoisted(() => ({
  getUser:vi.fn(),
  signOut:vi.fn(),
  profileResult:{ data:null as unknown,error:null as unknown },
  getMyNotifications:vi.fn(),
  push:vi.fn(),
  refresh:vi.fn(),
  unsubscribe:vi.fn(),
}))

function profileQuery(){
  const query:Record<string,unknown>={ data:mocks.profileResult.data,error:mocks.profileResult.error }
  for(const method of ["select","eq","maybeSingle"])query[method]=vi.fn(()=>query)
  return query
}
function realtimeChannel(){
  const channel={on:vi.fn(),subscribe:vi.fn(),unsubscribe:mocks.unsubscribe}
  channel.on.mockReturnValue(channel)
  channel.subscribe.mockReturnValue(channel)
  return channel
}

vi.mock("@/lib/supabase/client",()=>({
  createClient:()=>({
    auth:{
      getUser:mocks.getUser,
      signOut:mocks.signOut,
      onAuthStateChange:vi.fn(()=>({ data:{ subscription:{ unsubscribe:mocks.unsubscribe } } })),
    },
    from:vi.fn(()=>profileQuery()),
    channel:vi.fn(()=>realtimeChannel()),
  }),
}))
vi.mock("@/app/actions/notifications",()=>({ getMyNotifications:mocks.getMyNotifications }))
vi.mock("next/navigation",()=>({ useRouter:()=>({ push:mocks.push,refresh:mocks.refresh }) }))
vi.mock("next-themes",()=>({useTheme:()=>({resolvedTheme:"light",setTheme:vi.fn()})}))

beforeEach(()=>{
  vi.resetAllMocks()
  installBrowserStorage()
  window.localStorage.setItem("language","en")
  mocks.signOut.mockResolvedValue({ error:null })
  mocks.getMyNotifications.mockResolvedValue({ success:true,data:{ unreadCount:0,notifications:[] } })
  mocks.profileResult={ data:{ role:"provider" },error:null }
})
afterEach(()=>cleanup())

describe("header account context",()=>{
  it("does not present a failed session lookup as a logged-out state",async()=>{
    mocks.getUser.mockResolvedValue({ data:{ user:null },error:new Error("unavailable") })
    render(<LanguageProvider><Header /></LanguageProvider>)
    expect(await screen.findByRole("button",{ name:"Account unavailable" })).toBeDisabled()
    expect(screen.queryByRole("link",{ name:"Login" })).not.toBeInTheDocument()
  })

  it("marks notification state unavailable instead of displaying a false zero",async()=>{
    mocks.getUser.mockResolvedValue({ data:{ user:{ id:"user-1",email:"provider@example.test" } },error:null })
    mocks.getMyNotifications.mockResolvedValue({ success:false,error:"Notifications could not be loaded" })
    render(<LanguageProvider><Header /></LanguageProvider>)
    expect(await screen.findByRole("link",{ name:"Notifications unavailable" })).toBeVisible()
  })
})
