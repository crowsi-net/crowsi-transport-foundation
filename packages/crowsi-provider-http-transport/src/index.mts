import type {
  ProviderHttpRequest,
  ProviderHttpResponse,
  ProviderHttpTransport,
  ProviderHttpTransportOptions,
} from './contracts.mjs'
export type {
  ProviderHttpRequest,
  ProviderHttpResponse,
  ProviderHttpTransportOptions,
} from './contracts.mjs'
import { ProviderTransportError, checkedLimit, checkedOrigins, checkedUrl, bodySize } from './policy.mjs'
import { abortable, cancelBody } from './abort.mjs'
import { readBounded } from './response.mjs'
export { ProviderTransportError } from './policy.mjs'

const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])

/** Create a bounded transport; authentication, status interpretation and persistence belong to callers. */
export function createProviderHttpTransport(options: ProviderHttpTransportOptions): ProviderHttpTransport
export function createProviderHttpTransport({
  allowedOrigins,
  maximumRequestBytes,
  maximumResponseBytes,
  timeoutMs = 15000,
  fetchImplementation = globalThis.fetch,
}: Partial<ProviderHttpTransportOptions> = {}): ProviderHttpTransport {
  const origins = checkedOrigins(allowedOrigins)
  const requestLimit = checkedLimit(maximumRequestBytes, 64 * 1024)
  const responseLimit = checkedLimit(maximumResponseBytes, 1024 * 1024)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || typeof fetchImplementation !== 'function') {
    throw new ProviderTransportError('transport/options/invalid')
  }
  return Object.freeze({
    async request({
      url: input,
      method = 'GET',
      headers,
      body = null,
      signal,
    }: Partial<ProviderHttpRequest> = {}): Promise<ProviderHttpResponse> {
      const url = checkedUrl(input, origins)
      const normalizedMethod = String(method).toUpperCase()
      if (!METHODS.has(normalizedMethod)) throw new ProviderTransportError('transport/request/method/rejected')
      if ((normalizedMethod === 'GET' || normalizedMethod === 'DELETE') && body != null) {
        throw new ProviderTransportError('transport/request/body/rejected')
      }
      if (bodySize(body) > requestLimit) throw new ProviderTransportError('transport/request/limit')
      if (signal?.aborted) throw new ProviderTransportError('transport/request/aborted')
      const controller = new AbortController()
      const abort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort('transport/timeout')
      }, timeoutMs)
      let response: Response | undefined
      try {
        const pending = Promise.resolve(
          fetchImplementation(url.href, {
            method: normalizedMethod,
            headers,
            body,
            signal: controller.signal,
            redirect: 'manual',
          }),
        )
        // A trusted custom fetch may settle late; discard its unconsumed body after abort.
        void pending.then(
          (value) => {
            if (controller.signal.aborted) cancelBody(value)
          },
          () => {},
        )
        response = await abortable(pending, controller.signal)
        if (
          response.type === 'opaqueredirect' ||
          response.redirected ||
          (response.status >= 300 && response.status < 400)
        ) {
          throw new ProviderTransportError('transport/response/redirect/rejected')
        }
        const finalUrl = checkedUrl(response.url || url.href, origins)
        if (finalUrl.origin !== url.origin) throw new ProviderTransportError('transport/response/redirect/rejected')
        const responseBody = await readBounded(response, responseLimit, controller.signal)
        return Object.freeze({
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
          body: responseBody,
        })
      } catch (error) {
        cancelBody(response)
        if (controller.signal.aborted) {
          throw new ProviderTransportError(timedOut ? 'transport/request/timeout' : 'transport/request/aborted', error)
        }
        if (error instanceof ProviderTransportError) throw error
        throw new ProviderTransportError('transport/request/unavailable', error)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
    },
  })
}
