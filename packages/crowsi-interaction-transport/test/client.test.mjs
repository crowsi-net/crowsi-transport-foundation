import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHttpTransport } from '../src/client.mjs'
import { setImmediate as nextTurn } from 'node:timers/promises'

test('HTTP preserves structured failures and cancels timed-out and oversized bodies', async () => {
  const result = {status:'Conflict',reason:'resource/revision/changed',issues:[]}
  const transport = createHttpTransport({endpoint:'/api/interaction',fetch:async () => Response.json(result, {status:409})})
  assert.deepEqual(await transport.request({method:'invoke'}), result)
  const failure = createHttpTransport({endpoint:'/api/interaction',fetch:async () => Response.json({transport_error:{code:'transport/origin/rejected'}}, {status:403})})
  await assert.rejects(failure.request({method:'read'}), {code:'transport/origin/rejected'})
  const large = createHttpTransport({endpoint:'/api/interaction',maximumBytes:8,fetch:async () => Response.json({large:'xxxxxxxxxxxx'})})
  await assert.rejects(large.request({}), {code:'transport/response/limit'})
  let cancelled = false
  const hanging = createHttpTransport({endpoint:'/api/interaction',timeoutMs:20,fetch:async () => new Response(new ReadableStream({cancel(){cancelled=true}}))})
  await assert.rejects(hanging.request({}), {code:'transport/timeout'})
  assert.equal(cancelled, true)
})

test('change polling never overlaps, aborts on stop and does not replay failed invokes', async () => {
  let calls = 0, active = 0, maximum = 0, visible = true
  const transport = createHttpTransport({endpoint:'/api/interaction',fetch:async (_, {signal}) => {
    calls++; maximum = Math.max(maximum, ++active)
    await new Promise(resolve => { const t=setTimeout(resolve,10); signal.addEventListener('abort',()=>{clearTimeout(t);resolve()},{once:true}) })
    active--; return Response.json({cursor:String(calls)})
  }})
  const watch = transport.watch(() => ({method:'subscribe'}), () => {}, () => {}, {intervalMs:5,active:()=>visible})
  try {
    await new Promise(resolve => setTimeout(resolve,45))
    visible = false
    await new Promise(resolve => setTimeout(resolve,25))
    const hidden = calls
    await new Promise(resolve => setTimeout(resolve,25))
    assert.equal(calls, hidden, 'missed lifecycle notifications must not continue requests')
  } finally { await watch.stop() }
  const stopped = calls
  await new Promise(resolve => setTimeout(resolve,20))
  assert.equal(calls, stopped); assert.equal(active, 0); assert.equal(maximum, 1)
})

test('in-flight success and error are suppressed after disposal, inactivity or authority invalidation', async () => {
  for (const reason of ['dispose', 'inactive', 'grant-revoked', 'scope-revoked', 'live']) {
    for (const fails of [false, true]) {
      let release, calls = 0, messages = 0, errors = 0
      const validity = {visible:true, grant:true, scope:true}
      const pending = new Promise((resolve, reject) => { release = () => fails ? reject(new Error('offline')) : resolve(Response.json({cursor:'current'})) })
      const transport = createHttpTransport({endpoint:'/api/interaction', fetch:() => { calls++; return pending }})
      const watch = transport.watch(() => ({method:'subscribe'}), () => { messages++ }, () => { errors++ }, {
        intervalMs:60000, active:() => validity.visible && validity.grant && validity.scope,
      })
      assert.equal(calls, 1)
      let stopping
      try {
        if (reason === 'dispose') stopping = watch.stop()
        if (reason === 'inactive') validity.visible = false
        if (reason === 'grant-revoked') validity.grant = false
        if (reason === 'scope-revoked') validity.scope = false
        release()
        // Settle the in-flight fetch and body microtasks before stopping. Calling
        // stop first for every case would conceal a missing active-after-await check.
        await nextTurn(); await nextTurn()
        assert.equal(messages, reason === 'live' && !fails ? 1 : 0, `${reason}: message`)
        assert.equal(errors, reason === 'live' && fails ? 1 : 0, `${reason}: error`)
        assert.equal(calls, 1, `${reason}: no extra request`)
      } finally { await (stopping ?? watch.stop()) }
    }
  }
})
