# Security policy

## Boundary

This package must remain unprivileged and read-only. A probe must not open raw
sockets, capture packets, change routes or firewall rules, resolve credential
references, or make outbound requests unless a future separately reviewed
adapter explicitly declares that behavior.

Observation output must not contain packet bodies, IP addresses, hostnames,
tokens, cookies, authorization headers, process environments, or raw operating
system errors. Interface labels are the only host metadata emitted by the
bundled system probe. Its source is fixed to `/proc/net/dev`; arbitrary files,
FIFOs, and caller-selected paths are outside the public API. Output models have
private fields and can be created only through validated construction,
validated deserialization, or `collect`. Labels reject control characters,
direction marks, bidi overrides, and bidi isolate controls before reaching UI.

## Reporting

Do not include live network data or credentials in a report. Describe the
affected schema version, probe implementation, and a minimal synthetic
reproduction.

## Review requirements

Changes that add a probe must include deterministic tests, document its I/O,
bound all input, and demonstrate that `external_actions` remains `false`.

## Private vulnerability reporting

Report vulnerabilities through this repository's GitHub private vulnerability reporting form. Do not put credentials, personal or customer data, or production certificate material in public issues or pull requests.
