// Optional STATE-only WebSocket binding over the SAME bounded delivery engine.
// Setup/control frames are not MESSAGE/ACK and never become application receipts.
import {RealtimeEndpoint} from './realtime.mjs'
import {TransportError,defaultLimits,encodeJson} from './transport.mjs'
import {shape,token,fail} from './realtime-contract.mjs'
import {Bytes} from '#bytes'
const decode=new TextDecoder('utf-8',{fatal:true})
export const socketLimits=Object.freeze({sessions:8,connections:8,subscriptions:8,setupMs:5000,sessionIdleMs:30000,
  controlBytes:4096,controlsPerSecond:64,retries:5,backoff:[250,500,1000,2000,4000]})
const generation=v=>{if(!Number.isSafeInteger(v)||v<1)fail('InvalidEnvelope')}
const issue=e=>e instanceof TransportError?e.outcome:'ProtocolViolation'
function wire(raw){
  if(typeof raw==='string'){if(Bytes.byteLength(raw)>defaultLimits.frame)fail('InputTooLarge')}
  else {if(!(raw instanceof Uint8Array)&&!(raw instanceof ArrayBuffer))fail('MalformedFrame');if(raw.byteLength>defaultLimits.frame)fail('InputTooLarge');raw=decode.decode(raw)}
  let value;try{value=JSON.parse(raw)}catch{fail('InvalidEnvelope')}
  if(!['MESSAGE','ACK'].includes(value?.kind)&&Bytes.byteLength(raw)>socketLimits.controlBytes)fail('InputTooLarge')
  return {value,raw}
}
function write(ws,value){
  const bytes=encodeJson(value)
  if(bytes.length>socketLimits.controlBytes)fail('InputTooLarge')
  send(ws,bytes)
}
function send(ws,bytes){
  if(ws.readyState!==1)fail('ConnectionClosed')
  if(bytes.length>defaultLimits.frame||ws.bufferedAmount+bytes.length>defaultLimits.pendingBytes)fail('Backpressure')
  ws.send(decode.decode(bytes))
}
class SocketPort {
  listeners=new Map();closed=false
  constructor(ws){this.ws=ws}
  on(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn)}
  off(name,fn){this.listeners.get(name)?.delete(fn)}
  emit(name,value){for(const fn of [...(this.listeners.get(name)??[])])fn(value)}
  write(bytes,callback){try{send(this.ws,bytes);callback()}catch(error){callback(error)}}
  receive(raw){this.emit('data',Bytes.from(raw.endsWith('\n')?raw:raw+'\n'))}
  destroy(){if(this.closed)return;this.closed=true;this.ws.close(1000);this.emit('close');this.listeners.clear()}
}

