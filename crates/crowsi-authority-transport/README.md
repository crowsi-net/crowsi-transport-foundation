# crowsi-authority-transport

Exchange signed, bounded authority messages over an explicitly trusted mTLS connection.

## What you can do

- Validate peer and signed-message context.
- Carry device/authority metadata without exporting custody values.

## Current scope

Trust roots, certificates and endpoints are registered by the operator. Transport success does not authorize the payload operation.

Package distribution is not activated by this documentation. Use the owning product workspace and declared dependency versions. Registry availability is a separate release gate.

## Getting started

Install Rust 1.97 or newer. Run from the owning product workspace:

```sh
cargo test --locked -p crowsi-authority-transport
```

## Documentation and source

[Usage guide](docs/getting-started.md)

[Detailed documentation](docs) · [Implementation and public interfaces](src) · [Verification cases](tests) · [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [License](LICENSE) · [Attribution notices](NOTICE)

## Product responsibility

This component is maintained in [crowsi-net/crowsi-transport-foundation](https://github.com/crowsi-net/crowsi-transport-foundation). Use the [product README](../../README.md) for composition, use cases and trust boundaries.

## TLS dependency security

The 0.1.1 source candidate requires rustls 0.23.46 for RUSTSEC-2026-0346,
0347, 0348 and 0349. The opaque envelope, pinned identity, TLS peer checks and
capability boundaries are unchanged. This source update does not mean the new
crate is published. Registry rollout and consumer provenance are tracked in
coela-oss/coela-release#123; never re-publish the immutable 0.1.0 archive.
