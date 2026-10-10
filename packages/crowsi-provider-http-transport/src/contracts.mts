/** Caller-owned destination, method, headers and body. Runtime rejects unmeasurable bodies. */
export interface ProviderHttpRequest {
  url: string | URL
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  headers?: HeadersInit
  body?: BodyInit | null
  signal?: AbortSignal
}

/** Bounded response bytes; callers interpret HTTP status codes. */
export interface ProviderHttpResponse {
  status: number
  statusText: string
  headers: Headers
  body: Uint8Array
}

/** Exact HTTPS origins and finite byte/time limits; injected fetch remains trusted. */
export interface ProviderHttpTransportOptions {
  allowedOrigins: string[]
  maximumRequestBytes?: number
  maximumResponseBytes?: number
  timeoutMs?: number
  fetchImplementation?: typeof fetch
}

/** Transport does not generate, persist or log authentication headers. */
export interface ProviderHttpTransport {
  request(request: ProviderHttpRequest): Promise<ProviderHttpResponse>
}
