# @crowsi/provider-http-transport

[日本語](README.ja.md)

Use bounded HTTP requests with an explicit HTTPS-origin policy, request/response byte limits and a timeout. This package includes no product API, authentication scheme, account storage or persistence.

## Install and use

Version `0.10.0` is published on npm. Configure the transport with the application's reviewed destination and authentication policy.

```sh
npm install --save-exact @crowsi/provider-http-transport@0.10.0
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
- Measure strings, URLSearchParams, ArrayBuffer/views and Blob by their actual byte size. Reject unmeasurable bodies such as FormData and streams at runtime, even though the retained declaration accepts BodyInit.
- Byte limits range from 1 byte through 16 MiB. Timeout ranges from 1 through 60000 ms. Defaults are 64 KiB requests, 1 MiB responses and 15000 ms.

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

Runtime: Node.js 22+. Release checks use Node.js 24.15.0 and npm 11.12.1.

```sh
npm ci
npm run check
npm test
npm pack
```

`src/*.mts` is the typed implementation. `npm run build` generates `dist/*.mjs` and declarations together; do not edit or commit them.
`npm run check` verifies Biome format/lint, strict implementation and consumer types, and the requested 120 physical-line limit. The internal rule is 149 non-empty/non-comment lines; these checks enforce the stricter physical limit.
`prepack` runs checks, builds and runtime tests. Verify the exact archive in a fresh consumer before publication.
Synthetic fetch/stream cases and a loopback-only adapter cover failure paths. The adapter does not establish real TLS, browser cookie/CORS or customer-service compatibility. Tests use no real provider credentials or external mail APIs.

[Usage guide](docs/getting-started.md) · [Security reporting](SECURITY.md) · [Apache-2.0 license](LICENSE) · [Attribution](NOTICE)

## Product responsibility

This component is maintained in [crowsi-net/crowsi-transport-foundation](https://github.com/crowsi-net/crowsi-transport-foundation). Use the [product README](../../README.md) for composition, use cases and trust boundaries.
