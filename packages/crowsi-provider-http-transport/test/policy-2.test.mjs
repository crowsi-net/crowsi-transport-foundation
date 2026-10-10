import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpTransport, ProviderTransportError } from '../dist/index.mjs'

const origin = 'https://provider.example'
const code = (expected) => (error) => error instanceof ProviderTransportError && error.code === expected
test('counts UTF8, views, buffers, URLSearchParams and blobs by bytes', async () => {
  let calls = 0
  const transport = createProviderHttpTransport({
    allowedOrigins: [origin],
    maximumRequestBytes: 4,
    fetchImplementation: async () => {
      calls++
      return new Response('1234')
    },
  })
  for (const body of [
    '1234',
    new ArrayBuffer(4),
    new Uint8Array(4),
    new DataView(new ArrayBuffer(8), 2, 4),
    new URLSearchParams('a=12'),
    new Blob(['1234']),
  ]) {
    assert.equal((await transport.request({ url: origin, method: 'POST', body })).status, 200)
  }
  for (const body of ['ああ', new ArrayBuffer(5), new Uint8Array(5), new Blob(['12345'])])
    await assert.rejects(transport.request({ url: origin, method: 'POST', body }), code('transport/request/limit'))
  assert.equal(calls, 6)
})

test('accepts the exact response byte limit and rejects lying/invalid declared lengths', async () => {
  for (const declared of [null, '4']) {
    const transport = createProviderHttpTransport({
      allowedOrigins: [origin],
      maximumResponseBytes: 4,
      fetchImplementation: async () =>
        new Response('1234', { headers: declared === null ? {} : { 'content-length': declared } }),
    })
    assert.equal((await transport.request({ url: origin })).body.byteLength, 4)
  }
  for (const declared of ['-1', 'abc', '5']) {
    const transport = createProviderHttpTransport({
      allowedOrigins: [origin],
      maximumResponseBytes: 4,
      fetchImplementation: async () => new Response('1234', { headers: { 'content-length': declared } }),
    })
    await assert.rejects(transport.request({ url: origin }), code('transport/response/limit'))
  }
  const lying = createProviderHttpTransport({
    allowedOrigins: [origin],
    maximumResponseBytes: 4,
    fetchImplementation: async () => new Response('12345', { headers: { 'content-length': '1' } }),
  })
  await assert.rejects(lying.request({ url: origin }), code('transport/response/limit'))
})
