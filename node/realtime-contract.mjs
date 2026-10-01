import { TransportError } from './transport.mjs'
import {Bytes as Buffer} from '#bytes'
export const classes = Object.freeze(['STATE','COMMAND','EVENT','BULK','EPHEMERAL'])
export const defaults = Object.freeze({subscriptions:16,correlations:64,transfers:2,
  payloadBytes:524288,chunkBytes:65536,transferBytes:16777216})
export const fail = outcome => { throw new TransportError(outcome) }
// Async admission/staging is not part of this bounded synchronous intake contract.
// Observe a misconfigured callback's rejection before refusing it; never leave an
// unhandled Promise capable of terminating the hosting process.
export function synchronous(value,outcome){
  if(value?.then){Promise.resolve(value).catch(()=>{});fail(outcome)}
  if(value===false)fail(outcome)
  return value
}
export function token(v) { if(typeof v!=='string'||!v.length||Buffer.byteLength(v)>512||/[\x00-\x1f\x7f]/u.test(v))fail('InvalidEnvelope');return v }
export function sequence(v) { if(typeof v!=='string'||! /^[1-9][0-9]{0,19}$/.test(v)||BigInt(v)>18446744073709551615n)fail('InvalidEnvelope');return BigInt(v) }
export function shape(v,required,optional=[]) {
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype
    ||required.some(k=>!Object.hasOwn(v,k)))fail('InvalidEnvelope')
  for(const k in v)if(Object.hasOwn(v,k)){
    if(!required.includes(k)&&!optional.includes(k))fail('InvalidEnvelope')
    const property=Object.getOwnPropertyDescriptor(v,k)
    if(property.get||property.set)fail('InvalidEnvelope')
  }
}
export function bounded(v,max) { if(!Number.isSafeInteger(v)||v<1||v>max)fail('InvalidEnvelope');return v }
export function bounds(v={}) {
  shape(v,[],Object.keys(defaults));const result={...defaults,...v}
  for(const k of Object.keys(result))bounded(result[k],defaults[k])
  if(result.chunkBytes>result.payloadBytes||result.chunkBytes>result.transferBytes)fail('InvalidEnvelope')
  return Object.freeze(result)
}
export function metadata(kind,m,limit) {
  if(!classes.includes(kind))fail('UnsupportedClass')
  if(kind==='STATE') {
    shape(m,['key','revision','mode'],['baseRevision']);token(m.key);token(m.revision)
    if(!['Snapshot','Delta'].includes(m.mode))fail('InvalidEnvelope')
    if(m.mode==='Delta'){token(m.baseRevision);if(m.baseRevision===m.revision)fail('RevisionMismatch')}
    else if(m.baseRevision!==undefined)fail('InvalidEnvelope')
  }else if(kind==='COMMAND'){shape(m,['operation']);token(m.operation)}
  else if(kind==='EVENT'){shape(m,[],['event']);if(m.event!==undefined)token(m.event)}
  else if(kind==='BULK'){
    shape(m,['transfer','totalBytes','index','last','digest']);token(m.transfer);bounded(m.totalBytes,limit.transferBytes)
    if(!Number.isSafeInteger(m.index)||m.index<0||m.index>=m.totalBytes||typeof m.last!=='boolean'||typeof m.digest!=='string'||!/^[a-f0-9]{64}$/.test(m.digest))fail('InvalidEnvelope')
  }else shape(m,[])
  return Object.freeze({...m})
}
export const same = (a,b) => Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k])
export function deferred() {
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});promise.catch(()=>{})
  return {promise,resolve,reject}
}
