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

test('stalled body times out even when cancel cleanup never settles', async () => {
  let cancelled = 0
  const stream = new ReadableStream({
    cancel() {
      cancelled++
      return new Promise(() => {})
    },
  })
  const transport = create({ fetchImplementation: async () => new Response(stream) })
  await assert.rejects(bounded(transport.request({ url: origin })), code('transport/request/timeout'))
  assert.equal(cancelled, 1)
  assert.equal(stream.locked, false)
})

test('a stalled body is cancelled by the caller, preserving its distinct classification', async () => {
  let cancelled = 0
  const stream = new ReadableStream({
    cancel() {
      cancelled++
    },
  })
  const caller = new AbortController()
  const transport = create({ timeoutMs: 500, fetchImplementation: async () => new Response(stream) })
  const pending = transport.request({ url: origin, signal: caller.signal })
  await new Promise((resolve) => setTimeout(resolve, 0))
  caller.abort('transport/timeout')
  await assert.rejects(bounded(pending), code('transport/request/aborted'))
  assert.equal(cancelled, 1)
})

test('pre-aborted requests do not call fetch', async () => {
  let calls = 0
  const caller = new AbortController()
  caller.abort('already stopped')
  const transport = create({
    fetchImplementation: async () => {
      calls++
      return new Response('ok')
    },
  })
  await assert.rejects(transport.request({ url: origin, signal: caller.signal }), code('transport/request/aborted'))
  assert.equal(calls, 0)
})

test('caller timeout-like reason is not our timer expiry', async () => {
  const caller = new AbortController()
  const transport = create({
    timeoutMs: 500,
    fetchImplementation: (_, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  })
  const pending = transport.request({ url: origin, signal: caller.signal })
  caller.abort('transport/timeout')
  await assert.rejects(bounded(pending), code('transport/request/aborted'))
})
