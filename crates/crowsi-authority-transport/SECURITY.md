# Security boundary

The authority node and its TLS/signing keys are a separate trusted computing
base. A managed endpoint must receive only its own client certificate and
request key plus pinned public authority material. It must never receive the
authority store, server private key, peer inventory, or another endpoint key.

Mutual TLS is necessary but not sufficient. The client pins the exact server
leaf digest before transmitting any frame. The server verifies the client chain
and then requires an exact leaf-digest/device/request-key mapping. Signed
envelopes additionally bind audience, device, command, nonce, expiry, and the
opaque payload. A durable device-scoped replay guard is mandatory in production.

After the exact leaf mapping, the server verifies the entire signed request and
then invokes `PeerStatusGuard` immediately before replay consumption and the
backend, and once more before returning a response. This closes connection-stall
and in-flight read-response races with a concurrent revocation. The
durable current token is bound to the authority epoch, device ID, client leaf
digest, and request key ID; it is never accepted from the request. A guard may
override the request-aware method only for a narrowly verified, durable
recovery request. All other denied, unknown, stale, malformed, or unavailable
status fails closed. Status of one peer cannot gate a different exact tuple.

Private-key DER inputs are held in `Zeroizing<Vec<u8>>` and credential structs
do not implement `Debug` or `Clone`. Application payloads must remain bounded,
metadata-only authority contracts; this crate intentionally has no API for raw
credentials, account identifiers, provider secrets, or custody retrieval.

Co-locating an authority backend and its store on a managed endpoint violates
the deployment boundary: compromise of that endpoint would become authority
compromise. Product installers must keep central and endpoint roles, trust
roots, release stores, and service identities separate.

## Private vulnerability reporting

Report vulnerabilities through this repository's GitHub private vulnerability reporting form. Do not put credentials, personal or customer data, or production certificate material in public issues or pull requests.
