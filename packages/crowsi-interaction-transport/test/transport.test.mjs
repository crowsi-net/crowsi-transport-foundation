import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStdioTransport } from '../src/stdio.mjs'

const echo = `process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',s=>{b+=s;let p;while((p=b.indexOf('\\n'))>=0){const l=b.slice(0,p);b=b.slice(p+1);process.stdout.write(l+'\\n')}})`
test('bounded single process preserves payloads and disposes queued work', async () => {
  const transport = createStdioTransport({ command:process.execPath, args:['-e',echo], maximumQueue:2 })
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
  const transport = createStdioTransport({command:process.execPath,args:['-e','process.stdin.resume()'],timeoutMs:40})
  const pending = transport.request({operation:'change'})
  await assert.rejects(pending, {code:'transport/timeout'})
  await transport.close()
  assert.equal(transport.status().processes, 0)
  const other = createStdioTransport({command:process.execPath,args:['-e','process.stdin.resume()']})
  const controller = new AbortController()
  const aborted = other.request({}, {signal:controller.signal})
  controller.abort()
  await assert.rejects(aborted, {code:'transport/aborted'})
  await other.close()
})

test('oversized and unsolicited responses fail closed and reap the child', async () => {
  const transport = createStdioTransport({command:process.execPath,args:['-e',"process.stdout.write('x'.repeat(2048))"],maximumBytes:1024})
  await assert.rejects(transport.request({}), {code:'transport/response/limit'})
  await transport.close()
  assert.equal(transport.status().processes, 0)
})

test('a later request reconnects only after the failed process is reaped, never replaying it', async () => {
  const handler = `process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{const v=JSON.parse(s);if(v.interrupt)process.exit(7);else process.stdout.write(JSON.stringify(v)+'\\n')})`
  const transport = createStdioTransport({command:process.execPath,args:['-e',handler]})
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
