import { describe,expect,it } from "vitest"
import {
  MAX_DELIVERY_FILE_SIZE,
  deliveryFileAllowed,
  deliveryFilePath,
} from "@/lib/delivery-files"

const orderId="40000000-0000-4000-8000-000000000001"
const userId="10000000-0000-4000-8000-000000000001"
const requestId="80000000-0000-4000-8000-000000000001"

describe("private delivery file rules",()=>{
  it("accepts documented file types within the 25MB boundary",()=>{
    expect(deliveryFileAllowed({type:"application/pdf",size:1})).toBe(true)
    expect(deliveryFileAllowed({type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",size:MAX_DELIVERY_FILE_SIZE})).toBe(true)
  })

  it("rejects executable, empty and oversized files",()=>{
    expect(deliveryFileAllowed({type:"application/octet-stream",size:100})).toBe(false)
    expect(deliveryFileAllowed({type:"application/pdf",size:0})).toBe(false)
    expect(deliveryFileAllowed({type:"application/pdf",size:MAX_DELIVERY_FILE_SIZE+1})).toBe(false)
  })

  it("builds a stable request-scoped storage path",()=>{
    expect(deliveryFilePath(orderId,userId,requestId,0,"application/pdf")).toBe(`${orderId}/${userId}/${requestId}-0.pdf`)
    expect(deliveryFilePath(orderId,userId,requestId,5,"application/pdf")).toBeNull()
    expect(deliveryFilePath(orderId,userId,requestId,0,"application/octet-stream")).toBeNull()
  })
})
