import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpTransport, ProviderTransportError } from '../dist/index.mjs'

const origin = 'https://provider.example'
const create = (options) => createProviderHttpTransport({ allowedOrigins: [origin], timeoutMs: 10, ...options })
async function bounded(promise) {
  let watchdog
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('deadline did not settle')), 500)
      }),
    ])
  } finally {
    clearTimeout(watchdog)
  }
}
const code = (expected) => (error) => error instanceof ProviderTransportError && error.code === expected

test('logical timeout also bounds a trusted fetch hook that ignores abort', async () => {
  let resolveFetch,
    cancelled = 0
  const transport = create({
    fetchImplementation: () =>
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
  })
  await assert.rejects(bounded(transport.request({ url: origin })), code('transport/request/timeout'))
  resolveFetch(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++
        },
      }),
    ),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(cancelled, 1)
})

test('content-length rejection does not wait for a custom cancel promise', async () => {
  const stream = new ReadableStream({
    cancel() {
      return new Promise(() => {})
    },
  })
  const transport = create({
    maximumResponseBytes: 4,
    fetchImplementation: async () => new Response(stream, { headers: { 'content-length': '5' } }),
  })
  await assert.rejects(bounded(transport.request({ url: origin })), code('transport/response/limit'))
})

test('network and stream failures use the public error and retain cause', async () => {
  const failure = new TypeError('synthetic network failure')
  for (const fetchImplementation of [
    async () => {
      throw failure
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(failure)
          },
        }),
      ),
  ]) {
    const transport = create({ fetchImplementation })
    await assert.rejects(
      transport.request({ url: origin }),
      (error) => code('transport/request/unavailable')(error) && error.cause === failure,
    )
  }
})
