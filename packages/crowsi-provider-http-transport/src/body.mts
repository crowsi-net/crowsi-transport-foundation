import type { ProviderRequestBody } from './contracts.mjs'
import { bodySize, ProviderTransportError } from './policy.mjs'

/** Snapshot mutable measurable bodies before yielding to a trusted asynchronous driver. */
export function boundedBody(body: ProviderRequestBody | null, limit: number): ProviderRequestBody | null {
  if (bodySize(body) > limit) throw new ProviderTransportError('transport/request/limit')
  if (body instanceof URLSearchParams) return new URLSearchParams(body)
  if (body instanceof ArrayBuffer) return body.slice(0)
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice()
  return body
}
