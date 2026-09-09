/** Runs the opt-in browser Auth flow against Supabase Local without printing local keys. */
import { execFileSync,spawnSync } from "node:child_process"

function localEnvironment(){
  try{
    const output=execFileSync("supabase",["status","--output","env"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]})
    const values={}
    for(const line of output.split("\n")){
      const match=line.match(/^([A-Z0-9_]+)=(.*)$/)
      if(!match)continue
      const raw=match[2].trim()
      values[match[1]]=raw.startsWith('"')?JSON.parse(raw):raw
    }
    if(!values.API_URL||!values.ANON_KEY||!values.SERVICE_ROLE_KEY||!values.MAILPIT_URL)throw new Error()
    return values
  }catch{
    console.error("Supabase Local is not running or did not provide the required local credentials.")
    process.exit(1)
  }
}

const local=localEnvironment()
const result=spawnSync("npx",["playwright","test","e2e/auth-integration.spec.ts","e2e/admin-integration.spec.ts","e2e/order-lifecycle-integration.spec.ts","e2e/service-lifecycle-integration.spec.ts","e2e/verification-integration.spec.ts","e2e/account-deletion-integration.spec.ts","e2e/support-integration.spec.ts","e2e/data-export-integration.spec.ts","e2e/refund-integration.spec.ts","--workers=1","--reporter=line"],{
  env:{...process.env,SUPABASE_INTEGRATION:"true",NEXT_PUBLIC_SUPABASE_URL:local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,
    MAILPIT_URL:local.MAILPIT_URL,NEXT_PUBLIC_SITE_URL:"http://127.0.0.1:3107"},
  stdio:"inherit",
})
process.exit(result.status??1)
