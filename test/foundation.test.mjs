import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough, Writable } from 'node:stream'
import { Connection, LogicalSession, FrameDecoder, Budget, LocalTransport, DeliveryReceipt,
  limitsFor, encodeJson, TransportError, MessageCounter } from '../node/transport.mjs'

test('byte framing: boundaries, batched/split delimiters, unicode, huge malformed input', () => {
  for (const size of [0,1,15,16,17,8*1024*1024]) {
    const decoder = new FrameDecoder(limitsFor(16)); const frames = []
    const consume = f => frames.push(f.payload)
    if (size > 16) {
      assert.throws(() => decoder.feed(Buffer.alloc(size,120), consume), /InputTooLarge/)
      assert.equal(decoder.metrics.bytesConsumed,17)
      assert.throws(() => decoder.finish(consume), /ConnectionFailed/)
    } else { decoder.feed(Buffer.alloc(size,120), consume); decoder.feed(Buffer.from('\n'),consume); assert.equal(frames[0].length,size) }
    assert.ok(decoder.metrics.highWater <= 16); assert.equal(decoder.metrics.allocationCapacity,17)
  }
  const d = new FrameDecoder(limitsFor(6)), frames=[]
  d.feed(Buffer.from('日本\r\nx\nx\nx\nx\n'), f=>frames.push(f.payload.toString()))
  for (const b of Buffer.from('日本')) d.feed(Buffer.from([b]),f=>frames.push(f.payload.toString()))
  d.finish(f=>frames.push(f.payload.toString()))
  assert.deepEqual(frames,['日本','x','x','x','x','日本'])
  assert.throws(()=>new FrameDecoder(limitsFor(5)).feed(Buffer.from('日本'),()=>{}),/InputTooLarge/)
})
test('plain JSON preflight bounds actual encoding without treating characters as bytes', () => {
  for (const value of [{x:'日本'},['\n','\ud800',0,true,null],{empty:undefined,a:1}]) {
    const bytes=Buffer.byteLength(JSON.stringify(value)), limits=limitsFor(bytes)
    assert.equal(encodeJson(value,limits).toString(),JSON.stringify(value)+'\n')
    assert.throws(()=>encodeJson(value,limitsFor(bytes-1)),/InputTooLarge/)
  }
  assert.throws(()=>encodeJson({x:'x'.repeat(8192)},limitsFor(16)),/InputTooLarge/)
  const cycle={};cycle.self=cycle;assert.throws(()=>encodeJson(cycle),/ProtocolViolation/)
  assert.throws(()=>encodeJson({get secret(){throw Error('must not run')}}),/ProtocolViolation/)
})
test('logical session rebind, pending capacity, drain, identity and receipt separation', () => {
  const exhausted = new MessageCounter(18446744073709551614n)
  assert.equal(exhausted.next(),18446744073709551615n)
  assert.throws(()=>exhausted.next(),/SequenceExhausted/)
  assert.throws(()=>exhausted.next(),/SequenceExhausted/)
  const refs=Object.freeze({grant:'g1',invocation:'i1',provider:'p1',worker:'w1',revision:'r1',operation:'o1',commitReceipt:'c1'})
  const session=new LogicalSession(), id=session.id, first=new Connection();first.open();session.bind(first)
  assert.equal(session.next(),1n)
  const second=new Connection();second.open();assert.throws(()=>session.bind(second),/ProtocolViolation/)
  first.fail();assert.throws(()=>first.open(),/ProtocolViolation/);first.close();first.close();session.bind(second)
  assert.notEqual(first.id,second.id);assert.equal(session.id,id);assert.equal(session.next(),2n)
  assert.equal(refs.provider,'p1');assert.equal(refs.grant,'g1')
  const receipt=new DeliveryReceipt(second.id,2n,12);assert.equal(receipt.acknowledgement,'local-write-only');assert.notEqual(typeof refs.commitReceipt,typeof receipt)
  const b=new Budget(limitsFor(16,{pendingMessages:2,pendingBytes:36}))
  const a=b.reserve(18),c=b.reserve(18);assert.deepEqual(b.usage,{messages:2,bytes:36});assert.throws(()=>b.reserve(1),/Backpressure/)
  a();a();assert.deepEqual(b.usage,{messages:1,bytes:18});const d=b.reserve(1);c();d();assert.deepEqual(b.usage,{messages:0,bytes:0})
  const bytes=new Budget(limitsFor(16,{pendingMessages:64,pendingBytes:18}));const release=bytes.reserve(18);assert.throws(()=>bytes.reserve(1),/Backpressure/);release()
})
test('write pressure, timeout, reconnect and read EOF never retry an uncertain effect', async () => {
  const input=new PassThrough();let writes=0
  const output=new Writable({write(_b,_e,_done){writes++}})
  const session=new LogicalSession();let failure
  const transport=new LocalTransport(input,output,{session,limits:limitsFor(16,{pendingMessages:1}),timeoutMs:10,onFailure:e=>{failure=e}})
  const request=transport.sendJson({a:1});const timed=assert.rejects(request,/Timeout/)
  await assert.rejects(transport.sendJson({a:2}),/Backpressure/);await timed
  assert.equal(failure.outcome,'Timeout');assert.equal(writes,1);assert.deepEqual(transport.budget.usage,{messages:0,bytes:0})
  await assert.rejects(transport.sendJson({a:3}),/ConnectionFailed/)
  const nextInput=new PassThrough(), nextOutput=new PassThrough();let resumedWrites=0;nextOutput.on('data',()=>resumedWrites++)
  const next=new LocalTransport(nextInput,nextOutput,{session});assert.equal(resumedWrites,0)
  assert.notEqual(next.connection.id,transport.connection.id);assert.equal(next.session.id,transport.session.id)
  const receipt=await next.sendJson({a:4});assert.equal(receipt.sequence,2n);assert.equal(resumedWrites,1)
  next.close();next.close();await assert.rejects(next.sendJson({a:5}),/ConnectionClosed/)
})
test('malformed byte input / partial failure and peer EOF release resources once', async () => {
  const input=new PassThrough(),output=new PassThrough();output.resume();const frames=[], failures=[]
  const t=new LocalTransport(input,output,{onFrame:f=>frames.push(f.payload.toString()),onFailure:e=>failures.push(e.outcome)})
  input.end('last');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(frames,['last']);assert.deepEqual(failures,['ConnectionClosed'])
  assert.throws(()=>t.connection.assertOpen(),/ConnectionFailed/);t.close()
  const i=new PassThrough(),o=new PassThrough();o.resume();const fail=[]
  const r=new LocalTransport(i,o,{onFailure:e=>fail.push(e.outcome)});i.write('partial');i.emit('error',Error('peer failure'));r.close()
  assert.deepEqual(fail,['ConnectionFailed']);assert.ok(new TransportError('Timeout') instanceof Error)
})
