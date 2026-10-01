import { Budget, LogicalSession, LocalTransport, TransportError, defaultLimits } from './transport.mjs'
import { classes, bounds, fail, token, sequence, shape, metadata, same, deferred, synchronous } from './realtime-contract.mjs'
import {Bytes as Buffer} from '#bytes'
import { BulkIntake, BulkOutput, supportedClasses } from '#bulk'

export class PeerDeliveryAck {
  constructor(value){Object.assign(this,value,{meaning:'peer-runtime-delivery-only'});Object.freeze(this)}
}

/** In-memory delivery context only. State recovery and command admission remain caller-owned. */
export class RealtimeEndpoint {
  #session=new LogicalSession();#pending=new Map();#subscriptions=new Map();#bulk=new Set();#recoveries=new Set()
  #budget=new Budget();#lastReceived=0n;#peer=null;#limits;#classes;#intake;#onMessage;#onFailure
  constructor({onMessage,onFailure=()=>{},onBulk,limits={},classes:offered=supportedClasses,ackTimeoutMs=10000}={}){
    if(typeof onMessage!=='function'||typeof onFailure!=='function')fail('InvalidEnvelope')
    this.#limits=bounds(limits)
    if(!Array.isArray(offered)||!offered.length||offered.length>classes.length||new Set(offered).size!==offered.length||offered.some(c=>!supportedClasses.includes(c)))fail('UnsupportedClass')
    this.#classes=Object.freeze([...offered]);this.#onMessage=onMessage;this.#onFailure=onFailure
    if(!Number.isSafeInteger(ackTimeoutMs)||ackTimeoutMs<1||ackTimeoutMs>120000)fail('InvalidEnvelope')
    this.ackTimeoutMs=ackTimeoutMs;this.#intake=new BulkIntake(this.#limits,onBulk,ackTimeoutMs,onFailure)
  }
  get sessionId(){return this.#session.id}
  get usage(){return {subscriptions:this.#subscriptions.size,correlations:this.#pending.size,
    pendingBytes:this.#budget.usage.bytes,bulkTransfers:this.#bulk.size+this.#intake.size,recoveries:this.#recoveries.size}}
  capabilities(){return Object.freeze({version:1,session:this.sessionId,classes:this.#classes,limits:this.#limits})}
  connect(readable,writable,peer){
    shape(peer,['version','session','classes','limits']);token(peer.session)
    if(peer.version!==1)fail('ProtocolViolation')
    if(!Array.isArray(peer.classes)||peer.classes.length>classes.length||peer.classes.some(c=>!classes.includes(c))||new Set(peer.classes).size!==peer.classes.length)fail('UnsupportedClass')
    const remote=bounds(peer.limits)
    if(this.transport?.connection.state==='Open')fail('ProtocolViolation')
    if(this.#subscriptions.size>Math.min(remote.subscriptions,this.#limits.subscriptions))fail('Backpressure')
    if(this.#peer?.session!==peer.session){this.#lastReceived=0n;for(const s of this.#subscriptions.values()){s.lastConfirmed=null;s.received=null}}
    this.#peer=Object.freeze({session:peer.session,classes:Object.freeze(this.#classes.filter(c=>peer.classes.includes(c))),
      limits:Object.freeze(Object.fromEntries(Object.keys(remote).map(k=>[k,Math.min(remote[k],this.#limits[k])])) )})
    this.#intake.limits=this.#peer.limits
    this.transport=new LocalTransport(readable,writable,{session:this.#session,
      onFrame:frame=>{
        let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame.payload))}catch{fail('InvalidEnvelope')}
        if(value?.kind==='MESSAGE'){
          const maximum=value.class==='BULK'?this.#peer.limits.chunkBytes:this.#peer.limits.payloadBytes
          if(typeof value.payload!=='string')fail('InvalidEnvelope')
          if(value.payload.length>Math.ceil(maximum/3)*4)fail('InputTooLarge')
          if(value.payload.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.payload))fail('InvalidEnvelope')
          const decoded=Buffer.from(value.payload,'base64')
          if(decoded.toString('base64')!==value.payload)fail('InvalidEnvelope')
          value.payload=decoded
        }
        this.receive(value)
      },onFailure:error=>{this.#releaseAll(error);this.#onFailure(error)}})
  }
  disconnect(){this.transport?.close();this.#releaseAll(new TransportError('ConnectionClosed'))}
  subscribe(key,{revision=null}={}){
    token(key);if(this.#subscriptions.has(key))return this.cursor(key)
    if(revision!==null)token(revision)
    if(this.#subscriptions.size>=(this.#peer?.limits.subscriptions??this.#limits.subscriptions))fail('Backpressure')
    this.#subscriptions.set(key,{lastSent:null,lastConfirmed:null,received:null,recovering:false,initialRevision:revision});return this.cursor(key)
  }
  cursor(key){const s=this.#subscription(key);return structuredClone({lastSent:s.lastSent,lastConfirmed:s.lastConfirmed,received:s.received})}
  unsubscribe(key){
    this.#subscription(key).controller?.abort()
    for(const r of this.#pending.values())if(r.class==='STATE'&&r.metadata.key===key)this.#finish(r,new TransportError('UnknownSubscription'))
    this.#subscriptions.delete(key)
  }
  #subscription(key){const s=this.#subscriptions.get(key);if(!s)fail('UnknownSubscription');return s}
  async recover(key,owner){
    this.transport?.connection.assertOpen();if(!this.transport)fail('ConnectionClosed')
    const s=this.#subscription(key);if(s.recovering)fail('Backpressure')
    // Receiver's explicit bootstrap revision is not a peer-confirmed cursor.
    // Once delivery starts, only a real ACK advances lastConfirmed. Lost ACK
    // therefore re-reads from the original bootstrap revision, never lastSent.
    const connection=this.transport.connection.id,revision=s.lastConfirmed?.revision??s.initialRevision
    const controller=new AbortController();s.controller=controller;s.recovering=true;this.#recoveries.add(controller)
    let timer
    try {
      const cancelled=new Promise((_,reject)=>{
        controller.signal.addEventListener('abort',()=>reject(new TransportError('RecoveryUnavailable')),{once:true})
        timer=setTimeout(()=>controller.abort(),this.ackTimeoutMs)
      })
      const result=await Promise.race([Promise.resolve().then(()=>owner({key,revision,maxPayloadBytes:this.#peer.limits.payloadBytes,signal:controller.signal})),cancelled])
      if(this.transport.connection.id!==connection||this.transport.connection.state!=='Open'||this.#subscriptions.get(key)!==s)fail('RecoveryUnavailable')
      if(result?.kind==='RecoveryUnavailable')fail('RecoveryUnavailable')
      if(result?.kind==='RevisionMismatch')fail('RevisionMismatch')
      if(result?.kind==='NoChange'){
        shape(result,['kind','revision']);if(revision===null||result.revision!==revision)fail('RevisionMismatch')
        return {status:'NoChange',revision}
      }
      shape(result,['kind','revision','payload'],['baseRevision'])
      if(result.kind==='Delta'&&(revision===null||result.baseRevision!==revision))fail('RevisionMismatch')
      const m={key,revision:result.revision,mode:result.kind}
      if(result.kind==='Delta')m.baseRevision=result.baseRevision
      return this.send('STATE',m,result.payload)
    }catch(error){if(error instanceof TransportError)throw error;fail('RecoveryUnavailable')}
    finally{clearTimeout(timer);controller.abort();this.#recoveries.delete(controller);s.recovering=false;delete s.controller}
  }
  send(kind,meta,payload){if(kind==='BULK')fail('InvalidEnvelope');return this.#send(kind,meta,payload)}
  #send(kind,meta,payload){
    if(!this.#peer||!this.transport)fail('ConnectionClosed');this.transport.connection.assertOpen()
    if(!this.#peer.classes.includes(kind))fail('UnsupportedClass')
    const m=metadata(kind,meta,this.#peer.limits)
    if(!Buffer.isBuffer(payload)||payload.length>this.#peer.limits.payloadBytes)fail('InputTooLarge')
    if(kind==='STATE')this.#subscription(m.key)
    if(this.#pending.size>=this.#peer.limits.correlations){if(kind==='EPHEMERAL')return {status:'dropped',reason:'Backpressure'};fail('Backpressure')}
    const writing=this.transport.budget.usage
    if(writing.messages>=defaultLimits.pendingMessages||writing.bytes>defaultLimits.pendingBytes-defaultLimits.frame){
      if(kind==='EPHEMERAL')return {status:'dropped',reason:'Backpressure'};fail('Backpressure')
    }
    let release
    try{release=this.#budget.reserve(defaultLimits.frame)}catch(error){if(kind==='EPHEMERAL'&&error.outcome==='Backpressure')return {status:'dropped',reason:'Backpressure'};throw error}
    const peer=deferred(),completion=deferred();let r
    const local=this.transport.sendSequenced(seq=>{
      r={sequence:String(seq),class:kind,metadata:m,peer,completion,release,peerAccepted:false}
      if(kind!=='EPHEMERAL'){
        this.#pending.set(r.sequence,r)
        r.timer=setTimeout(()=>this.#finish(r,new TransportError(kind==='COMMAND'?'DeliveryUncertain':'Timeout')),this.ackTimeoutMs)
      }
      const envelope={version:1,kind:'MESSAGE',session:this.sessionId,sequence:r.sequence,class:kind,metadata:m,payloadLength:payload.length,payload:payload.toString('base64')}
      if(kind==='STATE')this.#subscription(m.key).lastSent={sequence:r.sequence,revision:m.revision}
      return envelope
    })
    local.catch(error=>{if(r)this.#finish(r,new TransportError(kind==='COMMAND'?'DeliveryUncertain':error.outcome??'ConnectionFailed'));
      else {release();peer.reject(error);completion.reject(error)}})
    if(kind==='EPHEMERAL'){local.finally(release).catch(()=>{});return {status:'queued',local}}
    return Object.freeze({sequence:r?.sequence??null,local,peer:peer.promise,completion:completion.promise,
      cancel:()=>{if(r)this.#finish(r,new TransportError(kind==='COMMAND'?'DeliveryUncertain':'ConnectionClosed'))}})
  }
  completeCommand(seq){const r=this.#pending.get(seq);if(!r||r.class!=='COMMAND')fail('AckOutOfRange');this.#finish(r)}
  #finish(r,error){
    if(r.finished)return;r.finished=true;clearTimeout(r.timer);this.#pending.delete(r.sequence);r.release()
    if(error){r.peer.reject(error);r.completion.reject(error)}else{
      if(!r.peerAccepted)r.peer.reject(new TransportError('DeliveryUncertain'))
      r.completion.resolve({status:'released'})
    }
  }
  #releaseAll(error){
    for(const r of this.#pending.values())this.#finish(r,new TransportError(r.class==='COMMAND'?'DeliveryUncertain':r.class==='BULK'?'BulkIncomplete':error.outcome))
    for(const controller of this.#recoveries)controller.abort()
    for(const transfer of this.#bulk)transfer.abort();this.#intake.close()
  }
  beginBulk(descriptor){
    if(!this.transport)fail('ConnectionClosed');this.transport.connection.assertOpen()
    if(!this.#peer?.classes.includes('BULK'))fail('UnsupportedClass')
    if(this.#bulk.size>=this.#peer.limits.transfers)fail('Backpressure')
    const transfer=new BulkOutput(descriptor,this.#peer.limits,(...args)=>this.#send(...args),()=>this.#bulk.delete(transfer),this.ackTimeoutMs,this.#onFailure)
    this.#bulk.add(transfer);return transfer
  }
  receive(v){
    if(!v||v.version!==1)fail('InvalidEnvelope')
    if(v.session!==this.#peer?.session)fail('UnknownSession')
    const seq=sequence(v.sequence)
    if(v.kind==='ACK'){
      shape(v,['version','kind','session','sequence','targetSession','targetSequence','class','metadata'])
      if(v.targetSession!==this.sessionId)fail('UnknownSession')
      sequence(v.targetSequence)
      metadata(v.class,v.metadata,this.#peer.limits)
      const r=this.#pending.get(v.targetSequence)
      if(!r||r.class!==v.class||!same(r.metadata,v.metadata))fail('AckOutOfRange')
      if(r.class==='STATE'){
        const s=this.#subscription(r.metadata.key)
        if(!s.lastConfirmed||BigInt(r.sequence)>BigInt(s.lastConfirmed.sequence))s.lastConfirmed={sequence:r.sequence,revision:r.metadata.revision}
      }
      r.peerAccepted=true;r.peer.resolve(new PeerDeliveryAck({session:v.session,targetSession:v.targetSession,sequence:r.sequence,class:r.class,metadata:r.metadata}))
      if(r.class!=='COMMAND')this.#finish(r)
      return
    }
    shape(v,['version','kind','session','sequence','class','metadata','payloadLength','payload'])
    if(v.kind!=='MESSAGE')fail('InvalidEnvelope')
    if(!this.#peer.classes.includes(v.class))fail('UnsupportedClass')
    const m=metadata(v.class,v.metadata,this.#peer.limits)
    if(!Buffer.isBuffer(v.payload)||v.payloadLength!==v.payload.length)fail('InvalidEnvelope')
    if(v.payload.length>this.#peer.limits.payloadBytes)fail('InputTooLarge')
    if(seq<=this.#lastReceived)fail('InvalidEnvelope')
    const s=v.class==='STATE'?this.#subscription(m.key):null
    if(s&&m.mode==='Delta'&&s.received?.revision!==m.baseRevision)fail('RevisionMismatch')
    const message=Object.freeze({...v,metadata:m})
    const fresh=v.class==='BULK'?this.#intake.accept(m,v.payload):true
    if(fresh)synchronous(this.#onMessage(message),'RecoveryUnavailable')
    this.#lastReceived=seq
    if(s)s.received={sequence:v.sequence,revision:m.revision}
    if(v.class!=='EPHEMERAL')this.transport.sendSequenced(ackSequence=>({version:1,kind:'ACK',session:this.sessionId,sequence:String(ackSequence),
      targetSession:v.session,targetSequence:v.sequence,class:v.class,metadata:m})).catch(error=>this.transport.fail(error))
  }
}
