import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpTransport } from '../dist/index.mjs'

const origin = 'https://provider.example'

test('maps timeout and caller cancellation to distinct transport failures', async () => {
  const waitForAbort = (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  const timed = createProviderHttpTransport({
    allowedOrigins: [origin],
    timeoutMs: 5,
    fetchImplementation: waitForAbort,
  })
  await assert.rejects(timed.request({ url: `${origin}/` }), (error) => error.code === 'transport/request/timeout')

  const controller = new AbortController()
  const cancelled = createProviderHttpTransport({ allowedOrigins: [origin], fetchImplementation: waitForAbort })
  const pending = cancelled.request({ url: `${origin}/`, signal: controller.signal })
  controller.abort('caller')
  await assert.rejects(pending, (error) => error.code === 'transport/request/aborted')
})

test('keeps timeout and cancellation classification while reading a response body', async () => {
  const delayedResponse = () => {
    let timer
    return new Response(
      new ReadableStream({
        start(controller) {
          timer = setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('late'))
            controller.close()
          }, 15)
        },
        cancel() {
          clearTimeout(timer)
        },
      }),
    )
  }
  const timed = createProviderHttpTransport({
    allowedOrigins: [origin],
    timeoutMs: 5,
    fetchImplementation: delayedResponse,
  })
  await assert.rejects(timed.request({ url: `${origin}/` }), (error) => error.code === 'transport/request/timeout')

  const controller = new AbortController()
  const cancelled = createProviderHttpTransport({
    allowedOrigins: [origin],
    fetchImplementation: delayedResponse,
  })
  const pending = cancelled.request({ url: `${origin}/`, signal: controller.signal })
  controller.abort('caller')
  await assert.rejects(pending, (error) => error.code === 'transport/request/aborted')
})

test('never follows a provider redirect with credentials attached', async () => {
  const transport = createProviderHttpTransport({
    allowedOrigins: [origin],
    fetchImplementation: async (_url, init) => {
      assert.equal(init.redirect, 'manual')
      return new Response(null, { status: 302, headers: { location: 'https://other.example/final' } })
    },
  })
  await assert.rejects(
    transport.request({ url: `${origin}/start` }),
    (error) => error.code === 'transport/response/redirect/rejected',
  )
})
