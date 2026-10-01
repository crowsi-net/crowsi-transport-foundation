import { TransportError } from './transport.mjs'
import {spawn} from 'node:child_process'
import path from 'node:path'

/** Linux parent-death guard. Caller MUST wait for a child readiness response
 * before sending work: this closes the fork/prctl race if the parent dies before
 * setpriv installs the guard. Readiness is application framing, not permission.
 * No privilege, identity, namespace, capability or sandbox settings are changed.
 */
export function spawnParentBound(executable,args,options={}) {
  if(process.platform!=='linux'||!path.isAbsolute(executable)||!Array.isArray(args)
    ||args.some(v=>typeof v!=='string')||options.shell||options.detached)
    throw new TransportError('ProtocolViolation')
  return spawn('/usr/bin/setpriv',['--pdeathsig','SIGKILL','--',executable,...args],
    {...options,shell:false,detached:false})
}
const closing = new WeakMap()
/** Caller owns the child/group. An application may close its intake first and
 * grant bounded drain time. This never sends application messages or retries
 * work; expiration retains TERM/KILL/reap and parent-death enforcement. */
export function stopProcess(child, { timeoutMs = 2000, group = false, graceMs = 0 } = {}) {
  if (!child) return Promise.resolve()
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 60000) {
    return Promise.reject(new TransportError('ProtocolViolation'))
  }
  if (closing.has(child)) return closing.get(child)
  const promise = stop(child, timeoutMs, group, graceMs)
  closing.set(child, promise)
  return promise
}
async function stop(child, timeout, group, grace) {
  if (stopped(child) && !group) return
  if (grace && await wait(child, grace)) {
    if (group) signal(child, 'SIGKILL', group)
    return
  }
  signal(child, 'SIGTERM', group)
  const reaped = await wait(child, timeout)
  // The leader exiting does not prove its owned descendants exited.
  if (group || !reaped) signal(child, 'SIGKILL', group)
  if (!reaped && !await wait(child, timeout)) throw new TransportError('ConnectionFailed')
}
function signal(child, name, group) {
  try {
    if (group && process.platform === 'linux' && child.pid) process.kill(-child.pid, name)
    else if (!stopped(child)) child.kill(name)
  } catch (error) { if (error.code !== 'ESRCH') throw new TransportError('ConnectionFailed') }
}
function stopped(child) { return child.exitCode != null || child.signalCode != null }
function wait(child, timeout) {
  if (stopped(child)) return Promise.resolve(true)
  return new Promise(resolve => {
    const finish = value => { clearTimeout(timer); child.off('exit', exited); resolve(value) }
    const exited = () => finish(true)
    const timer = setTimeout(() => finish(stopped(child)), timeout)
    child.once('exit', exited)
    if (stopped(child)) finish(true)
  })
}
