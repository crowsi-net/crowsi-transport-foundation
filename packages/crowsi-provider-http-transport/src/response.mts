import { ProviderTransportError } from './policy.mjs'
import { abortable, cancelBody } from './abort.mjs'

/** Drain bytes within the bound while preserving abort and releasing the reader lock. */
export async function readBounded(response: Response, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    cancelBody(response)
    throw new ProviderTransportError('transport/response/limit')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      if (signal.aborted) throw new ProviderTransportError('transport/request/aborted')
      const part = await abortable(reader.read(), signal)
      if (signal.aborted) throw new ProviderTransportError('transport/request/aborted')
      if (part.done) break
      size += part.value.byteLength
      if (size > maximumBytes) throw new ProviderTransportError('transport/response/limit')
      parts.push(part.value)
    }
  } finally {
    try {
      void reader.cancel().catch(() => {})
    } catch {
      /* Reader cancellation is best effort. */
    }
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}
