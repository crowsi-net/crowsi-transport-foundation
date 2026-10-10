import { createProviderHttpTransport, ProviderTransportError } from '../src/index.mjs'
import type { ProviderHttpRequest, ProviderHttpResponse, ProviderHttpTransportOptions } from '../src/index.mjs'

const options: ProviderHttpTransportOptions = { allowedOrigins: ['https://provider.example'], timeoutMs: 1000 }
const request: ProviderHttpRequest = {
  url: new URL('https://provider.example'),
  method: 'POST',
  headers: new Headers(),
  body: 'sample',
  signal: new AbortController().signal,
}
const result: Promise<ProviderHttpResponse> = createProviderHttpTransport(options).request(request)
void result
const error: Error = new ProviderTransportError('transport/request/unavailable', new Error('synthetic'))
void error
// @ts-expect-error TRACE is outside the public method contract.
const invalid: ProviderHttpRequest = { url: 'https://provider.example', method: 'TRACE' }
void invalid

// @ts-expect-error origins are required by the public contract.
createProviderHttpTransport({})
// @ts-expect-error response bodies are bytes, not strings.
const wrongBody: ProviderHttpResponse = { status: 200, statusText: '', headers: new Headers(), body: 'text' }
void wrongBody
