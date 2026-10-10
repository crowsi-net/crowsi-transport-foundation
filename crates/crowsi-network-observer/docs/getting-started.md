# Using crowsi-network-observer

Read network-state metadata and produce a bounded observation for review.

## Before you start

Observation is read-only. The output does not authorize network changes.

## First steps

Run from the repository root:

```sh
cargo test --locked
```

## How to assess the result

- Inspect configured observation inputs.
- Return a structured network-state snapshot.

A passing source-level check establishes only what that check observes. Keep missing configuration, unavailable services and unverified deployment paths visible.

## Continue reading

[Repository overview](../README.md)
