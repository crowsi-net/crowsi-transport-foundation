import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStdioTransport } from '../dist/stdio.mjs'

test('bounded single process preserves payloads and disposes queued work', async () => {
  const transport = createStdioTransport({ command:process.execPath, args:[fixture('echo')], maximumQueue:2 })
  try {
    const first = transport.request({scope:'a',params:{value:false}})
    const second = transport.request({scope:'b',params:{value:null}})
    await assert.rejects(transport.request({overflow:true}), { code:'transport/queue/full' })
    assert.deepEqual(await first, {scope:'a',params:{value:false}})
    assert.deepEqual(await second, {scope:'b',params:{value:null}})
    assert.equal(transport.status().pending, 0)
    assert.equal(transport.status().processes, 1)
  } finally { await transport.close() }
  assert.equal(transport.status().processes, 0)
  await assert.rejects(transport.request({}), {code:'transport/closed'})
})

test('timeout and abort terminate the channel without replaying uncertain mutations', async () => {
  const transport = createStdioTransport({command:process.execPath,args:[fixture('idle')],timeoutMs:40})
  const pending = transport.request({operation:'change'})
  await assert.rejects(pending, {code:'transport/timeout'})
  await transport.close()
  assert.equal(transport.status().processes, 0)
  const other = createStdioTransport({command:process.execPath,args:[fixture('idle')]})
  const controller = new AbortController()
  const aborted = other.request({}, {signal:controller.signal})
  controller.abort()
  await assert.rejects(aborted, {code:'transport/aborted'})
  await other.close()
})

test('oversized and unsolicited responses fail closed and reap the child', async () => {
  const transport = createStdioTransport({command:process.execPath,args:[fixture('large-response')],maximumBytes:1024})
  await assert.rejects(transport.request({}), {code:'transport/response/limit'})
  await transport.close()
  assert.equal(transport.status().processes, 0)
})

test('a later request reconnects only after the failed process is reaped, never replaying it', async () => {
  const transport = createStdioTransport({command:process.execPath,args:[fixture('interrupt')]})
  try {
    await assert.rejects(transport.request({interrupt:true,request:'uncertain-write'}), {code:'transport/process/exited'})
    const result = await transport.request({request:'read-after-interruption'})
    assert.deepEqual(result, {request:'read-after-interruption'})
    assert.equal(transport.status().processes, 1)
    assert.equal(transport.status().pending, 0)
  } finally { await transport.close() }
  assert.equal(transport.status().processes, 0)
  await assert.rejects(transport.request({request:'after-dispose'}), {code:'transport/closed'})
})

function fixture(name: string): string { return fileURLToPath(new URL('./fixtures/' + name + '.mts', import.meta.url)) }
