import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Transform } from 'node:stream'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { RealtimeEndpoint, PeerDeliveryAck } from '../node/realtime.mjs'
import { DeliveryReceipt, TransportError } from '../node/transport.mjs'

const bytes = s => Buffer.from(s)
const error = outcome => e => e instanceof TransportError && e.outcome === outcome
const digest = b => createHash('sha256').update(b).digest('hex')
function pair(options = {}) {
  const messages=[],failures=[],commits=[],aborts=[]
  const a=new RealtimeEndpoint({onMessage:m=>messages.push(m),onFailure:e=>failures.push(e),...options.a})
  const b=new RealtimeEndpoint({onMessage:m=>messages.push(m),onFailure:e=>failures.push(e),
    onBulk:()=>{const chunks=[];return {write:b=>chunks.push(Buffer.from(b)),commit:()=>commits.push(Buffer.concat(chunks)),abort:e=>aborts.push(e)}},...options.b})
  let ab,ba
  const connect = (reverse = new PassThrough()) => {
    ab=options.forward??new PassThrough();ba=reverse
    a.connect(ba,ab,b.capabilities());b.connect(ab,ba,a.capabilities())
  }
  const close=()=>{a.disconnect();b.disconnect()}
  connect(options.reverse)
  return {a,b,messages,failures,commits,aborts,connect,close}
}
const heldAcks = () => {
  const frames=[]
  const wire=new Transform({transform(chunk,encoding,done){
    const v=JSON.parse(chunk.toString());if(v.kind==='ACK')frames.push(chunk);else this.push(chunk);done()
  }})
  return {wire,frames,flush:(index=0)=>wire.push(frames.splice(index,1)[0])}
}

test('STATE owner snapshot / NoChange / delta / explicit snapshot fallback; opaque cursor only advances on peer ACK',async()=>{
  const held=heldAcks(),p=pair({reverse:held.wire});const {a,b}=p
  try {
    a.subscribe('opaque/key');b.subscribe('opaque/key')
    const seen=[];let revision='z-revision',payload=bytes('one'),kind='Snapshot'
    const owner=({key,revision:base})=>{seen.push({key,base});return kind==='NoChange'?{kind,revision}:
      {kind,revision,baseRevision:kind==='Delta'?base:undefined,payload}}
    const first=await a.recover('opaque/key',owner)
    assert.ok(await first.local instanceof DeliveryReceipt)
    assert.equal((await first.local).sequence.toString(),first.sequence)
    assert.equal(a.cursor('opaque/key').lastConfirmed,null)
    held.flush();assert.ok(await first.peer instanceof PeerDeliveryAck)
    assert.equal(a.cursor('opaque/key').lastConfirmed.revision,'z-revision')
    assert.equal(p.messages[0].payload.toString(),'one')
    kind='NoChange';assert.deepEqual(await a.recover('opaque/key',owner),{status:'NoChange',revision})
    assert.equal(held.frames.length,0)
    kind='Delta';revision='a-next';payload=bytes('patch')
    const next=await a.recover('opaque/key',owner);held.flush();await next.peer
    assert.equal(a.cursor('opaque/key').lastConfirmed.revision,'a-next')
    assert.equal(p.messages[1].metadata.baseRevision,'z-revision')
    kind='Snapshot';revision='unknown-old-base-recovered';payload=bytes('complete')
    const snapshot=await a.recover('opaque/key',owner);held.flush();await snapshot.peer
    assert.equal(p.messages[2].metadata.mode,'Snapshot');assert.equal(seen[2].base,'z-revision')
    await assert.rejects(a.recover('opaque/key',()=>({kind:'RecoveryUnavailable'})),error('RecoveryUnavailable'))
    await assert.rejects(a.recover('opaque/key',()=>({kind:'Delta',revision:'other',baseRevision:'forged',payload})),error('RevisionMismatch'))
    await assert.rejects(a.recover('opaque/key',()=>({kind:'NoChange',revision:'forged'})),error('RevisionMismatch'))
    assert.equal(p.messages.length,3)
    const large=await a.recover('opaque/key',()=>({kind:'Snapshot',revision:'full-bound',payload:Buffer.alloc(524288,97)}))
    await large.local;held.flush();await large.peer;assert.equal(p.messages.at(-1).payload.length,524288)
    await assert.rejects(a.recover('opaque/key',()=>({kind:'Snapshot',revision:'too-large',payload:Buffer.alloc(524289)})),error('InputTooLarge'))
    let cancel
    const pending=a.recover('opaque/key',({signal})=>new Promise(resolve=>{cancel=signal;signal.addEventListener('abort',()=>resolve({kind:'RecoveryUnavailable'}))}))
    await new Promise(resolve=>setImmediate(resolve));a.unsubscribe('opaque/key');a.subscribe('opaque/key')
    await assert.rejects(pending,error('RecoveryUnavailable'));assert.equal(cancel.aborted,true)
    assert.equal(a.cursor('opaque/key').lastConfirmed,null);assert.equal(a.usage.recoveries,0)
  } finally {p.close()}
})

