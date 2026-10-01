export type StateInput={kind:'NoChange',key:string,revision:string}|{kind:'Snapshot',key:string,revision:string,payload:Uint8Array}
export type SocketStatus={state:string,code?:string|null,detail?:unknown,session:string,connection?:string|null,attempts?:number}
export declare const socketLimits:Readonly<{sessions:number,connections:number,subscriptions:number,setupMs:number,sessionIdleMs:number,controlBytes:number,controlsPerSecond:number,retries:number,backoff:readonly number[]}>
export interface StatePeer {request:{headers:Headers};websocket:{readyState:number,bufferedAmount:number,send(value:string):void,close(code?:number,reason?:string):void};close(code?:number,reason?:string):void}
export type StateReadRequest={key:string,locator:string,revision:string|null,maxPayloadBytes:number,signal:AbortSignal}
export type StateReadResult={kind:'Snapshot',revision:string,payload:Uint8Array}|{kind:'NoChange',revision:string}|{kind:'RecoveryUnavailable',detail?:unknown}
export declare class StateSocketServer {
  constructor(options:{authorize:(peer:StatePeer)=>string,read:(request:StateReadRequest)=>StateReadResult|Promise<StateReadResult>,onDiagnostic?:(value:unknown)=>void})
  open(peer:StatePeer):void
  message(peer:StatePeer,raw:string|Uint8Array|ArrayBuffer):void
  disconnect(peer:StatePeer):void
  notify():void
  close():void
  inspect():{connections:number,sessions:number,subscriptions:number,pendingBytes:number}
}
export declare class StateSocketClient {
  constructor(options:{url:string,onState:(value:StateInput)=>void,onStatus?:(value:SocketStatus)=>void,prepare?:(signal:AbortSignal)=>Promise<unknown>,createSocket?:(url:string)=>WebSocket,onDiagnostic?:(value:unknown)=>void})
  subscribe(value:{key:string,locator:string,revision:string|null}):void
  unsubscribe(key:string):void
  start():void
  retry():void
  close():void
  inspect():{state:string,session:string,subscriptions:number,ready:boolean,attempts:number,pending:unknown}
}
