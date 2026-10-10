# @crowsi/interaction-transport

Carry bounded UI interaction messages between a caller and an application handler.

## What you can do

- Validate transport framing and cancellation.
- Keep opaque interaction payloads within declared limits.

## Current scope

The host supplies application routing and authority. Transport does not interpret the business operation.

Package distribution is not activated by this documentation. Use the owning product workspace and declared dependency versions. Registry availability is a separate release gate.

## Getting started

Use the package manager matching the checked-in lockfile and the Node.js version declared in `engines` in `package.json`. Run from this repository:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

## Documentation and source

[Usage guide](docs/getting-started.md)

[Implementation and public interfaces](src) · [Verification cases](test) · [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [License](LICENSE) · [Attribution notices](NOTICE)

## Product responsibility

This component is maintained in [crowsi-net/crowsi-transport-foundation](https://github.com/crowsi-net/crowsi-transport-foundation). Use the [product README](../../README.md) for composition, use cases and trust boundaries.

## Typed interfaces

Author runtime code in `src/*.mts` and share contracts through `src/types/`.
The build emits executable ESM and declarations into `dist/`; npm exports resolve
both from the same build. Payloads use `unknown` because validation and authority
belong to the host application. Generated JavaScript is not hand-maintained.
