# Owner registration and a restricted worker port

Create local-control and review the exact plan in the trusted owner. Approve it, then call `owner.register(plan, permit)` on `createExecutePort(control)`. Registration snapshots the plan and binds the opaque one-use grant to its digest. Give the generated worker only the serialized `{ grantId, requestDigest }` request and the transport to `owner.handle`.

The handler accepts exactly those two string fields. It cannot approve a different operation, inject a credential, change account/URL/body or register a plan. It removes the permit before execution; local-control enforces the actual grant, account, request digest, expiry and revocation. Owner revocation also cancels in-flight local-control waiting. An indeterminate write still requires provider read-back before another grant/retry.

The owner chooses the clock and transport, bounds raw IPC bytes before JSON decoding and exposes only handle. Never transfer the full returned owner object, control, dynamic callback catalog or credential source into generated code. This JavaScript adapter does not isolate a process. Use the managed `crowsi-network-sandbox::isolated_workload` and `crowsi-process-adapter` boundary for an untrusted worker; their acceptance is separate from this port's interface tests.

The repository playground `playground/execute-port/demo.mjs` performs a synthetic write/read-back and rejects injected approval and replay. `.github/scripts/provider-consumer.mjs` installs the packed candidate outside the checkout and runs that public import example with strict type checks. Unit tests additionally reject account/credential fields, digest substitution, duplicate registration and revocation. No live credentials or network are used.

This is new source API pending a reviewed new package release. The published 0.11.2 artifact is immutable and does not contain this entrypoint.
