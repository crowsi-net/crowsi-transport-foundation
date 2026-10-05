# @crowsi/transport-foundation

[日本語](README.ja.md)

Exchange bounded messages between local processes without building framing and timeout handling again.

## What you can do

- Apply size and time limits before reading a message.
- Use Rust and Node transport implementations.

## Current scope

The caller owns authentication, authorization and message meaning.

Package distribution is not activated by this documentation. Use the checked-in source and the declared dependency versions; published availability must be verified separately.

## Getting started

Install Rust 1.97.0 or newer and make the declared dependencies available. Use the configured private registry when a dependency is not distributed publicly. Run from this repository:

```sh
npm install
npm run test
```

## Documentation and source

[Usage guide](https://github.com/crowsi-net/crowsi-transport-foundation/blob/main/docs/getting-started.md)

[Implementation and public interfaces](https://github.com/crowsi-net/crowsi-transport-foundation/tree/main/src) · [Verification cases](https://github.com/crowsi-net/crowsi-transport-foundation/tree/main/tests) · [Verification cases](https://github.com/crowsi-net/crowsi-transport-foundation/tree/main/test) · [Contributing](https://github.com/crowsi-net/crowsi-transport-foundation/blob/main/CONTRIBUTING.md) · [Security reporting](https://github.com/crowsi-net/crowsi-transport-foundation/blob/main/SECURITY.md) · [License](LICENSE) · [Attribution notices](NOTICE)
