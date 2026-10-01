// Only the byte primitives used by the same framing/delivery engine. No Buffer
// package/polyfill and no Node globals in the browser closure.
const encoder=new TextEncoder()
export class Bytes extends Uint8Array {
  static allocUnsafe(n){return new Bytes(n)}
  static isBuffer(v){return v instanceof Uint8Array}
  static byteLength(v){return encoder.encode(v).length}
  static from(v,encoding){
    if(typeof v!=='string')return new Bytes(v)
    if(encoding!=='base64')return new Bytes(encoder.encode(v))
    const decoded=atob(v);return Bytes.from(Uint8Array.from(decoded,c=>c.charCodeAt(0)))
  }
  toString(encoding){
    if(encoding!=='base64')return new TextDecoder().decode(this)
    let value='';for(let i=0;i<this.length;i+=8192)value+=String.fromCharCode(...this.subarray(i,i+8192))
    return btoa(value)
  }
}
