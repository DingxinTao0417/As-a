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

test("completes an administrator support handoff with realtime user notifications",async({browser})=>{
  test.setTimeout(90_000)
  const trusted=trustedClient()
  const password="BrowserSupport!2026"
  const adminEmail="support-flow-admin@as-a.local"
  const userEmail="support-flow-user@as-a.local"
  const subject="Browser support workflow"
  let adminContext:BrowserContext|undefined
  let userContext:BrowserContext|undefined

  try{
    const admin=await trusted.auth.admin.createUser({
      email:adminEmail,password,email_confirm:true,
      user_metadata:{full_name:"Browser Support Admin",role:"seeker"},
    })
    const user=await trusted.auth.admin.createUser({
      email:userEmail,password,email_confirm:true,
      user_metadata:{full_name:"Browser Support User",role:"seeker"},
    })
    expect(admin.error).toBeNull()
    expect(user.error).toBeNull()
    expect((await trusted.from("profiles").update({is_admin:true}).eq("id",admin.data.user!.id)).error).toBeNull()

    adminContext=await browser.newContext()
    userContext=await browser.newContext()
    const adminPage=await adminContext.newPage()
    const userPage=await userContext.newPage()
    await Promise.all([
      adminPage.addInitScript(()=>window.localStorage.setItem("language","en")),
      userPage.addInitScript(()=>window.localStorage.setItem("language","en")),
    ])
    await Promise.all([
      login(adminPage,adminEmail,password),
      login(userPage,userEmail,password),
    ])

    await userPage.goto("/support")
    await userPage.getByRole("button",{name:"New Ticket",exact:true}).click()
    const createDialog=userPage.getByRole("dialog",{name:"New Support Ticket"})
    await createDialog.getByLabel("Subject").fill(subject)
    await createDialog.getByLabel("Details").fill("Please verify the complete browser support workflow.")
    await createDialog.getByRole("button",{name:"Create Ticket",exact:true}).click()
    await expect(userPage.getByText("Support ticket created",{exact:true})).toBeVisible()
    await expect(userPage.getByRole("heading",{name:subject,exact:true})).toBeVisible()

    await adminPage.goto("/admin/support")
    await adminPage.getByRole("button").filter({hasText:subject}).click()
    await expect(adminPage.getByRole("heading",{name:subject,exact:true})).toBeVisible()
    await userPage.goto("/notifications")
    await expect(userPage.getByRole("heading",{name:"Notifications",exact:true})).toBeVisible()

    await adminPage.getByPlaceholder("Write a reply...").fill("Administrator browser reply")
    await adminPage.getByRole("button",{name:"Send reply",exact:true}).click()
    await expect(adminPage.getByText("Reply sent",{exact:true})).toBeVisible()
    await expect(userPage.getByRole("heading",{name:"New support reply",exact:true})).toBeVisible({timeout:30_000})
    await userPage.getByRole("heading",{name:"New support reply",exact:true}).click()
    await expect(userPage).toHaveURL(/\/support\?ticket=/)
    await expect(userPage.getByText("Administrator browser reply",{exact:true})).toBeVisible()

    await userPage.getByPlaceholder("Add a reply...").fill("User browser follow-up")
    await userPage.getByRole("button",{name:"Send reply",exact:true}).click()
    await expect(userPage.getByText("Reply sent",{exact:true})).toBeVisible()
    await adminPage.reload()
    await adminPage.getByRole("button").filter({hasText:subject}).click()
    await expect(adminPage.getByText("User browser follow-up",{exact:true})).toBeVisible()

    await userPage.goto("/notifications")
    await adminPage.getByRole("combobox").click()
    await adminPage.getByRole("option",{name:"closed",exact:true}).click()
    await adminPage.getByPlaceholder("Reason for the audit record...").fill("Support workflow completed")
    await adminPage.getByRole("button",{name:"Save Status",exact:true}).click()
    await expect(adminPage.getByText("Status updated",{exact:true})).toBeVisible()
    await expect(userPage.getByRole("heading",{name:"Support ticket updated",exact:true})).toBeVisible({timeout:30_000})
    await userPage.getByRole("heading",{name:"Support ticket updated",exact:true}).click()
    await expect(userPage.getByRole("button").filter({hasText:subject})).toContainText("closed")
    await expect(userPage.getByPlaceholder("Add a reply...")).not.toBeVisible()

    const ticket=await trusted.from("support_tickets").select("id,status,assigned_to").eq("subject",subject).single()
    expect(ticket.error).toBeNull()
    if(!ticket.data)throw new Error("Support ticket could not be read")
    expect(ticket.data).toMatchObject({status:"closed",assigned_to:admin.data.user!.id})
    const messages=await trusted.from("support_ticket_messages").select("body").eq("ticket_id",ticket.data.id).order("created_at")
    expect(messages.error).toBeNull()
    expect(messages.data?.map((message)=>message.body)).toEqual(["Administrator browser reply","User browser follow-up"])
  }finally{
    await Promise.allSettled([adminContext?.close(),userContext?.close()])
    trusted.realtime.disconnect()
  }
})
