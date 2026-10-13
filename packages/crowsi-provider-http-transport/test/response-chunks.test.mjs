import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderHttpTransport } from '../dist/index.mjs'
const origin = 'https://api.example.test'
function transport(stream) {
  return createProviderHttpTransport({
    allowedOrigins: [origin],
    fetchImplementation: async () => new Response(stream),
  })
}
test('received chunks are captured before a stream producer reuses its buffer', async () => {
  const bytes = new Uint8Array([1, 2]),
    count = { value: 0 }
  const stream = new ReadableStream(
    {
      pull(controller) {
        if (count.value === 0) {
          controller.enqueue(bytes)
          count.value++
        } else if (count.value === 1) {
          bytes.set([3, 4])
          controller.enqueue(bytes)
          count.value++
        } else controller.close()
      },
    },
    { highWaterMark: 0 },
  )
  const result = await transport(stream).request({ url: origin })
  assert.deepEqual([...result.body], [1, 2, 3, 4])
})
test('invalid and infinitely fragmented streams are rejected within a chunk budget', async () => {
  for (const chunk of ['not bytes', new Uint8Array()]) {
    let reads = 0
    const stream = new ReadableStream({
      pull(controller) {
        reads++
        controller.enqueue(chunk)
      },
    })
    await assert.rejects(transport(stream).request({ url: origin }), /transport\/response\/chunk\/rejected/)
    assert.ok(reads <= 4098)
  }
})
