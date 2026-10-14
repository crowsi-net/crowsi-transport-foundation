# @crowsi/provider-http-transport

[日本語](README.ja.md)

Use bounded HTTP requests with an explicit HTTPS-origin policy, request/response byte limits and a timeout. The base transport owns bounded HTTP. The Node-only local-control entrypoint composes reviewed operations with account/request-bound grants and injected credentials; it does not own product APIs, account storage or a native custody service.

## Install and use

Release version: `0.11.2`. Verify registry availability and provenance before adoption. Configure the transport with the application's reviewed destination and authentication policy.

```sh
npm install @crowsi/provider-http-transport
```

```js
import { createProviderHttpTransport } from '@crowsi/provider-http-transport'
const transport = createProviderHttpTransport({
  allowedOrigins: ['https://provider.example'],
  maximumRequestBytes: 65536,
  maximumResponseBytes: 1048576,
  timeoutMs: 15000
})
// The application owner configures the real destination and credentials.
const result = await transport.request({ url: 'https://provider.example/items' })
```

## Policy and bounds

- Origins must be canonical HTTPS origins without a path, trailing slash or userinfo. Reject HTTP, other origins or ports, URL credentials, fragments and redirects.
- Admit only GET, POST, PATCH, PUT and DELETE. GET and DELETE cannot carry a body.
- Measure strings, URLSearchParams, ArrayBuffer/views and Blob by their actual byte size. Reject unmeasurable bodies such as FormData and streams in both the public type contract and runtime checks. Mutable URLSearchParams/buffer/view bodies are copied before asynchronous dispatch.
- Response streams accept at most 4096 byte chunks, including empty chunks; non-byte or excessively fragmented streams are rejected. Chunks are copied before the producer can reuse their buffer. Byte limits range from 1 byte through 16 MiB. Timeout ranges from 1 through 60000 ms. Defaults are 64 KiB requests, 1 MiB responses and 15000 ms.

Responses return `status`, `statusText`, `Headers` and a `Uint8Array` body. The application interprets HTTP error statuses.
Stalled fetch/body waits settle on abort or timeout. Best-effort stream cancellation cleanup does not block completion.
Caller cancellation uses `transport/request/aborted`; the internal timer uses `transport/request/timeout`; communication failures use `transport/request/unavailable`. Origin, size, method and redirect failures can also be distinguished through `ProviderTransportError.code`.

## Credentials and timing limits

Caller headers are forwarded to fetch; request details are not added to the result. The transport does not generate, store or log authentication headers.
Browser credentials, CORS and cookie defaults remain unchanged, including possible same-origin cookies.
`cause` retains original driver details and may contain URLs or credentials. Log safe error codes rather than potentially sensitive causes.
`fetchImplementation` is a trusted replacement and must honor signals and manual redirects. This transport is not a sandbox that can forcibly stop external communication by an implementation that ignores them.
Timeout bounds asynchronous I/O waiting, not real elapsed time during event-loop suspension or browser sleep.

## Development and verification

Runtime: Node.js 22+. Release checks use Node.js 24.15.0 and npm 12.2.0.

```sh
npm ci
npm run check
npm test
npm pack
```

`src/*.mts` is the typed implementation. `npm run build` generates `dist/*.mjs` and declarations together; do not edit or commit them.
`npm run check` verifies Biome format/lint, strict implementation and consumer types, and the requested 120 physical-line limit. The internal rule is 149 non-empty/non-comment lines; these checks enforce the stricter physical limit.
`prepack` runs checks, builds and runtime tests. Owner CI additionally packs the archive, installs it outside the checkout and verifies public types, read/write/read-back, replay rejection and escaped credential rejection before publication. Verify the exact archive in a fresh consumer before publication.
Synthetic fetch/stream cases and a loopback-only adapter cover failure paths. The adapter does not establish real TLS, browser cookie/CORS or customer-service compatibility. Tests use no real provider credentials or external mail APIs.

[Usage guide](docs/getting-started.md) · [Security reporting](SECURITY.md) · [Apache-2.0 license](LICENSE) · [Attribution](NOTICE)

## Product responsibility

This component is maintained in [crowsi-net/crowsi-transport-foundation](https://github.com/crowsi-net/crowsi-transport-foundation). Use the [product README](https://github.com/crowsi-net/crowsi-transport-foundation/blob/main/README.md) for composition, use cases and trust boundaries.

## Local administrator control (Node 24)

The `./local-control` entrypoint binds an account and reviewed operation catalog
into exact request plans. The trusted owner approves a plan for at most five
minutes. Execute consumes the opaque grant before acquiring any bearer material;
failures also consume it. Unknown operations, changed requests, replay, expiry,
redirects and unbounded responses fail closed. Provider errors are not echoed.
A successful request does not prove a complete permission inventory.

A grant remains revocable while credential acquisition or HTTP execution is in flight.
Revocation signals cancellation and suppresses a successful receipt; it cannot undo
a remote write already dispatched. `ProviderExecutionError.outcome` distinguishes
`not-started`, `not-completed` and `indeterminate-write`. Read back the actual
provider state before considering a retry of an indeterminate write.
HTTP 204/205 produces `data: null`; unexpected nonempty bodies are rejected.
Operation metadata and origin policy are copied at registration. `discard`
removes an unused plan; abandoned plans expire after five minutes.

`prepare`, `discard`, `approve`, `revoke` and `execute` belong to the owner composition.
Give generated code only a restricted execute port and a reviewed grant, never
approve, credential sources, or the mutable host environment. This library is
not a process sandbox or a credential daemon. Use the Crowsi workload/custody
boundary when executing untrusted code. JavaScript credential strings are held
inside the trusted host and cannot guarantee native-memory zeroization.

Tests use injected credentials and fake HTTP only; no real login, keyring,
provider account or billing operation is exercised. The explicit owner-only
local command/keyring adapters are opt-in and never run on import.

The generic broker supports JSON responses, one bounded HTTP request per grant,
and no automatic pagination or polling. Each follow-up requires another plan
and grant. Binary finance reports require a separately reviewed decoder.

## Execute-only worker port (new source API)

`./execute-port` exposes `createExecutePort(control)`. The owner registers an exact approved plan/permit and gives the isolated worker only `{ grantId, requestDigest }` plus the handle transport. Registration, approval, credential sources and revoke remain owner-only. Extra fields, substituted digests, unknown/revoked grants and replay are rejected. See [composition and playground](docs/execute-port.md). This new entrypoint is not contained in the published 0.11.2 archive; the isolated candidate consumer verifies the changed source before a new release.

`control.describe()` returns the copied account/origin/operation catalog without acquiring credentials or making HTTP requests. Its permission state is `not-observed`: declared requirements are not effective IAM rights. Give this catalog to the trusted administrator UI, while generated workers receive only the registered execute request.
