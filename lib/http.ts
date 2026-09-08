export class RequestBodyError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

// Enforce the limit while reading: Content-Length alone is not trustworthy.
export async function readJsonBody(request: Request, maxBytes = 32_768): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    throw new RequestBodyError(413, "Request body too large")
  }
  if (!request.body) throw new RequestBodyError(400, "JSON body required")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new RequestBodyError(413, "Request body too large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
  } catch {
    throw new RequestBodyError(400, "Invalid JSON")
  }
}
