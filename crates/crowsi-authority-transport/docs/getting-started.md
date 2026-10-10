# Using crowsi-authority-transport

Exchange signed, bounded authority messages over an explicitly trusted mTLS connection.

## Before you start

Trust roots, certificates and endpoints are registered by the operator. Transport success does not authorize the payload operation.

## First steps

Run from the repository root:

```sh
cargo test --locked
```

## How to assess the result

- Validate peer and signed-message context.
- Carry device/authority metadata without exporting custody values.

A passing source-level check establishes only what that check observes. Keep missing configuration, unavailable services and unverified deployment paths visible.

## Continue reading

[Repository overview](../README.md)
