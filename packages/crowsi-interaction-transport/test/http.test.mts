import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJsonEndpoint } from '../dist/http.mjs'
test('HTTP boundary preserves outcomes, bounds input and rejects cross-site access', async () => {
  let calls = 0
  const serve = createJsonEndpoint(async value => {calls++;return value}, {origins:['http://localhost:4321'], maximumBytes:128})
  const request = (body: string, origin='http://localhost:4321') => new Request('http://localhost:4321/api', {method:'POST',headers:{origin,'content-type':'application/json'},body})
  const result = {status:'Conflict',reason:'changed',issues:[]}
  const response = await serve(request(JSON.stringify(result)))
  assert.deepEqual(await response.json(), result)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal((await serve(request('{}','https://evil.example'))).status,403)
  assert.equal((await serve(request('x'.repeat(129)))).status,413)
  assert.equal(calls,1)
})

test('413 response returns even when request cancellation never settles', async () => {
  const serve = createJsonEndpoint(async value => value, {origins:['http://localhost'],maximumBytes:8})
  const body = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new Uint8Array(9))}, cancel() {return new Promise<void>(() => {})}})
  const request = new Request('http://localhost/api', {method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'} as RequestInit)
  const response = await Promise.race([serve(request),new Promise<never>((_,reject) => setTimeout(() => reject(new Error('cleanup hung')),250))])
  assert.equal(response.status,413)
})
