# crowsi-transport-foundation

Vendor-neutral bounded transport primitives for local message framing, delivery identity, asynchronous I/O and guarded process/network exchanges. Use this crate to share size limits, backpressure, cancellation and deadlines without coupling transport to application meaning.

## Install

```toml
[dependencies]
crowsi-transport-foundation = "0.10.0"
```

This dependency uses crates.io; no private registry is required.

## Capabilities

- Decode bounded frames and track connection/session delivery identity.
- Apply asynchronous framing and loopback HTTP adapters through features.
- On Linux, stream response chunks with backpressure and one absolute deadline.

## Example

```rust
use crowsi_transport_foundation::{Connection, Limits};

Limits::default().validate()?;
let connection = Connection::new()?;
connection.open()?;
connection.ensure_open()?;
# Ok::<(), crowsi_transport_foundation::Outcome>(())
```

## Features and requirements

Default features provide the synchronous core. `async-io` enables Tokio I/O; `process` enables Linux process helpers; `http-contract` adds HTTP wire types; `loopback-http` adds the async loopback HTTP adapter.

## Boundaries

The caller supplies authentication, authorization and protocol interpretation. Delivered bytes do not prove application completion. Streamed chunks remain provisional if the exchange fails; the transport does not retry requests.

## Development

```sh
cargo fmt --all -- --check
cargo test --locked --all-features
cargo clippy --locked --all-targets --all-features -- -D warnings
```

## Documentation and license

[API documentation](https://docs.rs/crowsi-transport-foundation) · [Source](https://github.com/crowsi-net/crowsi-transport-foundation) · [Usage guide](https://github.com/crowsi-net/crowsi-transport-foundation/blob/main/docs/getting-started.md)

Apache-2.0. Retain the package LICENSE and NOTICE; see the source repository for security reporting and contribution guidelines.
