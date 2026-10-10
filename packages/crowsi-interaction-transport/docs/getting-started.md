# Using @crowsi/interaction-transport

Carry bounded UI interaction messages between a caller and an application handler.

## Before you start

The host supplies application routing and authority. Transport does not interpret the business operation.

## First steps

Run from the repository root:

```sh
npm install
npm run test
```

## How to assess the result

- Validate transport framing and cancellation.
- Keep opaque interaction payloads within declared limits.

A passing source-level check establishes only what that check observes. Keep missing configuration, unavailable services and unverified deployment paths visible.

## Continue reading

[Repository overview](../README.md)