test('lost / forged / reordered ACK, reconnect and new process session never rebind application references',async()=>{
  const held=heldAcks(),p=pair({reverse:held.wire});const {a,b}=p
  const refs=Object.freeze({provider:'incarnation-original',grant:'grant-exact',invocation:'accepted-original'})
  try {
    a.subscribe('key');b.subscribe('key')
    const one=a.send('STATE',{key:'key',revision:'R1',mode:'Snapshot'},bytes('one'))
    await one.local
    const ack=JSON.parse(held.frames[0])
    for(const mutation of [v=>v.session='foreign',v=>v.targetSession='foreign',v=>v.targetSequence='999',v=>v.metadata.key='foreign',v=>v.metadata.revision='forged']) {
      const bad=structuredClone(ack);mutation(bad)
      assert.throws(()=>a.receive(bad),e=>['UnknownSession','AckOutOfRange'].includes(e.outcome))
      assert.equal(a.cursor('key').lastConfirmed,null)
    }
    const two=a.send('STATE',{key:'key',revision:'R2',mode:'Snapshot'},bytes('two'));await two.local
    held.flush(1);await two.peer;held.flush();await one.peer
    assert.equal(a.cursor('key').lastConfirmed.revision,'R2')
    const lost=a.send('STATE',{key:'key',revision:'R3',mode:'Snapshot'},bytes('three'));await lost.local
    const oldConnection=a.transport.connection.id,session=a.sessionId
    p.close();await assert.rejects(lost.peer,error('ConnectionClosed'))
    assert.equal(a.cursor('key').lastConfirmed.revision,'R2');p.connect()
    assert.equal(a.sessionId,session);assert.notEqual(a.transport.connection.id,oldConnection)
    let requested
    const recovery=await a.recover('key',r=>{requested=r.revision;return {kind:'Snapshot',revision:'R3',payload:bytes('three')}})
    await recovery.peer;assert.equal(requested,'R2');assert.deepEqual(refs,{provider:'incarnation-original',grant:'grant-exact',invocation:'accepted-original'})
    assert.equal(a.cursor('key').lastConfirmed.revision,'R3')
  } finally {p.close()}
  const fresh=pair();try {
    fresh.a.subscribe('key');fresh.b.subscribe('key');assert.notEqual(fresh.a.sessionId,a.sessionId)
    const state=await fresh.a.recover('key',r=>{assert.equal(r.revision,null);return {kind:'Snapshot',revision:'R3',payload:bytes('three')}})
    await state.peer;assert.equal(fresh.messages[0].payload.toString(),'three')
  }finally{fresh.close()}
  const restart=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',
    `import {RealtimeEndpoint} from ${JSON.stringify(new URL('../node/realtime.mjs',import.meta.url).href)};
    import {PassThrough} from 'node:stream';let base,received;
    const p=new RealtimeEndpoint({onMessage:()=>{}}),q=new RealtimeEndpoint({onMessage:m=>{received=m.payload.toString()}});
    p.subscribe('key');q.subscribe('key');const before=p.cursor('key'),ab=new PassThrough(),ba=new PassThrough();
    p.connect(ba,ab,q.capabilities());q.connect(ab,ba,p.capabilities());
    const ticket=await p.recover('key',r=>{base=r.revision;return {kind:'Snapshot',revision:'owner-after-restart',payload:Buffer.from('owner-snapshot')}});
    await ticket.peer;console.log(JSON.stringify({session:p.sessionId,before,base,received,cursor:p.cursor('key'),usage:p.usage}));p.disconnect();q.disconnect();`],{encoding:'utf8'}))
  assert.notEqual(restart.session,a.sessionId);assert.equal(restart.before.lastConfirmed,null);assert.equal(restart.base,null)
  assert.equal(restart.received,'owner-snapshot');assert.equal(restart.cursor.lastConfirmed.revision,'owner-after-restart');assert.equal(restart.usage.pendingBytes,0)
})

