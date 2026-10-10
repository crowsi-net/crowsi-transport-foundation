# crowsi-network-observer

Read network-state metadata and produce a bounded observation for review.

## What you can do

- Inspect configured observation inputs.
- Return a structured network-state snapshot.

## Current scope

Observation is read-only. The output does not authorize network changes.

Package distribution is not activated by this documentation. Use the owning product workspace and declared dependency versions. Registry availability is a separate release gate.

## Getting started

Install Rust 1.97 or newer. Run from the owning product workspace:

```sh
cargo test --locked -p crowsi-network-observer
```

## Examples and interface details

## Commands

```bash
cargo run -- sample
cargo run -- observe
cargo run --example sample
cargo test
```

`sample` always emits the checked-in contract example. `observe` reads local
interface metadata and emits `crowsi://network/observations/v1`. Both set
`external_actions` to `false`.

## Contract policy

- Consumers select behavior from `schema`, never from repository layout.
- Unknown JSON fields are rejected when the contract is deserialized.
- Nullable latency and loss mean the probe did not measure those properties.
- New incompatible fields require a new contract URI.

## Documentation and source

[Interface reference](docs/interface-reference.md)

[Usage guide](docs/getting-started.md)

[Examples](examples) · [Schemas](schemas) · [Implementation and public interfaces](src) · [Verification cases](tests) · [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [License](LICENSE) · [Attribution notices](NOTICE)

## Product responsibility

This component is maintained in [crowsi-net/crowsi-transport-foundation](https://github.com/crowsi-net/crowsi-transport-foundation). Use the [product README](../../README.md) for composition, use cases and trust boundaries.
