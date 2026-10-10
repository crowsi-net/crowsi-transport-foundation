# crowsi-network-observer interface reference

Use the [usage guide](getting-started.md) for the first steps. This reference preserves the current interface details and operational limits. Run command examples from the repository root, after preparing the exact declared dependencies and registered configuration.

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

## Embedding a probe

Implement `NetworkProbe` and create records with
`NetworkObservationV1::try_new(NetworkObservationInputV1)`. Output fields are
private so invalid records cannot later be mutated and serialized. Use `collect`
to validate cross-record uniqueness and collection limits before sorting and
calculating the declared count. A probe is responsible for observation only;
remediation belongs to a separately authorized controller.

## Contract policy

- Consumers select behavior from `schema`, never from repository layout.
- Unknown JSON fields are rejected when the contract is deserialized.
- Nullable latency and loss mean the probe did not measure those properties.
- New incompatible fields require a new contract URI.
