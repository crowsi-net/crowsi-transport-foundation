import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJsonEndpoint } from '../src/http.mjs'
test('HTTP boundary preserves outcomes, bounds input and rejects cross-site access', async () => {
  let calls = 0
  const serve = createJsonEndpoint(async value => {calls++;return value}, {origins:['http://localhost:4321'], maximumBytes:128})
  const request = (body, origin='http://localhost:4321') => new Request('http://localhost:4321/api', {method:'POST',headers:{origin,'content-type':'application/json'},body})
  const result = {status:'Conflict',reason:'changed',issues:[]}
  const response = await serve(request(JSON.stringify(result)))
  assert.deepEqual(await response.json(), result)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal((await serve(request('{}','https://evil.example'))).status,403)
  assert.equal((await serve(request('x'.repeat(129)))).status,413)
  assert.equal(calls,1)
})
