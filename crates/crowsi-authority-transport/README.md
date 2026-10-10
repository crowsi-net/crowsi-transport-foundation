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
