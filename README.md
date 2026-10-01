# Crowsi transport foundation

Version 0.10.0. A small standalone Rust crate (std core, optional existing Tokio IO)
and a dependency-free Node package for bounded local streams. See `contract.json`.

The caller owns application parsing, request correlation, authorization and exact
execution references. This package never reads credentials, invokes methods,
reinterprets semantic data, spawns inference, retries effects, or publishes state.
Delivery receipts prove only a local write completed. Other receipt types remain
in their existing owners; they are deliberately not redefined or aliased here.

`Reader`/`FrameDecoder` reject over-limit input before accumulation. CRLF and split
UTF-8 are byte-framed before application decoding. A malformed small JSON document
is an application parse failure; an oversized malformed document is a resource
failure first. The terminal connection is never reused after a partial write,
timeout or oversize. Explicit reconnect may retain a LogicalSession but cannot
change application refs. Empty EOF is no message; a final nonempty EOF frame is
delivered once. A reader after EOF is closed; EOF does not cancel an independently
owned response pipe before its final response is written.

Default accepted payload 1 MiB, frame 1 MiB + 2, accumulation 1 MiB + 1, pending
reservation 4 × frame and 64 messages. Conservative whole-frame reservation means
at most four default queued/in-flight encodings. Read-ahead is 8 KiB in Rust;
Node consumes caller-supplied chunks without copying an over-limit suffix.
Live decoder memory is at most two bounded buffers while returning a frame;
application parsing/storage and caller-owned incoming chunks are separate costs.
No payload history is retained. Node buffers accepted writes until callbacks;
backpressure is refusal before encoding, never silent command loss.

The optional Rust `http-contract` feature owns provider-neutral request/body
types and deterministic JSON/Zstd wire preparation. The optional
`loopback-http` feature owns bounded parsing of one short-lived loopback GET.
Neither feature chooses a destination, reads credentials, executes a provider
request, retries an effect, or interprets a response. Network engines and
provider adapters consume these contracts and retain those separate
responsibilities.

Tests: `cargo test --locked --offline --features async-io,http-contract,loopback-http`
and `node --test test/*.test.mjs`.
Consumers use immutable registry/tarball artifacts; source imports across owners
are forbidden. `stopProcess` requires an explicitly owned child; `group: true`
requires a dedicated spawned process group, never the caller's group.

The optional Node `./realtime` export extends this foundation with owner-neutral
delivery classes and state recovery. Its separate contract and operating rules
are shipped in the npm artifact as `realtime-contract.json` and `REALTIME.md`.
Rust callers reference framing/IO through a versioned crate; Node callers reference
the documented exports through a versioned package.
External HTTP execution, WebSocket/provider policy, projection and model runtime
integration remain outside this foundation. Existing management JSONL is not
redefined by this extension.
# Parent-bound local operations

`spawnParentBound` in the `./process` export launches a Linux child with a kernel
parent-death `SIGKILL` using the installed util-linux `/usr/bin/setpriv`. It fails
closed if unavailable; there is no unguarded fallback. It changes no privileges
or isolation settings. Before transmitting any work, the caller must await a
child readiness response. This prevents work from starting in the fork/guard
installation race. Normal cancellation still uses `stopProcess` and waits for
termination/reaping. This primitive governs lifetime, never source or execution
authorization; it does not promise descendant-tree control.
