export type ServiceImageCleanupJob={ serviceId:string;paths:string[] }

function cleanupStorageKey(providerId:string){
  return `asaa:service-image-cleanup:${providerId}`
}

export function readServiceImageCleanupJobs(providerId:string,storage:Pick<Storage,"getItem">=window.localStorage):ServiceImageCleanupJob[]{
  try{
    const parsed:unknown=JSON.parse(storage.getItem(cleanupStorageKey(providerId))||"[]")
    if(!Array.isArray(parsed))return[]
    return parsed.flatMap((value):ServiceImageCleanupJob[]=>{
      if(!value||typeof value!=="object")return[]
      const candidate=value as {serviceId?:unknown;paths?:unknown}
      if(typeof candidate.serviceId!=="string"||!Array.isArray(candidate.paths))return[]
      const prefix=`${providerId}/${candidate.serviceId}/`
      const paths=candidate.paths.filter((path:unknown):path is string=>
        typeof path==="string"&&path.startsWith(prefix)&&!path.includes(".."),
      )
      return paths.length?[{serviceId:candidate.serviceId,paths:[...new Set(paths)]}]:[]
    })
  }catch{return[]}
}

export function writeServiceImageCleanupJobs(providerId:string,jobs:ServiceImageCleanupJob[],storage:Pick<Storage,"setItem"|"removeItem">=window.localStorage){
  try{
    if(jobs.length)storage.setItem(cleanupStorageKey(providerId),JSON.stringify(jobs))
    else storage.removeItem(cleanupStorageKey(providerId))
    return true
  }catch{return false}
}

export function enqueueServiceImageCleanup(providerId:string,serviceId:string,paths:string[],storage:Storage=window.localStorage){
  const prefix=`${providerId}/${serviceId}/`
  const safePaths=paths.filter((path)=>path.startsWith(prefix)&&!path.includes(".."))
  if(!safePaths.length)return false
  const jobs=readServiceImageCleanupJobs(providerId,storage)
  const existing=jobs.find((job)=>job.serviceId===serviceId)
  if(existing)existing.paths=[...new Set([...existing.paths,...safePaths])]
  else jobs.push({serviceId,paths:[...new Set(safePaths)]})
  return writeServiceImageCleanupJobs(providerId,jobs,storage)
}
