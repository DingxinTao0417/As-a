import {gunzipSync} from "node:zlib"
import {beforeEach,describe,expect,it,vi} from "vitest"

const mocks=vi.hoisted(()=>({requireAuth:vi.fn(),rpc:vi.fn(),storageFrom:vi.fn(),download:vi.fn()}))
vi.mock("@/lib/auth",async()=>{const actual=await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");return{...actual,requireAuth:mocks.requireAuth}})
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc,storage:{from:mocks.storageFrom}})}))

import {GET} from "@/app/api/user-data-export/route"
import {AuthError} from "@/lib/auth"

const userId="10000000-0000-4000-8000-000000000001"
const path="order/provider/final.pdf"

function readTar(buffer:Buffer){
  const files=new Map<string,Buffer>();let offset=0
  while(offset+512<=buffer.length){
    const header=buffer.subarray(offset,offset+512)
    if(header.every((value)=>value===0))break
    const name=header.subarray(0,100).toString("utf8").replace(/\0.*$/,"")
    const sizeText=header.subarray(124,136).toString("ascii").replace(/\0.*$/,"").trim()
    const size=Number.parseInt(sizeText||"0",8)
    const start=offset+512
    files.set(name,buffer.subarray(start,start+size))
    offset=start+Math.ceil(size/512)*512
  }
  return files
}

beforeEach(()=>{
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({user:{
    id:userId,email:"user@example.test",phone:null,created_at:"2026-09-08T00:00:00.000Z",
    last_sign_in_at:"2026-09-09T00:00:00.000Z",user_metadata:{},app_metadata:{},
  }})
  mocks.rpc.mockResolvedValue({data:{
    schema_version:10,profile:{id:userId},order_deliveries:[{files:[{path}]}],
    dispute_evidence:[],provider_verification_documents:[],
  },error:null})
  mocks.storageFrom.mockReturnValue({download:mocks.download})
  mocks.download.mockResolvedValue({data:{
    arrayBuffer:async()=>new TextEncoder().encode("private-file-body").buffer,
  },error:null})
})

describe("user data archive API",()=>{
  it("streams JSON and private files in one gzip-compressed tar archive",async()=>{
    const response=await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/gzip")
    expect(response.headers.get("cache-control")).toContain("no-store")
    const files=readTar(gunzipSync(Buffer.from(await response.arrayBuffer())))
    expect(files.has("export.json")).toBe(true)
    const envelope=JSON.parse(files.get("export.json")!.toString("utf8"))
    expect(envelope).toMatchObject({
      format:"asaa-user-data",format_version:11,data:{schema_version:10},
      archive:{format:"tar.gz",private_files:[{bucket:"order-deliveries",path}]},
    })
    const archivePath=envelope.archive.private_files[0].archive_path
    expect(files.get(archivePath)?.toString("utf8")).toBe("private-file-body")
    expect(mocks.download).toHaveBeenCalledWith(path)
  })

  it("returns an authentication error before preparing an archive",async()=>{
    mocks.requireAuth.mockRejectedValue(new AuthError("Not logged in","UNAUTHENTICATED"))
    const response=await GET()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({error:"Not logged in"})
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("terminates the archive stream when a private file cannot be downloaded",async()=>{
    mocks.download.mockResolvedValue({data:null,error:new Error("storage unavailable")})
    const response=await GET()
    await expect(response.arrayBuffer()).rejects.toThrow()
  })
})
