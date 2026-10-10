const MAXIMUM_BOUND = 16 * 1024 * 1024

/** Stable failure code; cause can contain sensitive driver details and must not be logged blindly. */
export class ProviderTransportError extends Error {
  declare readonly code: string
  constructor(code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause })
    this.name = 'ProviderTransportError'
    this.code = code
  }
}

/** Validate a finite integral byte bound before any network operation. */
export function checkedLimit(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback
  if (!Number.isInteger(selected) || selected < 1 || selected > MAXIMUM_BOUND) {
    throw new ProviderTransportError('transport/options/limit/invalid')
  }
  return selected
}

/** Admit only caller-declared canonical HTTPS origins. */
export function checkedOrigins(values: unknown): Set<string> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ProviderTransportError('transport/options/origins/empty')
  }
  return new Set(
    values.map((value: unknown) => {
      let url: URL
      try {
        url = new URL(value as string)
      } catch (error) {
        throw new ProviderTransportError('transport/options/origin/invalid', error)
      }
      if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
        throw new ProviderTransportError('transport/options/origin/invalid')
      }
      return url.origin
    }),
  )
}

/** Reject credentials, fragments and destinations outside the admitted origins. */
export function checkedUrl(value: unknown, origins: ReadonlySet<string>): URL {
  let url: URL
  try {
    url = new URL(value as string)
  } catch (error) {
    throw new ProviderTransportError('transport/request/url/invalid', error)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !origins.has(url.origin)) {
    throw new ProviderTransportError('transport/request/destination/rejected')
  }
  return url
}

/** Count supported body representations without consuming streams or FormData. */
export function bodySize(body: unknown): number {
  if (body == null) return 0
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).byteLength
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size
  throw new ProviderTransportError('transport/request/body/unbounded')
}
