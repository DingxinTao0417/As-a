export const DELIVERY_FILE_EXTENSIONS:Record<string,string>={
  "application/pdf":"pdf",
  "application/zip":"zip",
  "application/x-zip-compressed":"zip",
  "text/plain":"txt",
  "image/jpeg":"jpg",
  "image/png":"png",
  "image/webp":"webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":"docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":"pptx",
}

export const MAX_DELIVERY_FILE_SIZE=25*1024*1024
export const MAX_DELIVERY_FILES=5

export function deliveryFileAllowed(file:Pick<File,"type"|"size">){
  return Boolean(DELIVERY_FILE_EXTENSIONS[file.type])&&file.size>=1&&file.size<=MAX_DELIVERY_FILE_SIZE
}

export function deliveryFilePath(orderId:string,userId:string,requestId:string,index:number,mime:string){
  const extension=DELIVERY_FILE_EXTENSIONS[mime]
  if(!extension||!Number.isInteger(index)||index<0||index>=MAX_DELIVERY_FILES)return null
  return `${orderId}/${userId}/${requestId}-${index}.${extension}`
}
