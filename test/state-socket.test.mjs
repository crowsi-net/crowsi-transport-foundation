import assert from 'node:assert/strict'
import {test} from 'node:test'
import {StateSocketServer,StateSocketClient} from '../node/state-socket.mjs'
import {TransportError} from '../node/transport.mjs'
const settle=async predicate=>{const until=Date.now()+2000;while(!predicate()&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.ok(predicate())}
function setup(){
  let state={key:'one',revision:'p1'},dropAck=false,lastPeer,lastClientSocket
  const frames=[],adoptions=[],statuses=[]
  const server=new StateSocketServer({authorize:()=> 'test-owner',read:async({key,revision})=>{
    if(!state)return {kind:'RecoveryUnavailable'}
    return revision===state.revision?{kind:'NoChange',revision}:{kind:'Snapshot',revision:state.revision,payload:Buffer.from(JSON.stringify({...state,key}))}
  }})
  const socket=()=>{
    const ws={readyState:0,bufferedAmount:0,send:text=>{
      const v=JSON.parse(text);frames.push({from:'client',v})
      if(dropAck&&v.kind==='ACK')return
      queueMicrotask(()=>{if(ws.readyState===1)server.message(peer,text)})
    },close:()=>{if(ws.readyState===3)return;ws.readyState=3;server.disconnect(peer);queueMicrotask(()=>ws.onclose?.({}))}}
    const peer={id:crypto.randomUUID(),close:()=>ws.close(),websocket:{readyState:1,bufferedAmount:0,
      send:text=>{frames.push({from:'server',v:JSON.parse(text)});queueMicrotask(()=>ws.onmessage?.({data:text}))},close:()=>ws.close()}}
    server.open(peer);lastPeer=peer;lastClientSocket=ws
    queueMicrotask(()=>{ws.readyState=1;ws.onopen?.()});return ws
  }
  const client=new StateSocketClient({url:'ws://test',createSocket:socket,onState:v=>adoptions.push(v),onStatus:s=>statuses.push(s)})
  return {server,client,frames,adoptions,statuses,setState:v=>{state=v;server.notify()},dropAck:v=>{dropAck=v},disconnect:()=>lastClientSocket.close(),
    inject:v=>lastClientSocket.onmessage({data:JSON.stringify(v)}),peer:()=>lastPeer,socket:()=>lastClientSocket}
}

test('STATE socket uses shared delivery: SSR NoChange, updates, lost ACK, rebind, cancellation and bounded disposal',async()=>{
  const f=setup(),{client,server}=f
  try{
    client.subscribe({key:'one',locator:'opaque-owner-input',revision:'p1'});client.start()
    await settle(()=>f.adoptions.length===1)
    assert.deepEqual(f.adoptions[0],{kind:'NoChange',key:'one',revision:'p1'})
    assert.equal(f.frames.filter(f=>f.from==='server'&&f.v.kind==='MESSAGE').length,0)
    const session=client.endpoint.sessionId,connection=client.endpoint.transport.connection.id
    f.dropAck(true);f.setState({key:'one',revision:'p2'});await settle(()=>f.adoptions.at(-1)?.revision==='p2')
    assert.equal([...server.sessions.values()][0].endpoint.cursor('one').lastConfirmed,null)
    f.disconnect();f.dropAck(false);client.retry()
    await settle(()=>f.adoptions.filter(a=>a.revision==='p2').length===2)
    assert.equal(client.endpoint.sessionId,session);assert.notEqual(client.endpoint.transport.connection.id,connection)
    await settle(()=>server.inspect().pendingBytes===0)
    assert.equal([...server.sessions.values()][0].endpoint.cursor('one').lastConfirmed.revision,'p2')
    client.unsubscribe('one');client.subscribe({key:'two',locator:'different-input',revision:null})
    await settle(()=>f.adoptions.at(-1)?.key==='two')
    f.setState(null);await settle(()=>client.state==='Unavailable')
    f.setState({key:'two',revision:'p3'});await settle(()=>f.adoptions.at(-1)?.revision==='p3')
    assert.equal(f.adoptions.at(-1).key,'two')
    for(let i=0;i<7;i++)client.subscribe({key:'k'+i,locator:'input',revision:null})
    assert.throws(()=>client.subscribe({key:'overflow',locator:'input',revision:null}),e=>e.outcome==='Backpressure')
  }finally{client.close();server.close()}
  assert.deepEqual(server.inspect(),{connections:0,sessions:0,subscriptions:0,pendingBytes:0})
  assert.equal(client.inspect().subscriptions,0)
})
test('socket failures reject foreign identity/reordered frames, cancel generations and report bounded writer pressure',async()=>{
  const f=setup()
  try{
    f.client.subscribe({key:'one',locator:'input',revision:null});f.client.start()
    await settle(()=>f.adoptions.length===1)
    const frame=f.frames.find(x=>x.from==='server'&&x.v.kind==='MESSAGE').v
    f.inject({...frame,session:'foreign'})
    assert.equal(f.client.state,'Failed');assert.equal(f.statuses.at(-1).code,'UnknownSession');assert.equal(f.adoptions.length,1)
    f.client.retry();await settle(()=>f.client.state==='Live')
    f.inject({...frame,sequence:'999',metadata:{...frame.metadata,key:'foreign'}})
    assert.equal(f.statuses.at(-1).code,'UnknownSubscription')
    f.client.retry();await settle(()=>f.client.state==='Live')
    f.inject(frame);assert.equal(f.client.state,'Failed');assert.equal(f.statuses.at(-1).code,'InvalidEnvelope')
    f.client.retry();await settle(()=>f.client.state==='Live')
    f.socket().bufferedAmount=4194312
    f.setState({key:'one',revision:'ack-pressure'})
    await settle(()=>f.client.state==='Failed')
    assert.equal(f.statuses.at(-1).code,'Backpressure')
    f.client.retry();await settle(()=>f.client.state==='Live')
    f.peer().websocket.bufferedAmount=4194312
    f.setState({key:'one',revision:'pressure'})
    await settle(()=>f.frames.some(x=>x.v.kind==='FAILURE')||f.client.state!=='Live')
  }finally{f.client.close();f.server.close()}
  await new Promise(r=>setTimeout(r,300));assert.equal(f.server.inspect().connections,0)
})

test('recovery cancellation fences late owner replies and physical connection capacity is bounded',async()=>{
  const f=setup();let resolveOld,aborted=false
  try{
    f.server.read=({signal})=>new Promise(resolve=>{resolveOld=resolve;signal.addEventListener('abort',()=>{aborted=true},{once:true})})
    f.client.subscribe({key:'one',locator:'old',revision:null});f.client.start()
    await settle(()=>Boolean(resolveOld))
    f.client.unsubscribe('one')
    f.server.read=()=>({kind:'Snapshot',revision:'new',payload:Buffer.from('{}')})
    f.client.subscribe({key:'two',locator:'new',revision:null})
    await settle(()=>f.adoptions.some(v=>v.key==='two'))
    assert.equal(aborted,true)
    resolveOld({kind:'Snapshot',revision:'old',payload:Buffer.from('{}')})
    await new Promise(r=>setTimeout(r,20))
    assert.equal(f.adoptions.some(v=>v.key==='one'),false)
    for(let i=0;i<7;i++)f.server.open({websocket:{readyState:1,bufferedAmount:0,send(){},close(){}},close(){}})
    assert.equal(f.server.inspect().connections,8)
    const rejected=[]
    f.server.open({websocket:{readyState:1,bufferedAmount:0,send:v=>rejected.push(JSON.parse(v))},close(){}})
    assert.deepEqual(rejected,[{kind:'FAILURE',code:'Backpressure'}])
    assert.equal(f.server.inspect().connections,8)
    const accepted=f.adoptions.length
    f.server.authorize=()=>{throw Error('expired owner access')}
    f.setState({key:'two',revision:'after-expiry'})
    await settle(()=>f.client.state==='Failed')
    assert.equal(f.statuses.at(-1).code,'UnknownSession');assert.equal(f.adoptions.length,accepted)
  }finally{f.client.close();f.server.close()}
  assert.equal(f.client.inspect().pending.recoveries,0)
  assert.equal(f.server.inspect().connections,0)
})

test('real backoff exhausts five attempts and disposal cancels unresolved prepare without creating a socket',async()=>{
  let sockets=0,ready
  const client=new StateSocketClient({url:'ws://unavailable',onState(){},createSocket(){sockets++;throw new TransportError('ConnectionFailed')}})
  try{
    client.start();const until=Date.now()+12000
    while(client.state!=='Failed'&&Date.now()<until)await new Promise(r=>setTimeout(r,25))
    assert.equal(client.state,'Failed');assert.equal(client.attempts,5);assert.equal(sockets,6)
    await new Promise(r=>setTimeout(r,300));assert.equal(sockets,6)
  }finally{client.close()}
  const cancelled=new StateSocketClient({url:'ws://cancelled',onState(){},prepare:()=>new Promise(r=>{ready=r}),createSocket(){sockets++;throw Error('unexpected socket')}})
  cancelled.start();cancelled.close();ready();await Promise.resolve();await Promise.resolve()
  assert.equal(sockets,6);assert.equal(cancelled.inspect().subscriptions,0)
})
