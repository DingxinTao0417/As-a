import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react"
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest"
import { OrderDeliveryDialog } from "@/components/order-delivery-dialog"
import { LanguageProvider } from "@/components/language-provider"
import { installBrowserStorage } from "./browser-storage"

const mocks=vi.hoisted(()=>({
  submitOrderDelivery:vi.fn(),
  getOrderDeliveryRequest:vi.fn(),
  confirmOrder:vi.fn(),
  requestOrderRevision:vi.fn(),
  getUser:vi.fn(),
  list:vi.fn(),
  upload:vi.fn(),
  remove:vi.fn(),
  createSignedUrl:vi.fn(),
}))

vi.mock("@/app/actions/orders",()=>({
  submitOrderDelivery:mocks.submitOrderDelivery,
  getOrderDeliveryRequest:mocks.getOrderDeliveryRequest,
  confirmOrder:mocks.confirmOrder,
  requestOrderRevision:mocks.requestOrderRevision,
}))
vi.mock("@/lib/supabase/client",()=>({
  createClient:()=>({
    auth:{getUser:mocks.getUser},
    storage:{from:vi.fn(()=>({list:mocks.list,upload:mocks.upload,remove:mocks.remove,createSignedUrl:mocks.createSignedUrl}))},
  }),
}))

const userId="10000000-0000-4000-8000-000000000001"
const orderId="40000000-0000-4000-8000-000000000001"
const requestId="80000000-0000-4000-8000-000000000001"

beforeEach(()=>{
  vi.resetAllMocks()
  installBrowserStorage()
  window.localStorage.setItem("language","en")
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}})
  vi.spyOn(globalThis.crypto,"randomUUID").mockReturnValue(requestId as `${string}-${string}-${string}-${string}-${string}`)
  mocks.getUser.mockResolvedValue({data:{user:{id:userId}},error:null})
  mocks.list.mockResolvedValue({data:[],error:null})
  mocks.upload.mockResolvedValue({data:{path:"uploaded"},error:null})
  mocks.remove.mockResolvedValue({data:[],error:null})
  mocks.createSignedUrl.mockResolvedValue({data:{signedUrl:"https://signed.example.test/file"},error:null})
  mocks.getOrderDeliveryRequest.mockResolvedValue({success:true,data:{delivery:null}})
  mocks.submitOrderDelivery.mockResolvedValue({success:true,data:{delivery:{id:"delivery-1"}}})
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})

function renderProvider(onOpenChange=vi.fn()){
  render(<LanguageProvider><OrderDeliveryDialog
    order={{id:orderId,status:"paid"}}
    role="provider"
    open
    onOpenChange={onOpenChange}
  /></LanguageProvider>)
  return onOpenChange
}

async function fillDeliveryFile(){
  fireEvent.change(screen.getByLabelText("Delivery summary"),{target:{value:"Final files and usage instructions"}})
  const file=new File(["final"],"final.pdf",{type:"application/pdf",lastModified:1})
  fireEvent.change(screen.getByLabelText(/Private files/),{target:{files:[file]}})
  fireEvent.click(screen.getByRole("button",{name:"Submit Delivery"}))
  return file
}

describe("order delivery dialog",()=>{
  it("uploads a private file and submits its trusted metadata",async()=>{
    const onOpenChange=renderProvider()
    const file=await fillDeliveryFile()
    const path=`${orderId}/${userId}/${requestId}-0.pdf`
    await waitFor(()=>expect(mocks.submitOrderDelivery).toHaveBeenCalledWith({
      orderId,
      clientRequestId:requestId,
      note:"Final files and usage instructions",
      links:[],
      files:[{path,name:"final.pdf",mime:"application/pdf",size:file.size}],
    }))
    expect(mocks.upload).toHaveBeenCalledWith(path,file,{contentType:"application/pdf",upsert:false})
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("recovers an accepted request after an unknown client result without uploading twice",async()=>{
    const onOpenChange=renderProvider()
    mocks.submitOrderDelivery.mockResolvedValueOnce({success:false,error:"Delivery unavailable"})
    await fillDeliveryFile()
    expect(await screen.findByRole("alert")).toHaveTextContent("Keep the form unchanged")
    mocks.getOrderDeliveryRequest.mockResolvedValueOnce({success:true,data:{delivery:{id:"delivery-1"}}})
    fireEvent.click(screen.getByRole("button",{name:"Submit Delivery"}))
    await waitFor(()=>expect(mocks.getOrderDeliveryRequest).toHaveBeenCalledWith(orderId,requestId))
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("creates a signed link for a participant viewing a private delivery file",async()=>{
    const path=`${orderId}/${userId}/${requestId}-0.pdf`
    render(<LanguageProvider><OrderDeliveryDialog
      order={{id:orderId,status:"awaiting_confirmation",delivery_version:1,latest_delivery_files:[{path,name:"final.pdf",mime:"application/pdf",size:100}]}}
      role="seeker"
      open
      onOpenChange={()=>{}}
    /></LanguageProvider>)
    expect(await screen.findByRole("link",{name:"final.pdf"})).toHaveAttribute("href","https://signed.example.test/file")
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(path,600)
  })
})
