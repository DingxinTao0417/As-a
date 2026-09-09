import {Readable} from "node:stream"
import {createGzip} from "node:zlib"

export type ArchiveEntry={name:string;open:()=>Promise<Uint8Array>}

function writeText(buffer:Buffer,offset:number,length:number,value:string){
  Buffer.from(value).copy(buffer,offset,0,Math.min(length,Buffer.byteLength(value)))
}
function writeOctal(buffer:Buffer,offset:number,length:number,value:number){
  const octal=Math.max(0,Math.floor(value)).toString(8).padStart(length-1,"0").slice(-(length-1))
  writeText(buffer,offset,length,`${octal}\0`)
}

export function createTarHeader(name:string,size:number,modifiedAt=Math.floor(Date.now()/1000)){
  if(!name||Buffer.byteLength(name)>100||!Number.isSafeInteger(size)||size<0)throw new Error("Invalid archive entry")
  const header=Buffer.alloc(512)
  writeText(header,0,100,name)
  writeOctal(header,100,8,0o644)
  writeOctal(header,108,8,0)
  writeOctal(header,116,8,0)
  writeOctal(header,124,12,size)
  writeOctal(header,136,12,modifiedAt)
  header.fill(0x20,148,156)
  header[156]="0".charCodeAt(0)
  writeText(header,257,6,"ustar\0")
  writeText(header,263,2,"00")
  writeText(header,265,32,"asaa")
  writeText(header,297,32,"asaa")
  const checksum=header.reduce((sum,value)=>sum+value,0)
  writeText(header,148,8,`${checksum.toString(8).padStart(6,"0")}\0 `)
  return header
}

async function* tarChunks(entries:ArchiveEntry[]){
  for(const entry of entries){
    const content=Buffer.from(await entry.open())
    yield createTarHeader(entry.name,content.byteLength)
    yield content
    const padding=(512-content.byteLength%512)%512
    if(padding)yield Buffer.alloc(padding)
  }
  yield Buffer.alloc(1024)
}

export function createTarGzipStream(entries:ArchiveEntry[]){
  const source=Readable.from(tarChunks(entries))
  const gzip=createGzip({level:6})
  source.once("error",(error)=>gzip.destroy(error))
  return source.pipe(gzip)
}

export function safeArchivePath(index:number,bucket:string,path:string){
  const basename=path.split("/").at(-1)||"file"
  const safe=basename.replace(/[^A-Za-z0-9._-]/g,"_").slice(-70)||"file"
  const bucketName=bucket.replace(/[^A-Za-z0-9._-]/g,"_").slice(0,24)
  return `private/${String(index+1).padStart(4,"0")}-${bucketName}-${safe}`
}