test('COMMAND peer ACK is not application admission; uncertainty, timeout, explicit retry and EVENT ordering stay separate',async()=>{
  const p=pair({a:{ackTimeoutMs:30}}),{a,b}=p
  let effects=0;const admitted=new Set()
  const execute=m=>{if(!admitted.has(m.metadata.operation)){admitted.add(m.metadata.operation);effects++}}
  try {
    const command=a.send('COMMAND',{operation:'explicit-operation'},bytes('protected'))
    await command.peer;assert.equal(effects,0)
    execute(p.messages[0]);p.close()
    await assert.rejects(command.completion,error('DeliveryUncertain'));assert.equal(effects,1)
    p.connect();assert.equal(p.messages.length,1)
    const retry=a.send('COMMAND',{operation:'explicit-operation'},bytes('protected'))
    await retry.peer;execute(p.messages[1]);assert.notEqual(retry.sequence,command.sequence)
    a.completeCommand(retry.sequence);await retry.completion;assert.equal(effects,1)
    const timed=a.send('COMMAND',{operation:'not-admitted'},bytes('input'));await timed.peer
    await assert.rejects(timed.completion,error('DeliveryUncertain'));assert.equal(effects,1)
    for(const body of ['event-one','event-two']) await a.send('EVENT',{},bytes(body)).peer
    const events=p.messages.filter(m=>m.class==='EVENT');assert.deepEqual(events.map(m=>m.payload.toString()),['event-one','event-two'])
    assert.ok(BigInt(events[1].sequence)>BigInt(events[0].sequence))
    assert.equal(a.usage.correlations,0);assert.equal(b.usage.subscriptions,0)
    const count=p.messages.length;p.close();p.connect()
    assert.equal(p.messages.length,count,'EVENT is not implicitly replayed or converted into STATE')
    assert.equal(b.usage.subscriptions,0)
  } finally {p.close()}
})

test('BULK streams bounded chunks, duplicate / missing / corrupt / incomplete transfers cannot become complete',async()=>{
  const forward=new Transform({transform(chunk,encoding,done){this.push(chunk.subarray(0,3));this.push(chunk.subarray(3));done()}})
  const data=bytes('bulk-payload'),p=pair({forward})
  try {
    const bulk=p.a.beginBulk({totalBytes:data.length,digest:digest(data)})
    await bulk.write(data.subarray(0,4)).peer
    await bulk.write(data.subarray(4),{last:true}).peer
    assert.deepEqual(p.commits,[data]);assert.equal(p.a.usage.bulkTransfers,0);assert.equal(p.b.usage.bulkTransfers,0)
    const interrupted=p.a.beginBulk({totalBytes:100,digest:digest(bytes('unused'))})
    await interrupted.write(bytes('part')).peer;p.close();assert.equal(p.aborts.length,1)
    assert.equal(p.b.usage.bulkTransfers,0)
    assert.throws(()=>interrupted.write(bytes('next')),error('BulkIncomplete'))
  }finally{p.close()}
  for(const violation of ['digest','missing','duplicate','oversize']) {
    const p=pair();try {
      const bulk=p.a.beginBulk({totalBytes:8,digest:digest(bytes('12345678'))})
      const first=bulk.write(bytes('1234'));await first.peer
      const m=p.messages.find(m=>m.class==='BULK')
      assert.ok(m)
      if(violation==='oversize') assert.throws(()=>bulk.write(Buffer.alloc(65537)),error('InputTooLarge'))
      else {
        const duplicate={...m,sequence:String(BigInt(m.sequence)+1n),payload:bytes('1234')}
        if(violation==='missing')duplicate.metadata={...m.metadata,index:2}
        if(violation==='digest')duplicate.metadata={...m.metadata,index:1,last:true};duplicate.payload=bytes(violation==='digest'?'bad!':'1234')
        if(violation==='duplicate'){const count=p.messages.length;p.b.receive(duplicate);assert.equal(p.messages.length,count)}
        else assert.throws(()=>p.b.receive(duplicate),error(violation==='missing'?'BulkIncomplete':'BulkIntegrityFailure'))
      }
      assert.equal(p.commits.length,0)
    }finally{p.close()}
  }
  const expired=pair({a:{ackTimeoutMs:20},b:{ackTimeoutMs:20}})
  try{
    const bulk=expired.a.beginBulk({totalBytes:8,digest:digest(bytes('12345678'))})
    await bulk.write(bytes('1234')).peer
    await assert.rejects(bulk.completion,error('BulkIncomplete'))
    await new Promise(resolve=>setTimeout(resolve,25))
    assert.equal(expired.a.usage.bulkTransfers,0);assert.equal(expired.b.usage.bulkTransfers,0)
    assert.equal(expired.aborts.length,1);assert.equal(expired.commits.length,0)
  }finally{expired.close()}
})