export class StateSocketServer {
  sessions=new Map();connections=new Map();closed=false
  constructor({authorize,read,onDiagnostic=()=>{}}){
    if(typeof authorize!=='function'||typeof read!=='function')fail('InvalidEnvelope')
    this.authorize=authorize;this.read=read;this.diagnostic=onDiagnostic
  }
  open(peer){
    try{
      if(this.closed)fail('ConnectionClosed')
      if(this.connections.size>=socketLimits.connections)fail('Backpressure')
      let owner
      try{owner=this.authorize(peer)}catch{fail('UnknownSession')}
      token(owner)
      const c={peer,owner,session:null,count:0,window:Date.now(),timer:setTimeout(()=>this.refuse(peer,'Timeout'),socketLimits.setupMs)}
      this.connections.set(peer,c)
    }catch(error){this.refuse(peer,issue(error))}
  }
  authorized(peer,owner){try{if(this.authorize(peer)!==owner)fail('UnknownSession')}catch{fail('UnknownSession')}}
  message(peer,raw){
    try{
      const c=this.connections.get(peer);if(!c)fail('ConnectionClosed')
      this.authorized(peer,c.owner)
      const {value:v,raw:text}=wire(raw)
      if(v.kind==='MESSAGE'||v.kind==='ACK'){
        if(!c.session)fail('UnknownSession')
        // Browser STATE subscriber does not publish STATE or issue commands.
        if(v.kind!=='ACK')fail('UnsupportedClass')
        c.session.port.receive(text);return
      }
      if(Date.now()-c.window>=1000){c.window=Date.now();c.count=0}
      if(++c.count>socketLimits.controlsPerSecond)fail('Backpressure')
      if(v.kind==='BIND'){
        shape(v,['kind','capabilities']);if(c.session)fail('ProtocolViolation');token(v.capabilities?.session)
        let s=this.sessions.get(v.capabilities.session)
        if(s&&(s.owner!==c.owner||s.peer))fail('UnknownSession')
        if(!s){
          if(this.sessions.size>=socketLimits.sessions)fail('Backpressure')
          s={owner:c.owner,peer:null,subs:new Map(),endpoint:new RealtimeEndpoint({classes:['STATE'],limits:{subscriptions:8},
            onMessage:()=>false,onFailure:e=>{if(s.peer)this.refuse(s.peer,issue(e))}})}
          this.sessions.set(v.capabilities.session,s)
        }
        clearTimeout(c.timer);clearTimeout(s.expiry);s.peer=peer;s.port=new SocketPort(peer.websocket);c.session=s
        s.endpoint.connect(s.port,s.port,v.capabilities)
        write(peer.websocket,{kind:'BOUND',capabilities:s.endpoint.capabilities(),connection:s.endpoint.transport.connection.id})
        this.diagnostic({kind:'bound',session:s.endpoint.sessionId});return
      }
      const s=c.session;if(!s)fail('UnknownSession')
      if(v.kind==='RELEASE'){
        shape(v,['kind']);const id=[...this.sessions].find(([,value])=>value===s)?.[0]
        this.disconnect(peer);clearTimeout(s.expiry);s.subs.clear();if(id)this.sessions.delete(id)
        peer.close(1000);return
      }
      shape(v,['kind','key','generation'],v.kind==='SUBSCRIBE'?['locator','revision']:[]);token(v.key);generation(v.generation)
      if(v.kind==='UNSUBSCRIBE'){
        const old=s.subs.get(v.key)
        if(old&&old.generation===v.generation){s.subs.delete(v.key);s.endpoint.unsubscribe(v.key)}
        return
      }
      if(v.kind!=='SUBSCRIBE')fail('InvalidEnvelope');token(v.locator);if(v.revision!==null)token(v.revision)
      let sub=s.subs.get(v.key)
      if(sub&&sub.generation===v.generation&&sub.locator!==v.locator)fail('InvalidEnvelope')
      if(sub&&sub.generation!==v.generation){s.endpoint.unsubscribe(v.key);s.subs.delete(v.key);sub=null}
      if(!sub){
        s.endpoint.subscribe(v.key,{revision:v.revision})
        sub={key:v.key,locator:v.locator,generation:v.generation,busy:false,dirty:false};s.subs.set(v.key,sub)
      }
      write(peer.websocket,{kind:'SUBSCRIBED',key:v.key,generation:v.generation,session:s.endpoint.sessionId})
      this.pump(s,sub)
    }catch(error){this.refuse(peer,issue(error))}
  }
  async pump(s,sub){
    sub.dirty=true;if(sub.busy||!s.peer||this.closed)return
    sub.busy=true;const peer=s.peer
    let ownerDetail
    try{
      do{
        sub.dirty=false;ownerDetail=undefined
        this.authorized(peer,s.owner)
        const result=await s.endpoint.recover(sub.key,async request=>{
          const result=await this.read({...request,locator:sub.locator})
          this.authorized(peer,s.owner)
          if(result?.kind==='RecoveryUnavailable')ownerDetail=result.detail
          return result
        })
        if(s.peer!==peer||s.subs.get(sub.key)!==sub)return
        if(result.status==='NoChange')write(peer.websocket,{kind:'NO_CHANGE',key:sub.key,generation:sub.generation,session:s.endpoint.sessionId,revision:result.revision})
        else await result.peer
        this.diagnostic({kind:result.status==='NoChange'?'NoChange':'Snapshot',key:sub.key,session:s.endpoint.sessionId})
      }while(sub.dirty&&s.peer===peer&&s.subs.get(sub.key)===sub)
    }catch(error){
      if(s.peer===peer&&s.subs.get(sub.key)===sub){
        const code=issue(error)
        if(code==='UnknownSession'){this.refuse(peer,code);return}
        try{write(peer.websocket,{kind:'UNAVAILABLE',key:sub.key,generation:sub.generation,session:s.endpoint.sessionId,code,...(ownerDetail?{detail:ownerDetail}:{})})}catch{this.refuse(peer,code)}
        this.diagnostic({kind:'unavailable',key:sub.key,code})
      }
    }finally{sub.busy=false;if(sub.dirty&&s.peer&&s.peer!==peer&&s.subs.get(sub.key)===sub)this.pump(s,sub)}
  }
  notify(){for(const s of this.sessions.values())for(const sub of s.subs.values())this.pump(s,sub)}
  refuse(peer,code){
    try{write(peer.websocket,{kind:'FAILURE',code})}catch{}
    peer.close(4000,code);this.disconnect(peer);this.diagnostic({kind:'failure',code})
  }
  disconnect(peer){
    const c=this.connections.get(peer);if(!c)return
    this.connections.delete(peer);clearTimeout(c.timer)
    const s=c.session
    if(s?.peer===peer){
      s.peer=null;s.endpoint.disconnect()
      s.expiry=setTimeout(()=>{for(const [id,value]of this.sessions)if(value===s&&!s.peer){this.sessions.delete(id);s.subs.clear()}},socketLimits.sessionIdleMs)
      this.diagnostic({kind:'disconnected',session:s.endpoint.sessionId})
    }
  }
  inspect(){return {connections:this.connections.size,sessions:this.sessions.size,subscriptions:[...this.sessions.values()].reduce((n,s)=>n+s.subs.size,0),
    pendingBytes:[...this.sessions.values()].reduce((n,s)=>n+s.endpoint.usage.pendingBytes,0)}}
  close(){this.closed=true;for(const peer of [...this.connections.keys()]){peer.close(1001);this.disconnect(peer)}
    for(const s of this.sessions.values())clearTimeout(s.expiry);this.sessions.clear()}
}

