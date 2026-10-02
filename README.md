# @crowsi/transport-foundation

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

[Usage guide](docs/getting-started.md)

[Implementation and public interfaces](src) · [Verification cases](tests) · [Verification cases](test) · [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [License](LICENSE) · [Attribution notices](NOTICE)
