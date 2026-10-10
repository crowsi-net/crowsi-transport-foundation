/** Web-standard adapter. Identity resolution is supplied by the host, not payloads. */
export function createJsonEndpoint(handler, {origins, maximumBytes = 1048576, timeoutMs = 5000} = {}) {
  if (typeof handler !== 'function' || !Array.isArray(origins) || !origins.length
    || origins.some(o => new URL(o).origin !== o)
    || !Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1048576
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('transport/options/invalid')
  const headers = {'content-type':'application/json','cache-control':'private, no-store','vary':'Cookie, Authorization','x-content-type-options':'nosniff'}
  const reject = (status, code) => Response.json({transport_error:{code}}, {status,headers})
  return async request => {
    if (request.method !== 'POST') return reject(405,'transport/method/rejected')
    const origin = request.headers.get('origin')
    if (origin && !origins.includes(origin) || request.headers.get('sec-fetch-site') === 'cross-site') return reject(403,'transport/origin/rejected')
    if (!request.headers.get('content-type')?.split(';')[0].trim().match(/^application\/json$/iu)) return reject(415,'transport/content/type/rejected')
    if (!request.body) return reject(400,'transport/request/empty')
    const controller = new AbortController()
    const reader = request.body.getReader()
    const abort = () => { controller.abort(); void reader.cancel().catch(() => {}) }
    request.signal.addEventListener('abort', abort, {once:true})
    let timer
    const deadline = new Promise((_, rejectDeadline) => { timer = setTimeout(() => {abort();rejectDeadline(new Error('transport/timeout'))}, timeoutMs) })
    try {
      return await Promise.race([deadline, (async () => {
        let size = 0; const parts = []
        while (true) {
          const chunk = await reader.read()
          if (controller.signal.aborted) throw new Error('transport/aborted')
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > maximumBytes) return reject(413,'transport/request/limit')
          parts.push(chunk.value)
        }
        const bytes = new Uint8Array(size); let offset = 0
        for (const part of parts) {bytes.set(part,offset);offset+=part.byteLength}
        let payload
        try {payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
        catch {return reject(400,'transport/request/invalid')}
        const value = await handler(payload,{signal:controller.signal,request})
        const body = JSON.stringify(value)
        if (typeof body !== 'string' || new TextEncoder().encode(body).length > maximumBytes) return reject(502,'transport/response/limit')
        return new Response(body,{headers})
      })()])
    } catch (error) { return reject(503, error?.message === 'transport/timeout' ? 'transport/timeout' : 'transport/unavailable') }
    finally {clearTimeout(timer);request.signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock()}
  }
}