export class StateSocketClient {
  wanted=new Map();bound=new Map();retired=new Set();counter=0;attempts=0;closed=false;enabled=false;state='Unavailable';generation=0
  constructor({url,onState,onStatus=()=>{},prepare=async()=>{},createSocket=url=>new WebSocket(url),onDiagnostic=()=>{}}){
    this.url=url;this.onState=onState;this.onStatus=onStatus;this.prepare=prepare;this.createSocket=createSocket;this.diagnostic=onDiagnostic
    this.endpoint=new RealtimeEndpoint({classes:['STATE'],limits:{subscriptions:8},onMessage:message=>{
      const wanted=this.wanted.get(message.metadata.key)
      if(!wanted||this.bound.get(message.metadata.key)!==wanted.generation)fail('UnknownSubscription')
      if(message.metadata.mode!=='Snapshot')fail('RevisionMismatch')
      // Synchronous successful intake/adoption before peer-runtime ACK; never
      // await DOM rendering or claim the user saw this payload.
      this.onState({kind:'Snapshot',key:message.metadata.key,revision:message.metadata.revision,payload:message.payload})
      this.status('Live');this.diagnostic({kind:'Snapshot',key:message.metadata.key,revision:message.metadata.revision})
    },onFailure:e=>this.failed(issue(e))})
  }
  status(state,code=null){this.state=state;this.onStatus({state,code,session:this.endpoint.sessionId,connection:this.endpoint.transport?.connection.id??null,attempts:this.attempts})}
  subscribe({key,locator,revision}){
    token(key);token(locator);if(revision!==null)token(revision)
    const old=this.wanted.get(key)
    if(old?.locator===locator)return
    if(old)this.unsubscribe(key)
    this.retired.delete(key)
    if(this.wanted.size>=8)fail('Backpressure')
    if(this.counter>=Number.MAX_SAFE_INTEGER)fail('SequenceExhausted')
    const sub={key,locator,revision,generation:++this.counter};this.wanted.set(key,sub);this.endpoint.subscribe(key)
    if(this.ready)this.sendSubscription(sub)
  }
  unsubscribe(key){
    const sub=this.wanted.get(key);if(!sub)return
    if(this.ready)write(this.socket,{kind:'UNSUBSCRIBE',key,generation:sub.generation})
    this.wanted.delete(key);this.bound.delete(key);this.endpoint.unsubscribe(key)
    this.retired.add(key);if(this.retired.size>8)this.retired.delete(this.retired.values().next().value)
  }
  sendSubscription(sub){this.status('Connecting');write(this.socket,{kind:'SUBSCRIBE',...sub})}
  start(){if(this.closed)return;this.enabled=true;if(this.socket||this.connecting||this.retryTimer)return;this.connect()}
  async connect(){
    if(this.closed||!this.enabled||this.socket||this.connecting)return
    clearTimeout(this.retryTimer);this.retryTimer=null
    const gen=++this.generation;this.connecting=true;this.status(this.attempts?'Reconnecting':'Connecting')
    this.prepareController=new AbortController()
    this.setupTimer=setTimeout(()=>this.failed('Timeout'),socketLimits.setupMs)
    try{
      await this.prepare(this.prepareController.signal);if(gen!==this.generation||this.closed||!this.enabled)return
      const ws=this.createSocket(this.url);this.socket=ws;ws.binaryType='arraybuffer'
      ws.onopen=()=>{if(gen===this.generation)try{write(ws,{kind:'BIND',capabilities:this.endpoint.capabilities()})}catch(e){this.failed(issue(e))}}
      ws.onmessage=event=>{
        if(gen!==this.generation)return
        try{
          const {value:v,raw}=wire(event.data)
          if(v.kind==='BOUND'){
            shape(v,['kind','capabilities','connection']);token(v.connection);if(this.ready)fail('ProtocolViolation')
            clearTimeout(this.setupTimer);this.port=new SocketPort(ws);this.endpoint.connect(this.port,this.port,v.capabilities)
            this.serverSession=v.capabilities.session;this.ready=true;this.bound.clear()
            for(const sub of this.wanted.values())this.sendSubscription(sub)
            this.diagnostic({kind:'bound',session:this.endpoint.sessionId,peerSession:this.serverSession});return
          }
          if(v.kind==='FAILURE'){shape(v,['kind','code']);token(v.code);this.failed(v.code);return}
          if(!this.ready)fail('UnknownSession')
          if(['MESSAGE','ACK'].includes(v.kind)){
            if(v.session!==this.serverSession)fail('UnknownSession')
            const sub=this.wanted.get(v.metadata?.key)
            // A previously known cancelled key is stale, a forged key is not.
            if(!sub){if(this.retired?.has(v.metadata?.key))return;fail('UnknownSubscription')}
            if(this.bound.get(sub.key)!==sub.generation)return
            this.port.receive(raw);return
          }
          shape(v,['kind','key','generation','session'],v.kind==='NO_CHANGE'?['revision']:v.kind==='UNAVAILABLE'?['code','detail']:[])
          if(v.session!==this.serverSession)fail('UnknownSession');token(v.key);generation(v.generation)
          const sub=this.wanted.get(v.key);if(!sub||sub.generation!==v.generation)return
          if(v.kind==='SUBSCRIBED'){this.bound.set(v.key,v.generation);return}
          if(this.bound.get(v.key)!==v.generation)fail('UnknownSubscription')
          if(v.kind==='NO_CHANGE'){
            token(v.revision);this.onState({kind:'NoChange',key:v.key,revision:v.revision});this.status('Live');this.diagnostic({kind:'NoChange',key:v.key,revision:v.revision})
          }else if(v.kind==='UNAVAILABLE'){token(v.code);this.state='Unavailable';this.onStatus({state:'Unavailable',code:v.code,detail:v.detail??null,session:this.endpoint.sessionId})}else fail('InvalidEnvelope')
        }catch(e){this.failed(issue(e))}
      }
      ws.onerror=()=>{if(gen===this.generation)this.failed('ConnectionFailed')}
      ws.onclose=()=>{if(gen===this.generation)this.failed('ConnectionClosed')}
    }catch(e){if(gen===this.generation)this.failed(e instanceof TransportError?issue(e):'ConnectionFailed')}finally{if(gen===this.generation){this.connecting=false;this.prepareController=null}}
  }
  detach(){
    this.detaching=true
    ++this.generation;this.connecting=false;this.ready=false;clearTimeout(this.setupTimer)
    this.prepareController?.abort();this.prepareController=null
    const ws=this.socket;this.socket=null
    if(ws){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;ws.close()}
    this.endpoint.disconnect();this.bound.clear();this.detaching=false
  }
  failed(code){
    if(this.failing||this.detaching||this.closed)return;this.failing=true;this.detach();this.failing=false
    clearTimeout(this.retryTimer);this.retryTimer=null
    const recoverable=['ConnectionClosed','ConnectionFailed','Timeout'].includes(code)
    if(this.enabled&&recoverable&&this.attempts<socketLimits.retries){
      const delay=socketLimits.backoff[this.attempts++];this.status('Reconnecting',code)
      this.retryTimer=setTimeout(()=>this.connect(),delay)
    }else this.status('Failed',code)
    this.diagnostic({kind:'disconnected',code})
  }
  retry(){if(this.closed)return;clearTimeout(this.retryTimer);this.retryTimer=null;this.detach();this.attempts=0;this.enabled=true;this.connect()}
  close(){if(this.closed)return;this.closed=true;this.enabled=false;clearTimeout(this.retryTimer)
    if(this.ready)try{write(this.socket,{kind:'RELEASE'})}catch{/* physical failure still expires the bounded session */}
    this.detach();this.wanted.clear();this.bound.clear();this.retired.clear();this.status('Unavailable')}
  inspect(){return {state:this.state,session:this.endpoint.sessionId,subscriptions:this.wanted.size,ready:Boolean(this.ready),attempts:this.attempts,pending:this.endpoint.usage}}
}
