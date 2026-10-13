import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpTransport } from '../dist/index.mjs'

test('an asynchronous driver sees the measured body even if the caller mutates its input', async () => {
  for (const original of [new URLSearchParams('value=before'), new Uint8Array([1, 2, 3])]) {
    let release, observed
    const wait = new Promise((resolve) => {
      release = resolve
    })
    const transport = createProviderHttpTransport({
      allowedOrigins: ['https://api.example.test'],
      fetchImplementation: async (_url, init) => {
        await wait
        observed = init.body instanceof URLSearchParams ? init.body.toString() : [...init.body]
        return new Response('{}')
      },
    })
    const request = transport.request({ url: 'https://api.example.test/resource', method: 'POST', body: original })
    if (original instanceof URLSearchParams) original.set('value', 'after')
    else original.fill(9)
    release()
    await request
    assert.deepEqual(observed, original instanceof URLSearchParams ? 'value=before' : [1, 2, 3])
  }
})
