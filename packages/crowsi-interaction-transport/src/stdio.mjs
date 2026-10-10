import { spawn } from 'node:child_process'
import path from 'node:path'

export class TransportError extends Error {
  constructor(code) { super(code); this.name = 'TransportError'; this.code = code }
}

/** One bounded JSONL channel; no application validation or retry of mutations. */
export function createStdioTransport({command, args = [], env = process.env,
  timeoutMs = 5000, maximumBytes = 1048576, maximumQueue = 32} = {}) {
  if (!path.isAbsolute(command ?? '') || !Array.isArray(args) || args.some(a => typeof a !== 'string')
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1048576
    || !Number.isInteger(maximumQueue) || maximumQueue < 1 || maximumQueue > 128) throw new TransportError('transport/options/invalid')
  let child, active, buffer = Buffer.alloc(0), closed = false, exitPromise, forceTimer
  let disposed = false, reopening, inflight = 0
  const queue = []
  const error = code => new TransportError(code)
  function finish(item, failure, value) {
    clearTimeout(item.timer)
    item.signal?.removeEventListener('abort', item.abort)
    if (failure) item.reject(failure); else item.resolve(value)
  }
  function stop(failure = error('transport/closed')) {
    if (closed) return
    closed = true
    if (active) { finish(active, failure); active = undefined }
    for (const item of queue.splice(0)) finish(item, failure)
    buffer = Buffer.alloc(0)
    if (child) {
      const processToStop = child
      const kill = signal => {
        try {
          if (process.platform !== 'win32') process.kill(-processToStop.pid, signal)
          else processToStop.kill(signal)
        } catch (e) { if (e.code !== 'ESRCH') processToStop.kill(signal) }
      }
      kill('SIGTERM')
      forceTimer = setTimeout(() => kill('SIGKILL'), 200)
    }
  }
  function start() {
    if (child) return
    child = spawn(command, args, {shell:false, env, detached:process.platform !== 'win32', stdio:['pipe','pipe','pipe']})
    exitPromise = new Promise(resolve => child.once('close', () => {
      clearTimeout(forceTimer); child = undefined
      stop(error('transport/process/exited')); resolve()
    }))
    child.once('error', () => stop(error('transport/process/failed')))
    child.stdin.on('error', () => stop(error('transport/write/failed')))
    // Drain stderr, but never expose handler diagnostics as public application data.
    child.stderr.on('data', () => {})
    child.stdout.on('data', chunk => {
      if (closed) return
      if (buffer.length + chunk.length > maximumBytes + 1) { stop(error('transport/response/limit')); return }
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf(10)
      if (end < 0) return
      if (!active || end !== buffer.length - 1) { stop(error('transport/response/unsolicited')); return }
      let value
      try { value = JSON.parse(buffer.subarray(0, end).toString('utf8')) }
      catch { stop(error('transport/response/invalid')); return }
      buffer = Buffer.alloc(0)
      const item = active; active = undefined
      finish(item, undefined, value); pump()
    })
  }
  function pump() {
    if (closed || active || !queue.length) return
    active = queue.shift()
    try { start(); child.stdin.write(active.encoded) }
    catch { stop(error('transport/write/failed')) }
  }
  function enqueue(value, {signal} = {}) {
    if (closed) return Promise.reject(error('transport/closed'))
    if (signal?.aborted) return Promise.reject(error('transport/aborted'))
    let encoded
    try { encoded = JSON.stringify(value) }
    catch { return Promise.reject(error('transport/request/invalid')) }
    if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > maximumBytes) return Promise.reject(error('transport/request/limit'))
    return new Promise((resolve, reject) => {
      const item = {encoded:encoded + '\n',resolve,reject,signal}
      const cancel = code => {
        if (active === item) stop(error(code))
        else {
          const index = queue.indexOf(item)
          if (index >= 0) { queue.splice(index, 1); finish(item, error(code)) }
        }
      }
      item.abort = () => cancel('transport/aborted')
      item.timer = setTimeout(() => cancel('transport/timeout'), timeoutMs)
      signal?.addEventListener('abort', item.abort, {once:true})
      queue.push(item); pump()
    })
  }
  async function request(value, options = {}) {
    if (disposed) throw error('transport/closed')
    if (inflight >= maximumQueue) throw error('transport/queue/full')
    inflight++
    try {
      if (closed) {
        // Reopen only for a NEW request. Failed/queued requests have already
        // been rejected, so an uncertain mutation is never automatically replayed.
        reopening ??= (async () => {
          await exitPromise
          if (disposed) throw error('transport/closed')
          closed = false
        })().finally(() => { reopening = undefined })
        await reopening
      }
      if (disposed) throw error('transport/closed')
      return await enqueue(value, options)
    } finally { inflight-- }
  }
  return {request, status:() => ({closed, pending:inflight, processes:Number(Boolean(child))}),
    close:async () => { disposed = true; stop(); await exitPromise } }
}
