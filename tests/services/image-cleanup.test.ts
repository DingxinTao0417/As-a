import { beforeEach,describe,expect,it } from "vitest"
import {
  enqueueServiceImageCleanup,
  readServiceImageCleanupJobs,
  writeServiceImageCleanupJobs,
} from "@/lib/service-image-cleanup"

const providerId="20000000-0000-4000-8000-000000000001"
const serviceId="30000000-0000-4000-8000-000000000001"
const firstPath=`${providerId}/${serviceId}/first.webp`
const secondPath=`${providerId}/${serviceId}/second.webp`

beforeEach(()=>window.localStorage.clear())

describe("service image cleanup queue",()=>{
  it("keeps a deduplicated provider-scoped retry list",()=>{
    expect(enqueueServiceImageCleanup(providerId,serviceId,[firstPath,firstPath,"other/service/file.webp"])).toBe(true)
    expect(enqueueServiceImageCleanup(providerId,serviceId,[secondPath])).toBe(true)
    expect(readServiceImageCleanupJobs(providerId)).toEqual([{serviceId,paths:[firstPath,secondPath]}])
  })

  it("discards malformed, cross-provider and traversal entries",()=>{
    window.localStorage.setItem(`asaa:service-image-cleanup:${providerId}`,JSON.stringify([
      {serviceId,paths:[firstPath,`${providerId}/${serviceId}/../other.webp`,"wrong/file.webp"]},
      {serviceId:42,paths:[firstPath]},
    ]))
    expect(readServiceImageCleanupJobs(providerId)).toEqual([{serviceId,paths:[firstPath]}])
  })

  it("removes the queue after cleanup succeeds",()=>{
    enqueueServiceImageCleanup(providerId,serviceId,[firstPath])
    expect(writeServiceImageCleanupJobs(providerId,[])).toBe(true)
    expect(readServiceImageCleanupJobs(providerId)).toEqual([])
  })
})
