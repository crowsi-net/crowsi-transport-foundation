import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { createProviderHttpTransport } from '../dist/index.mjs'

test('native fetch exercises bounded streams, redirects, disconnects and cancellation on loopback', async () => {
  const origin = 'https://provider.example'
  let observedHeaders = false
  const server = createServer((request, response) => {
    observedHeaders ||= request.headers.authorization === 'Bearer synthetic-fixture'
    if (request.url === '/redirect') {
      response.writeHead(302, { location: 'https://other.example' })
      response.end()
      return
    }
    if (request.url === '/disconnect') {
      request.socket.destroy()
      return
    }
    response.writeHead(200)
    response.flushHeaders()
    if (request.url === '/stall') return
    if (request.url === '/excess') {
      response.end('12345')
      return
    }
    response.write('12')
    setTimeout(() => response.end('34'), 5)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  // Test-only adapter preserves the admitted HTTPS identity while directing all I/O to loopback.
  // It does not test real TLS or browser cookie/CORS behavior and creates no TLS keys.
  const fetchImplementation = async (url, init) => {
    assert.equal(new URL(url).origin, origin)
    assert.equal(init.redirect, 'manual')
    const response = await fetch(`http://127.0.0.1:${port}${new URL(url).pathname}`, init)
    const wrapped = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
    Object.defineProperty(wrapped, 'url', { value: url })
    return wrapped
  }
  try {
    const transport = createProviderHttpTransport({
      allowedOrigins: [origin],
      maximumResponseBytes: 4,
      timeoutMs: 1000,
      fetchImplementation,
    })
    const result = await transport.request({
      url: `${origin}/chunked`,
      headers: { authorization: 'Bearer synthetic-fixture' },
    })
    assert.equal(new TextDecoder().decode(result.body), '1234')
    assert.ok(observedHeaders)
    for (const [path, code] of [
      ['/excess', 'transport/response/limit'],
      ['/redirect', 'transport/response/redirect/rejected'],
      ['/disconnect', 'transport/request/unavailable'],
    ]) {
      await assert.rejects(transport.request({ url: origin + path }), (error) => error.code === code)
    }
    const timed = createProviderHttpTransport({ allowedOrigins: [origin], timeoutMs: 30, fetchImplementation })
    await assert.rejects(
      timed.request({ url: `${origin}/stall` }),
      (error) => error.code === 'transport/request/timeout',
    )
    const caller = new AbortController()
    const pending = transport.request({ url: `${origin}/stall`, signal: caller.signal })
    setTimeout(() => caller.abort('fixture cancellation'), 20)
    await assert.rejects(pending, (error) => error.code === 'transport/request/aborted')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
