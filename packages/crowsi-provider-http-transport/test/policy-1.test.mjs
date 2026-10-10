import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpTransport, ProviderTransportError } from '../dist/index.mjs'

const origin = 'https://provider.example'
const code = (expected) => (error) => error instanceof ProviderTransportError && error.code === expected
test('rejects noncanonical origin policies and invalid bounds', () => {
  for (const allowedOrigins of [
    [],
    undefined,
    ['http://provider.example'],
    [`${origin}/`],
    [`${origin}/path`],
    ['https://user:password@provider.example'],
    [`${origin}:443`],
    ['invalid'],
  ]) {
    assert.throws(() => createProviderHttpTransport({ allowedOrigins }), ProviderTransportError)
  }
  for (const field of ['maximumRequestBytes', 'maximumResponseBytes']) {
    for (const value of [0, -1, 1.5, Infinity, NaN, 16 * 1024 * 1024 + 1]) {
      assert.throws(
        () => createProviderHttpTransport({ allowedOrigins: [origin], [field]: value }),
        code('transport/options/limit/invalid'),
      )
    }
    for (const value of [1, 16 * 1024 * 1024])
      assert.ok(createProviderHttpTransport({ allowedOrigins: [origin], [field]: value }))
  }
  for (const timeoutMs of [0, -1, 1.5, 60001, Infinity])
    assert.throws(
      () => createProviderHttpTransport({ allowedOrigins: [origin], timeoutMs }),
      code('transport/options/invalid'),
    )
  for (const timeoutMs of [1, 60000]) assert.ok(createProviderHttpTransport({ allowedOrigins: [origin], timeoutMs }))
})

test('rejects unapproved schemes, origins, credentials, ports and fragments before fetch', async () => {
  let calls = 0
  const transport = createProviderHttpTransport({
    allowedOrigins: [origin],
    fetchImplementation: async () => {
      calls++
      return new Response()
    },
  })
  for (const url of [
    'http://provider.example',
    'https://sub.provider.example',
    'https://provider.example.other',
    'https://provider.example:444',
    'https://user:password@provider.example',
    `${origin}/#secret`,
    '/relative',
  ]) {
    await assert.rejects(transport.request({ url }), ProviderTransportError)
  }
  for (const method of ['HEAD', 'OPTIONS', 'TRACE', 'CONNECT'])
    await assert.rejects(transport.request({ url: origin, method }), code('transport/request/method/rejected'))
  for (const method of ['GET', 'DELETE'])
    await assert.rejects(transport.request({ url: origin, method, body: '' }), code('transport/request/body/rejected'))
  await assert.rejects(
    transport.request({ url: origin, method: 'POST', body: new FormData() }),
    code('transport/request/body/unbounded'),
  )
  assert.equal(calls, 0)
})
