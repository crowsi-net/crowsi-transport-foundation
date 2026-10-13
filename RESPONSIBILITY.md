# Responsibility and source completion

This repository owns bounded request/response transport and transport-level contracts. Rust and npm packages retain their explicitly exported interfaces; provider endpoint catalogs, product persistence, cloud IAM administration and billing interpretation belong to their respective owners.

`@crowsi/provider-http-transport` bounds HTTPS origins, methods, payload size, response size, redirects and waiting. Its Node local-control composition binds an account, reviewed operation and exact request to a single-use, expiring grant and a credential source supplied by the trusted administrator.

## Completion criteria

- Public exports, supported runtimes and body/response limitations are documented per package.
- Unreviewed destinations, requests, replay, expired grants and unsupported response forms fail closed.
- Revocation covers credential acquisition and in-flight requests. Dispatch failures never imply that a remote write was rolled back; uncertain writes require read-back.
- Operation/origin declarations are immutable snapshots. Permission names declare requirements, not observed or effective provider authorization.
- Secrets and provider error bodies are absent from local-control receipts/errors. Low-level transport error causes remain trusted-host-only.
- Tests cover bounded failures and isolated consumer read/write/read-back; package checks validate formatting, types and physical line limits.
- Distribution verifies the packed public interface and official dependencies; no sibling checkout or private registry is required.

This library does not enforce OS process, filesystem or network isolation against hostile host code. Native execution/custody belongs to the managed Crowsi security repositories. Tests establish the synthetic source contract, not compatibility with a live account or permission to modify customer resources.

See each package README, `SECURITY.md`, `LICENSE` and `NOTICE` for usage, reporting and attribution. New implementation bytes require a new reviewed package release; the currently documented registry version is not silently overwritten by source changes.
