# Realtime delivery and owner-driven recovery

`@crowsi/transport-foundation/realtime` is an optional Node runtime over the accepted
bounded byte foundation, not a second Hatter protocol or a state database.
There is no extra runtime dependency, persistent session store, worker thread or
model process. The Rust crate remains the byte/IO foundation; a Rust delivery
implementation is not claimed. See `realtime-contract.json` for the wire contract.

Create `RealtimeEndpoint({onMessage, onFailure, onBulk?, limits?, ackTimeoutMs?})`.
Explicitly exchange `capabilities()` through the caller's trusted connection setup,
then `connect(readable, writable, peerCapabilities)`. This is protocol/version/class
negotiation, not identity authentication. No wire HELLO/auth authority is invented.
Only the exact version and supported classes are accepted; resource maxima are
intersected. `disconnect()` is idempotent, settles pending delivery, aborts owner
recovery and partial bulk, and does not replay any command. Reconnect binds new
physical streams; it cannot modify application references carried in payloads.

## STATE

Both endpoints register opaque keys with `subscribe(key)`. The producer calls
`recover(key, owner)`; the owner receives `{key, revision, maxPayloadBytes, signal}`.
It explicitly returns `{kind:'Snapshot',revision,payload:Buffer}`, a `Delta` with
`baseRevision`, exact `NoChange`, or a typed unavailable/mismatch result. NoChange
sends no payload. Unknown/old revisions only recover if the owner supplies a
snapshot. Crowsi never calculates domain differences or interprets revision values.
DeltaChain is not supported in this slice: an owner provides one safe delta or
snapshot, not a chain that Crowsi silently flattens.

`cursor(key)` returns copies of last-sent, last-peer-confirmed and receive-delivery
metadata. Sending does not confirm a revision. ACKs must match a known pending
message, session, class, subscription and exact revision. Delayed old ACKs cannot
regress the confirmed cursor. No ACK means no confirmation; after reconnect the
owner may supply the same snapshot again. The receiving application must apply
same-revision snapshots idempotently; peer delivery is not semantic adoption.
Owner callbacks must honor their AbortSignal and budget. Unsubscribe/disconnect or
timeout cancels the in-progress request; a late result cannot enter a replaced
subscription. Owner allocations and application canonical state remain external.

## COMMAND and EVENT

`send('COMMAND',{operation},bytes)` returns `{sequence,local,peer,completion,cancel}`.
`local` is only DeliveryReceipt. `peer` is only PeerDeliveryAck. `completion` tracks
correlation release, not execution. The application calls `completeCommand(sequence)`
when it observes its own receipt or explicitly ends correlation; Crowsi neither
creates nor validates an application CommandReceipt. Disconnect/timeout before
that produces DeliveryUncertain, including after a peer ACK. An explicit same-ID
retry gets a different MessageSequence; application admission/dedup owns effects.
Caller-side validation throws synchronously; write/sequence failures reject ticket
promises. Pre-write sequence failure can return a ticket with `sequence:null`.
No promise or correlation is retained after terminal handling.

EVENT uses the same reliable bounds and sequence but has no STATE effect. Event
recovery, if needed, must come from an event owner. No event history is reconstructed
as current state. A STATE recovery uses the separate state-owner callback.

## BULK and EPHEMERAL

`beginBulk({totalBytes,digest})` returns a fresh transport transfer with
`write(Buffer,{last?})`, `completion`, and `abort()`. Await each chunk's `peer` before
the next; one in-flight chunk per transfer is intentional bounded flow control.
Large objects are never assembled by Crowsi. The receiving `onBulk` supplies a
synchronous `{write,commit,abort}` staging sink; it must not expose staged bytes as a
complete object before commit. Each chunk is <=64 KiB, whole transfer <=16 MiB,
two concurrent transfers per direction. Final total and SHA-256 must both match.
Only an exact duplicate of the immediately previous chunk is accepted without a
second sink write. Missing/changed chunks, wrong digest, timeout and disconnection
cannot complete a transfer. Restart uses a fresh ID and explicit owner decision.

EPHEMERAL returns queued or explicitly dropped under pressure. It has no peer ACK
or recovery promise. Shared FIFO writer limits do not create priorities or silent
reliable loss: STATE/COMMAND/EVENT pressure is explicit Backpressure. At most four
whole-frame reservations fit in each default 4 MiB budget; transport and pending
ACK/correlation reservations are separate. Incoming callbacks are synchronous and
must not return promises; asynchronous domain work is scheduled by its own owner.

## Product integration boundary

This library is available from an immutable npm archive to the current local
consumer. Existing management Request/METHODS remains Hatter-owned JSONL; no
generic envelope is forced into that protocol. Acceptance uses actual Hatter
management alongside a synthetic state/delivery owner. Production STATE meaning,
ProjectionRevision and scene rebuilding remain the application's/PP's concern.

## Optional browser STATE socket binding

`@crowsi/transport-foundation/state-socket` adapts a WebSocket to the same
RealtimeEndpoint MESSAGE/ACK engine. Conditional byte utilities avoid Node imports
in browsers; browser capability negotiation offers STATE only (BULK is explicitly
unsupported). There is no Socket.IO, second sequence engine or application store.

`StateSocketServer({authorize,read})` consumes an existing server peer's public
`request`, `websocket` and `close`. The host must enforce same-origin/access checks
at upgrade and authorization is checked again per message. WebSocket framing must
limit input to 1,048,578 bytes and disable compression before application parsing.
`read({key,locator,revision,...})` returns the existing Snapshot/NoChange/
RecoveryUnavailable contract. `locator` is an opaque application-owned read binding,
not a source reference interpreted by Crowsi. Optional unavailable detail is bounded
by the 4 KiB control frame; applications must redact it before handing it over.

Controls are closed JSON records separate from MESSAGE/ACK:

| Direction | Kind | Fields after kind |
| --- | --- | --- |
| Client | BIND | capabilities |
| Server | BOUND | capabilities, connection |
| Client | SUBSCRIBE | key, locator, revision, generation |
| Server | SUBSCRIBED | key, generation, session |
| Client | UNSUBSCRIBE | key, generation |
| Server | NO_CHANGE | key, generation, session, revision |
| Server | UNAVAILABLE | key, generation, session, code; optional detail |
| Server | FAILURE | code |
| Client | RELEASE | none |

Initial receiver revision is bootstrap context, never an ACK cursor. Lost ACKs
recover from lastConfirmed (or initial receiver revision), not lastSent. New
physical connections preserve the logical session for at most 30 seconds under
the same access session. A server restart uses a new peer session and rebuilds
only transport context; read callbacks still supply durable current state.
Generation fences cancel replaced subscriptions before accepting their results.
Application adoption is synchronous before runtime ACK; ACK is not rendering,
user visibility, persistence, Grant admission or an effect receipt.

Limits: 8 connections, 8 retained sessions, 8 subscriptions/session, 64 controls
per second/connection, 5-second setup deadline. Original frame, payload, writer
and correlation bounds remain unchanged. Client retry is bounded to five delays
(250/500/1000/2000/4000 ms), including flapping connections; exhausted retries need
explicit retry. Page disposal sends RELEASE and clears listeners/timers; abnormal
disconnect expires only bounded transport context. STATE writer pressure is typed,
never silent loss; no reconnect replays commands. `notify()` is a wakeup hint, not
an alternative state authority or polling loop.