test('mixed classes have bounded pressure, explicit ephemeral loss, subscriptions and transfers; drain frees exactly once',async()=>{
  const held=heldAcks(),p=pair({reverse:held.wire,a:{limits:{subscriptions:1,transfers:1,correlations:3}}})
  try {
    p.a.subscribe('key');p.b.subscribe('key')
    assert.throws(()=>p.a.subscribe('extra'),error('Backpressure'))
    const state=p.a.send('STATE',{key:'key',mode:'Snapshot',revision:'current'},bytes('state'))
    const command=p.a.send('COMMAND',{operation:'explicit'},bytes('command'))
    const bulk=p.a.beginBulk({totalBytes:2,digest:digest(bytes('ab'))})
    const chunk=bulk.write(bytes('a'))
    await state.local;await command.local;await chunk.local
    assert.throws(()=>p.a.beginBulk({totalBytes:2,digest:digest(bytes('ab'))}),error('Backpressure'))
    assert.throws(()=>bulk.write(bytes('b'),{last:true}),error('Backpressure'))
    for(let i=0;i<1000;i++)assert.equal(p.a.send('EPHEMERAL',{},bytes('pulse')).status,'dropped')
    assert.throws(()=>p.a.send('EVENT',{},bytes('reliable')),error('Backpressure'))
    assert.equal(p.a.usage.correlations,3);assert.ok(p.a.usage.pendingBytes<=4194312)
    held.flush();await state.peer;held.flush();await command.peer;p.a.completeCommand(command.sequence)
    held.flush();await chunk.peer
    assert.equal(p.a.usage.correlations,0);assert.equal(p.a.usage.pendingBytes,0)
    const pulse=p.a.send('EPHEMERAL',{},bytes('pulse'));assert.equal(pulse.status,'queued');await pulse.local
    const last=bulk.write(bytes('b'),{last:true});await last.local;held.flush();await last.peer
    assert.equal(p.a.usage.bulkTransfers,0);assert.equal(p.a.usage.pendingBytes,0)
  }finally{p.close()}
})

test('capabilities and envelope fields are closed, byte-bounded and do not negotiate authorization',async()=>{
  const p=pair({b:{classes:['EVENT']}})
  try {
    assert.throws(()=>p.a.send('STATE',{key:'key',revision:'R1',mode:'Snapshot'},bytes('x')),error('UnsupportedClass'))
    assert.throws(()=>p.a.send('OTHER',{},bytes('x')),error('UnsupportedClass'))
    assert.throws(()=>p.a.send('EVENT',{ExecutionGrant:'invented'},bytes('x')),error('InvalidEnvelope'))
    assert.throws(()=>p.a.send('EVENT',{},Buffer.alloc(524289)),error('InputTooLarge'))
    assert.throws(()=>p.a.receive({version:1,kind:'MESSAGE',session:p.b.sessionId,sequence:'0',class:'EVENT',metadata:{},payload:bytes('x')}),error('InvalidEnvelope'))
    assert.equal(p.messages.length,0)
    const next=p.a.transport.session.next
    p.a.transport.session.next=()=>{throw new TransportError('SequenceExhausted')}
    const exhausted=p.a.send('EVENT',{},bytes('no-effect'))
    await assert.rejects(exhausted.local,error('SequenceExhausted'));await assert.rejects(exhausted.peer,error('SequenceExhausted'))
    assert.equal(p.a.usage.pendingBytes,0);assert.equal(p.messages.length,0)
    p.a.transport.session.next=next
    const caps={...p.b.capabilities(),version:2};p.close()
    assert.throws(()=>p.a.connect(new PassThrough(),new PassThrough(),caps),error('ProtocolViolation'))
    assert.throws(()=>p.a.beginBulk({totalBytes:1,digest:digest(bytes('x'))}),e=>['ConnectionClosed','ConnectionFailed'].includes(e.outcome))
  }finally{p.close()}
  for(const stage of ['message','open','write','commit','abort']){
    const reject=()=>Promise.reject(new Error('invalid async '+stage))
    const p=pair({b:stage==='message'?{onMessage:reject}:{onBulk:stage==='open'?reject:()=>({
      write:stage==='write'?reject:()=>{},commit:stage==='commit'?reject:()=>{},abort:stage==='abort'?reject:()=>{}
    })}})
    try{
      if(stage==='message')await assert.rejects(p.a.send('EVENT',{},bytes('x')).peer)
      else{
        const transfer=p.a.beginBulk({totalBytes:2,digest:digest(bytes('ab'))})
        const chunk=transfer.write(bytes(stage==='abort'?'a':'ab'),{last:stage!=='abort'})
        if(stage==='abort'){await chunk.peer;p.close()}
        else await assert.rejects(chunk.peer)
        await assert.rejects(transfer.completion,error('BulkIncomplete'))
      }
      await new Promise(resolve=>setImmediate(resolve))
      assert.equal(p.b.usage.bulkTransfers,0)
    }finally{p.close()}
  }
})
