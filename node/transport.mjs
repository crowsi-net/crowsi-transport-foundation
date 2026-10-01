import {Bytes as Buffer} from '#bytes'
const randomUUID=()=>globalThis.crypto.randomUUID()

export class TransportError extends Error {
  constructor(outcome) { super(outcome); this.name = 'TransportError'; this.outcome = outcome }
}
const reject = outcome => { throw new TransportError(outcome) }
export const defaultLimits = Object.freeze({ accepted: 1048576, buffered: 1048577,
  frame: 1048578, pendingBytes: 4194312, pendingMessages: 64 })
export function limitsFor(accepted = defaultLimits.accepted, options = {}) {
  const limits = { accepted, buffered: accepted + 1, frame: accepted + 2,
    pendingBytes: 4 * (accepted + 2), pendingMessages: 64, ...options }
  if (!Object.values(limits).every(Number.isSafeInteger) || accepted < 1 || accepted > 16777216
    || limits.buffered !== accepted + 1 || limits.frame !== accepted + 2
    || limits.pendingBytes < limits.frame || limits.pendingBytes > 67108864
    || limits.pendingMessages < 1 || limits.pendingMessages > 128) reject('ProtocolViolation')
  return Object.freeze(limits)
}
export class Connection {
  #state = 'Created'
  constructor() { this.id = randomUUID() }
  get state() { return this.#state }
  open() { if (this.#state !== 'Created') reject('ProtocolViolation'); this.#state = 'Opening'; this.#state = 'Open' }
  assertOpen() { if (this.#state !== 'Open') reject(this.#state === 'Failed' ? 'ConnectionFailed' : 'ConnectionClosed') }
  fail() { if (this.#state !== 'Closed') this.#state = 'Failed' }
  close() { if (this.#state !== 'Closed') { this.#state = 'Closing'; this.#state = 'Closed' } }
}
export class MessageCounter {
  #value
  constructor(initial = 0n) {
    if (typeof initial !== 'bigint' || initial < 0n || initial > 18446744073709551615n) reject('ProtocolViolation')
    this.#value = initial
  }
  next() {
    if (this.#value === 18446744073709551615n) reject('SequenceExhausted')
    return ++this.#value
  }
}
export class LogicalSession {
  #connection
  #sequence = new MessageCounter()
  constructor() { this.id = randomUUID() }
  bind(connection) {
    connection.assertOpen()
    if (this.#connection && !['Closed', 'Failed'].includes(this.#connection.state)) reject('ProtocolViolation')
    this.#connection = connection
  }
  next() {
    if (!this.#connection) reject('ConnectionClosed')
    this.#connection.assertOpen()
    return this.#sequence.next()
  }
}
export class DeliveryReceipt {
  constructor(connection, sequence, bytes) {
    this.connection = connection; this.sequence = sequence; this.bytes = bytes
    this.acknowledgement = 'local-write-only'; Object.freeze(this)
  }
}
export class FrameDecoder {
  #buffer
  #length = 0
  #failed = false
  constructor(limits = defaultLimits) {
    this.limits = limitsFor(limits.accepted, limits)
    this.#buffer = Buffer.allocUnsafe(limits.buffered)
    this.metrics = { bytesConsumed: 0, highWater: 0, allocationCapacity: limits.buffered }
  }
  #take(delimited) {
    const wireBytes = this.#length + Number(delimited)
    if (wireBytes > this.limits.frame) reject('FrameTooLarge')
    if (delimited && this.#length && this.#buffer[this.#length - 1] === 13) this.#length--
    if (this.#length > this.limits.accepted) { this.#failed = true; reject('InputTooLarge') }
    const payload = Buffer.from(this.#buffer.subarray(0, this.#length))
    this.#length = 0
    return { payload, wireBytes }
  }
  feed(chunk, consume) {
    if (this.#failed) reject('ConnectionFailed')
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) reject('MalformedFrame')
    for (const byte of chunk) {
      this.metrics.bytesConsumed++
      if (byte === 10) { if (consume(this.#take(true)) === false) return; continue }
      if (this.#length >= this.limits.accepted
        && !(this.#length === this.limits.accepted && byte === 13)) {
        this.#failed = true; reject('InputTooLarge')
      }
      this.#buffer[this.#length++] = byte
      this.metrics.highWater = Math.max(this.metrics.highWater, this.#length)
    }
  }
  finish(consume) { if (this.#failed) reject('ConnectionFailed'); if (this.#length) consume(this.#take(false)) }
}
export class Budget {
  #messages = 0
  #bytes = 0
  constructor(limits = defaultLimits) { this.limits = limitsFor(limits.accepted, limits) }
  get usage() { return { messages: this.#messages, bytes: this.#bytes } }
  reserve(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) reject('ProtocolViolation')
    if (this.#messages >= this.limits.pendingMessages
      || bytes > this.limits.pendingBytes - this.#bytes) reject('Backpressure')
    this.#messages++; this.#bytes += bytes
    let released = false
    return () => { if (!released) { released = true; this.#messages--; this.#bytes -= bytes } }
  }
}
// Preflight plain JSON without constructing a string, then encode once within the proven bound.
// Getters, prototypes and custom toJSON are not transport values.
export function encodeJson(value, limits = defaultLimits) {
  let size = 0
  const seen = new Set()
  const add = n => { size += n; if (size > limits.accepted) reject('InputTooLarge') }
  function string(s) {
    add(2)
    for (const c of s) {
      const n = c.codePointAt(0)
      add(n === 34 || n === 92 || [8,9,10,12,13].includes(n) ? 2
        : n < 32 || (n >= 0xd800 && n <= 0xdfff) ? 6 : Buffer.byteLength(c))
    }
  }
  function walk(v, depth) {
    if (depth > 64) reject('ProtocolViolation')
    if (v === null) { add(4); return }
    if (typeof v === 'string') { string(v); return }
    if (typeof v === 'number') { add(Number.isFinite(v) ? String(v).length : 4); return }
    if (typeof v === 'boolean') { add(v ? 4 : 5); return }
    if (typeof v !== 'object' || seen.has(v)) reject('ProtocolViolation')
    if (!Array.isArray(v) && ![null,Object.prototype].includes(Object.getPrototypeOf(v))) reject('ProtocolViolation')
    seen.add(v); add(2); let first = true
    function* ownKeys(object) { for (const key in object) if (Object.hasOwn(object, key)) yield key }
    for (const key of Array.isArray(v) ? v.keys() : ownKeys(v)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key)
      if (descriptor?.get || descriptor?.set) reject('ProtocolViolation')
      const item = descriptor?.value
      if (!Array.isArray(v) && item === undefined) continue
      if (!first) add(1); first = false
      if (!Array.isArray(v)) { string(key); add(1) }
      walk(item === undefined ? null : item, depth + 1)
    }
    seen.delete(v)
  }
  walk(value, 0)
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`)
  if (bytes.length !== size + 1) reject('ProtocolViolation')
  return bytes
}

/** One physical stream; application request/response correlation remains at the consumer. */
export class LocalTransport {
  constructor(readable, writable, { limits = defaultLimits, session = new LogicalSession(),
    onFrame = () => {}, onFailure = () => {}, timeoutMs = 10000 } = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) reject('ProtocolViolation')
    this.limits = limitsFor(limits.accepted, limits)
    this.connection = new Connection(); this.connection.open(); session.bind(this.connection)
    this.session = session; this.decoder = new FrameDecoder(this.limits)
    this.budget = new Budget(this.limits); this.writes = new Set(); this.writable = writable
    this.onFailure = onFailure; this.timeoutMs = timeoutMs; this.readable = readable
    this.listeners = {
      data: chunk => { try { this.decoder.feed(chunk, frame => {
        onFrame(frame); return this.connection.state === 'Open'
      }) } catch (error) { this.fail(error) } },
      end: () => { try { this.decoder.finish(onFrame); this.fail(new TransportError('ConnectionClosed')) }
        catch (error) { this.fail(error) } },
      error: () => this.fail(new TransportError('ConnectionFailed')),
      close: () => this.fail(new TransportError('ConnectionClosed'))
    }
    for (const [event, listener] of Object.entries(this.listeners)) readable.on(event, listener)
    writable.on('error', this.listeners.error)
  }
  sendJson(value) {
    return this.sendSequenced(() => value)
  }
  // Delivery extensions can carry the exact existing stream sequence in their envelope.
  // A refused encoding may consume a sequence; it must never reuse one.
  sendSequenced(makeValue) {
    try {
      this.connection.assertOpen()
      const release = this.budget.reserve(this.limits.frame)
      let bytes, sequence
      try { sequence = this.session.next(); bytes = encodeJson(makeValue(sequence), this.limits) }
      catch (error) { release(); throw error }
      return new Promise((resolve, rejectPromise) => {
        let done = false
        const finish = error => { if (done) return; done = true; clearTimeout(timer);
          this.writes.delete(finish); release()
          if (error) rejectPromise(error)
          else resolve(new DeliveryReceipt(this.connection.id, sequence, bytes.length)) }
        const timer = setTimeout(() => this.fail(new TransportError('Timeout')), this.timeoutMs)
        this.writes.add(finish)
        try { this.writable.write(bytes, error => {
          if (error) this.fail(error instanceof TransportError?error:new TransportError('ConnectionFailed')); else finish()
        }) } catch (error) { this.fail(error instanceof TransportError?error:new TransportError('ConnectionFailed')) }
      })
    } catch (error) { return Promise.reject(error) }
  }
  fail(error) {
    if (['Closed','Failed'].includes(this.connection.state)) return
    if (!(error instanceof TransportError)) error = new TransportError('ProtocolViolation')
    this.connection.fail()
    for (const finish of [...this.writes]) finish(error)
    // Keep error listeners until streams close, avoiding unhandled delayed EPIPE.
    this.readable.off('data', this.listeners.data)
    this.readable.destroy(); this.writable.destroy()
    this.onFailure(error)
  }
  close() { this.fail(new TransportError('ConnectionClosed')); this.connection.close() }
}
