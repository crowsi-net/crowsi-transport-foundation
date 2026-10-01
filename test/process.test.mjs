import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { stopProcess } from '../node/process.mjs'
import fs from 'node:fs'

test('application EOF drains before signal; grace is bounded and failed drain still escalates',async()=>{
  const child=spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>{process.stdout.write('drained');process.exit(0)},60));process.stdout.write('ready')"],{stdio:['pipe','pipe','ignore']})
  let output='';child.stdout.on('data',b=>{output+=b})
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject)})
  child.stdin.end()
  await stopProcess(child,{graceMs:1000,timeoutMs:100})
  assert.equal(child.exitCode,0);assert.equal(child.signalCode,null)
  assert.equal(output,'readydrained')
  const fake=new EventEmitter();fake.exitCode=null;fake.signalCode=null;const signals=[];fake.kill=s=>signals.push(s)
  await assert.rejects(stopProcess(fake,{graceMs:10,timeoutMs:5}),e=>e.outcome==='ConnectionFailed')
  assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal(fake.listenerCount('exit'),0)
  await assert.rejects(stopProcess(fake,{graceMs:Infinity}),e=>e.outcome==='ProtocolViolation')
})

test('owned stubborn child: concurrent close, TERM escalation, reap, repeat close and unreaped refusal', async () => {
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']})
  const deadline=setTimeout(()=>child.kill('SIGKILL'),10000)
  try {
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject)})
    const first=stopProcess(child,{timeoutMs:20}), second=stopProcess(child,{timeoutMs:20})
    assert.equal(first,second);await first;assert.equal(child.signalCode,'SIGKILL')
    await stopProcess(child);assert.equal(child.exitCode,null)
    const fake=new EventEmitter();fake.exitCode=null;fake.signalCode=null;const signals=[];fake.kill=s=>signals.push(s)
    await assert.rejects(stopProcess(fake,{timeoutMs:5}),e=>e.outcome==='ConnectionFailed')
    assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal(fake.listenerCount('exit'),0)
  } finally { clearTimeout(deadline); if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL') }
})

test('guarded child dies with its parent after readiness; no orphan may perform later work',async()=>{
  const module=new URL('../node/process.mjs',import.meta.url).href
  const script=`import {spawnParentBound} from ${JSON.stringify(module)};
    const child=spawnParentBound(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['pipe','pipe','ignore']});
    child.stdout.once('data',()=>process.stdout.write(String(child.pid)+'\\n'));setInterval(()=>{},1000)`
  const parent=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']})
  let childPid
  const timeout=setTimeout(()=>parent.kill('SIGKILL'),5000)
  try{
    childPid=Number(await new Promise((resolve,reject)=>{parent.stdout.once('data',v=>resolve(v.toString().trim()));parent.once('error',reject);parent.once('exit',()=>reject(Error('parent exited before child readiness')))}))
    assert.ok(Number.isSafeInteger(childPid)&&childPid>1)
    const closed=new Promise(resolve=>parent.once('close',resolve));parent.kill('SIGKILL');await closed
    const until=Date.now()+2000
    let running=true
    while(Date.now()<until){
      try{const stat=fs.readFileSync(`/proc/${childPid}/stat`,'utf8');running=!/\) Z /u.test(stat)}catch(error){if(error.code==='ENOENT')running=false;else throw error}
      if(!running)break
      await new Promise(resolve=>setTimeout(resolve,10))
    }
    assert.equal(running,false,'guarded operation survived its parent')
  }finally{
    clearTimeout(timeout);await stopProcess(parent,{timeoutMs:100})
    if(childPid){try{process.kill(childPid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}}
  }
})
