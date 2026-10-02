# Using @crowsi/transport-foundation

Exchange bounded messages between local processes without building framing and timeout handling again.

## Before you start

The caller owns authentication, authorization and message meaning.

## First steps

Run from the repository root:

```sh
npm install
npm run test
```

## How to assess the result

- Apply size and time limits before reading a message.
- Use Rust and Node transport implementations.

A passing source-level check establishes only what that check observes. Keep missing configuration, unavailable services and unverified deployment paths visible.

## Continue reading

[Repository overview](../README.md)
