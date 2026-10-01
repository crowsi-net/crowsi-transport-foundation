import { createHash, randomUUID } from 'node:crypto'
export {classes as supportedClasses} from './realtime-contract.mjs'
import { TransportError } from './transport.mjs'
import { fail, bounded, shape, same, deferred, synchronous } from './realtime-contract.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex')
const abort=(sink,error)=>{try{synchronous(sink.abort(error),'BulkIncomplete')}catch{}}
// Only transport digest/order metadata is retained. The caller owns staging/storage.
export class BulkIntake {
  #active=new Map()
  constructor(limits,open,timeoutMs,onOutcome){this.limits=limits;this.open=open;this.timeoutMs=timeoutMs;this.onOutcome=onOutcome}
  get size(){return this.#active.size}
  accept(m,payload){
    let entry=this.#active.get(m.transfer)
    if(payload.length<1||payload.length>this.limits.chunkBytes)fail('InputTooLarge')
    if(!entry){
      if(m.index!==0)fail('BulkIncomplete')
      if(this.size>=this.limits.transfers)fail('Backpressure')
      const sink=synchronous(this.open?.(Object.freeze({...m})),'RecoveryUnavailable')
      if(!sink||['write','commit','abort'].some(k=>typeof sink[k]!=='function'))fail('RecoveryUnavailable')
      entry={sink,index:0,bytes:0,total:m.totalBytes,digest:m.digest,hash:createHash('sha256'),previous:null}
      this.#active.set(m.transfer,entry)
    }
    try {
      if(entry.total!==m.totalBytes||entry.digest!==m.digest)fail('BulkIntegrityFailure')
      if(entry.previous&&m.index===entry.index-1){
        if(!same(entry.previous.metadata,m)||entry.previous.digest!==hash(payload))fail('BulkIntegrityFailure')
        return false
      }
      if(m.index!==entry.index||payload.length>entry.total-entry.bytes)fail('BulkIncomplete')
      if(m.last!== (entry.bytes+payload.length===entry.total))fail('BulkIncomplete')
      entry.hash.update(payload)
      if(m.last&&entry.hash.digest('hex')!==entry.digest)fail('BulkIntegrityFailure')
      synchronous(entry.sink.write(payload,m.index),'BulkIncomplete')
      entry.bytes+=payload.length;entry.index++;entry.previous={metadata:m,digest:hash(payload)}
      clearTimeout(entry.timer)
      if(m.last){
        synchronous(entry.sink.commit({transfer:m.transfer,bytes:entry.bytes,digest:entry.digest}),'BulkIncomplete')
        this.#active.delete(m.transfer)
      }else entry.timer=setTimeout(()=>{
        this.#active.delete(m.transfer);const error=new TransportError('BulkIncomplete')
        abort(entry.sink,error);this.onOutcome(error)
      },this.timeoutMs)
      return true
    }catch(error){clearTimeout(entry.timer);this.#active.delete(m.transfer);abort(entry.sink,error);throw error}
  }
  close(){for(const [key,entry]of this.#active){clearTimeout(entry.timer);this.#active.delete(key);abort(entry.sink,new TransportError('BulkIncomplete'))}}
}
export class BulkOutput {
  #index=0;#bytes=0;#busy=false;#closed=false
  #done=deferred();#timer
  constructor(descriptor,limits,send,release,timeoutMs,onOutcome){
    shape(descriptor,['totalBytes','digest']);bounded(descriptor.totalBytes,limits.transferBytes)
    if(typeof descriptor.digest!=='string'||!/^[a-f0-9]{64}$/.test(descriptor.digest))fail('InvalidEnvelope')
    this.descriptor=Object.freeze({...descriptor});this.id=randomUUID();this.limits=limits;this.send=send;this.release=release
    this.timeoutMs=timeoutMs;this.onOutcome=onOutcome;this.#arm()
  }
  get completion(){return this.#done.promise}
  #arm(){clearTimeout(this.#timer);this.#timer=setTimeout(()=>{const e=new TransportError('BulkIncomplete');this.abort();this.onOutcome(e)},this.timeoutMs)}
  write(payload,{last=false}={}){
    if(this.#closed)fail('BulkIncomplete')
    if(this.#busy)fail('Backpressure')
    if(!Buffer.isBuffer(payload)||!payload.length||payload.length>this.limits.chunkBytes)fail('InputTooLarge')
    if(payload.length>this.descriptor.totalBytes-this.#bytes||last!==(this.#bytes+payload.length===this.descriptor.totalBytes))fail('BulkIncomplete')
    const ticket=this.send('BULK',{transfer:this.id,...this.descriptor,index:this.#index,last},payload)
    this.#busy=true
    ticket.peer.then(()=>{
      if(this.#closed)return
      this.#busy=false;this.#bytes+=payload.length;this.#index++
      if(last){this.#closed=true;clearTimeout(this.#timer);this.release();this.#done.resolve({status:'peer-delivered',transfer:this.id})}
      else this.#arm()
    },()=>this.abort())
    return ticket
  }
  abort(){if(!this.#closed){this.#closed=true;clearTimeout(this.#timer);this.release();this.#done.reject(new TransportError('BulkIncomplete'))}}
}
