import { buffer as consume } from "node:stream/consumers"
import { gunzipSync } from "node:zlib"
import { createClient } from "@supabase/supabase-js"
import { expect,test,type BrowserContext,type Page } from "@playwright/test"

test.skip(process.env.SUPABASE_INTEGRATION!=="true","requires Supabase Local")

function trustedClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key)throw new Error("Supabase Local credentials are unavailable")
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
}

async function login(page:Page,email:string,password:string){
  await page.goto("/auth/login")
  await page.getByLabel("Email",{exact:true}).fill(email)
  await page.getByLabel("Password",{exact:true}).fill(password)
  await page.getByRole("button",{name:"Login",exact:true}).click()
  await expect(page.getByRole("button",{name:email.split("@")[0]})).toBeVisible()
}

function readTar(buffer:Buffer){
  const files=new Map<string,Buffer>()
  let offset=0
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

test("downloads an authenticated archive containing only the current account",async({browser})=>{
  test.setTimeout(60_000)
  const trusted=trustedClient()
  const password="BrowserExport!2026"
  const email="export-flow-user@as-a.local"
  const otherEmail="export-flow-other@as-a.local"
  let context:BrowserContext|undefined

  try{
    const user=await trusted.auth.admin.createUser({
      email,password,email_confirm:true,user_metadata:{full_name:"Browser Export User",role:"seeker"},
    })
    const other=await trusted.auth.admin.createUser({
      email:otherEmail,password,email_confirm:true,user_metadata:{full_name:"Browser Export Other",role:"seeker"},
    })
    expect(user.error).toBeNull()
    expect(other.error).toBeNull()
    context=await browser.newContext({acceptDownloads:true})
    const page=await context.newPage()
    await page.addInitScript(()=>window.localStorage.setItem("language","en"))
    await login(page,email,password)
    await page.goto("/profile")

    const downloadPromise=page.waitForEvent("download")
    await page.getByRole("button",{name:"Export My Data",exact:true}).click()
    const download=await downloadPromise
    expect(download.suggestedFilename()).toMatch(new RegExp(`^asaa-user-data-${user.data.user!.id}-\\d{4}-\\d{2}-\\d{2}\\.tar\\.gz$`))
    const stream=await download.createReadStream()
    expect(stream).toBeTruthy()
    const archive=gunzipSync(await consume(stream!))
    const files=readTar(archive)
    expect([...files.keys()]).toContain("export.json")
    const envelope=JSON.parse(files.get("export.json")!.toString("utf8"))
    expect(envelope).toMatchObject({
      format:"asaa-user-data",format_version:11,
      account:{id:user.data.user!.id,email},
      data:{schema_version:10,profile:{id:user.data.user!.id,email}},
      archive:{format:"tar.gz"},
    })
    expect(JSON.stringify(envelope)).not.toContain(otherEmail)
    await expect(page.getByText("Data exported",{exact:true})).toBeVisible()
  }finally{
    await context?.close()
    trusted.realtime.disconnect()
  }
})
