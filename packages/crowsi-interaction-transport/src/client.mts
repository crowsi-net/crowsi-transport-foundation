import { TransportError } from './errors.mjs'
import type { HttpOptions, HttpTransport, RequestOptions, WatchOptions } from './types/transport.mjs'

export function createHttpTransport({endpoint, fetch:fetcher = globalThis.fetch,
  timeoutMs = 5000, maximumBytes = 1048576}: HttpOptions): HttpTransport {
  if (typeof endpoint !== 'string' || !/^\/(?!\/)|^https?:\/\//u.test(endpoint)
    || typeof fetcher !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1048576) throw new TransportError('transport/options/invalid')
  async function request(payload: unknown, {signal}: RequestOptions = {}): Promise<unknown> {
    const controller = new AbortController()
    let expired = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const abort = () => { controller.abort(); void reader?.cancel().catch(() => {}) }
    if (signal?.aborted) throw new TransportError('transport/aborted')
    signal?.addEventListener('abort', abort, {once:true})
    const timer = setTimeout(() => { expired = true; abort() }, timeoutMs)
    try {
      const body = JSON.stringify(payload)
      if (typeof body !== 'string' || new TextEncoder().encode(body).length > maximumBytes) throw new TransportError('transport/request/limit')
      const response = await fetcher(endpoint, {method:'POST',body,signal:controller.signal,
        headers:{'content-type':'application/json','accept':'application/json'},credentials:'same-origin',cache:'no-store',redirect:'error'})
      if (!response.body) throw new TransportError('transport/response/empty')
      reader = response.body.getReader()
      const chunks = []; let bytes = 0
      while (true) {
        const chunk = await reader.read()
        if (controller.signal.aborted) throw new TransportError(expired ? 'transport/timeout' : 'transport/aborted')
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > maximumBytes) throw new TransportError('transport/response/limit')
        chunks.push(chunk.value)
      }
      const all = new Uint8Array(bytes); let offset = 0
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength }
      let result: unknown
      try { result = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(all)) }
      catch { throw new TransportError('transport/response/invalid') }
      if (result !== null && typeof result === 'object' && Object.hasOwn(result, 'transport_error')) {
        const envelope = (result as Record<string, unknown>).transport_error
        const code = envelope !== null && typeof envelope === 'object'
          ? (envelope as Record<string, unknown>).code : undefined
        if (Object.keys(result).length !== 1 || !envelope
          || Object.keys(envelope as object).length !== 1 || typeof code !== 'string'
          || code.length > 128 || !/^transport\/[a-z]+(?:\/[a-z]+)*$/u.test(code)) {
          throw new TransportError('transport/response/invalid')
        }
        throw new TransportError(code)
      }
      return result
    } catch (e) {
      if (expired) throw new TransportError('transport/timeout')
      if (signal?.aborted) throw new TransportError('transport/aborted')
      if (e instanceof TransportError) throw e
      throw new TransportError('transport/unavailable')
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      await reader?.cancel().catch(() => {})
      reader?.releaseLock()
    }
  }
  function watch(payload: () => unknown, onMessage: Parameters<HttpTransport['watch']>[1],
    onError: Parameters<HttpTransport['watch']>[2], {intervalMs = 500, active = () => true}: WatchOptions = {}) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 60000 || typeof active !== 'function') throw new TransportError('transport/options/invalid')
    const controller = new AbortController()
    let wake: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, failures = 0
    const done = (async () => {
      while (!controller.signal.aborted && active()) {
        try {
          const value = await request(payload(), {signal:controller.signal})
          // Authority/visibility may change while fetch or body reading awaits.
          // Revalidate at delivery, not only at request creation.
          if (controller.signal.aborted || !active()) break
          await onMessage(value); failures = 0
        } catch (error) {
          if (controller.signal.aborted || !active()) break
          failures = Math.min(failures + 1, 6); await onError(error instanceof TransportError ? error : new TransportError('transport/unavailable'))
        }
        if (controller.signal.aborted || !active()) break
        await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, Math.min(30000, intervalMs * 2 ** failures)) })
      }
    })()
    return { stop:async () => { controller.abort(); clearTimeout(timer); wake?.(); await done } }
  }
  return {request, watch}
}
