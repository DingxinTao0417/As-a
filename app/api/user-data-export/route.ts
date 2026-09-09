import {Readable} from "node:stream"
import {AuthError,requireAuth} from "@/lib/auth"
import {createAdminClient} from "@/lib/supabase/admin"
import {createTarGzipStream,safeArchivePath,type ArchiveEntry} from "@/lib/tar-archive"
import {createUserDataEnvelope,loadUserDataSnapshot} from "@/lib/user-data-export"

export const runtime="nodejs"
export const dynamic="force-dynamic"

async function downloadBytes(value:unknown){
  if(ArrayBuffer.isView(value)){
    const view=value as ArrayBufferView
    return new Uint8Array(view.buffer,view.byteOffset,view.byteLength)
  }
  if(value instanceof ArrayBuffer)return new Uint8Array(value)
  if(value&&typeof value==="object"&&"arrayBuffer" in value
    &&typeof (value as {arrayBuffer?:unknown}).arrayBuffer==="function"){
    return new Uint8Array(await (value as {arrayBuffer:()=>Promise<ArrayBuffer>}).arrayBuffer())
  }
  throw new Error("Unsupported private export file")
}

export async function GET(){
  try{
    const {user}=await requireAuth()
    const admin=createAdminClient()
    const {snapshot,privateFiles}=await loadUserDataSnapshot(user,admin)
    const archiveFiles=privateFiles.map((file,index)=>({...file,archive_path:safeArchivePath(index,file.bucket,file.path)}))
    const envelope=createUserDataEnvelope(user,snapshot,{
      archive:{format:"tar.gz",private_files:archiveFiles},
      private_file_downloads:[],
    })
    const json=Buffer.from(JSON.stringify(envelope,null,2),"utf8")
    const entries:ArchiveEntry[]=[
      {name:"export.json",open:async()=>json},
      ...archiveFiles.map((file)=>({
        name:file.archive_path,
        open:async()=>{
          const {data,error}=await admin.storage.from(file.bucket).download(file.path)
          if(error||!data)throw new Error("Private export file could not be downloaded")
          return downloadBytes(data)
        },
      })),
    ]
    const stream=createTarGzipStream(entries)
    const date=new Date().toISOString().slice(0,10)
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{
      headers:{
        "Content-Type":"application/gzip",
        "Content-Disposition":`attachment; filename="asaa-user-data-${user.id}-${date}.tar.gz"`,
        "Cache-Control":"private, no-store, max-age=0",
        "X-Content-Type-Options":"nosniff",
      },
    })
  }catch(error){
    if(error instanceof AuthError)return Response.json({error:error.message},{status:401})
    return Response.json({error:"Data export could not be completed"},{status:500})
  }
}
