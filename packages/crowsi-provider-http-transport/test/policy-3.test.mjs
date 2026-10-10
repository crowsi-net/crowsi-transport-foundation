import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpTransport, ProviderTransportError } from '../dist/index.mjs'

const origin = 'https://provider.example'
test('forwards only caller supplied headers without returning request credentials', async () => {
  const headers = new Headers({ authorization: 'Bearer synthetic-fixture', 'x-fixture': 'sample' })
  const transport = createProviderHttpTransport({
    allowedOrigins: [origin],
    fetchImplementation: async (_, init) => {
      assert.equal(new Headers(init.headers).get('authorization'), headers.get('authorization'))
      assert.equal(init.redirect, 'manual')
      return new Response('ok', { headers: { 'x-result': 'sample' } })
    },
  })
  const result = await transport.request({ url: origin, headers })
  assert.equal(headers.get('x-fixture'), 'sample')
  assert.equal(result.headers.get('authorization'), null)
  assert.equal(result.headers.get('x-result'), 'sample')
  assert.deepEqual(Object.keys(result).sort(), ['body', 'headers', 'status', 'statusText'])
})

test('rejects redirects and invalid response destinations while cancelling the body', async () => {
  for (const metadata of [
    { status: 302 },
    { type: 'opaqueredirect' },
    { redirected: true },
    { url: 'https://other.example' },
    { url: `${origin}/#fragment` },
    { url: 'http://provider.example' },
  ]) {
    let cancelled = 0
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled++
        },
      }),
    )
    for (const [key, value] of Object.entries(metadata)) Object.defineProperty(response, key, { value })
    const transport = createProviderHttpTransport({
      allowedOrigins: [origin],
      fetchImplementation: async () => response,
    })
    await assert.rejects(transport.request({ url: origin }), ProviderTransportError)
    assert.equal(cancelled, 1)
  }
})
