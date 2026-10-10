import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpTransport, ProviderTransportError } from '../dist/index.mjs'

const origin = 'https://provider.example'

test('admits only the exact configured HTTPS origin and bounded methods', async () => {
  const calls = []
  const transport = createProviderHttpTransport({
    allowedOrigins: [origin],
    fetchImplementation: async (url, init) => {
      calls.push({ url, init })
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  const result = await transport.request({ url: `${origin}/v1/items`, method: 'POST', body: '{}' })
  assert.equal(result.status, 200)
  assert.equal(new TextDecoder().decode(result.body), '{"ok":true}')
  assert.equal(calls[0].init.redirect, 'manual')
  await assert.rejects(
    transport.request({ url: 'https://other.example/v1/items' }),
    (error) => error instanceof ProviderTransportError && error.code === 'transport/request/destination/rejected',
  )
  await assert.rejects(
    transport.request({ url: `${origin}/v1/items`, method: 'TRACE' }),
    (error) => error.code === 'transport/request/method/rejected',
  )
  assert.equal(calls.length, 1)
})

test('rejects request and response bytes outside the configured bounds', async () => {
  const transport = createProviderHttpTransport({
    allowedOrigins: [origin],
    maximumRequestBytes: 4,
    maximumResponseBytes: 4,
    fetchImplementation: async () => new Response('12345'),
  })
  await assert.rejects(
    transport.request({ url: `${origin}/`, method: 'POST', body: '12345' }),
    (error) => error.code === 'transport/request/limit',
  )
  await assert.rejects(transport.request({ url: `${origin}/` }), (error) => error.code === 'transport/response/limit')
})
