# Gateway status and concurrency migration

All gateways must replace `AuthorityServer::new` with
`AuthorityServer::new_with_peer_status`. The old constructor remains only as a
source-compatible fail-closed cut set: it always returns `Config` and never
opens an unguarded production path.

The injected guard receives only the exact configured `(device_id,
client_certificate_sha256, request_key_id)` resolved after mTLS plus the
configured authority epoch. On every connection it atomically loads and
authenticates the current durable authority status token, verifies every
binding and the epoch, and permits only current active status. No request field
or endpoint payload supplies that token. Missing, stale, malformed, denied, or
unavailable status returns `Peer` or `Unavailable` and closes the connection.
Adapters must not cache authorization across calls. Restart opens the same
durable current state and therefore cannot revive a denied peer.

Long-lived credential gateways must replace `serve_n(listener, 1)` loops with
`serve_until(listener, maximum_concurrent_connections, shutdown)`. The signed
gateway configuration owns the capacity, and the service supervisor owns the
finite shutdown flag. A connection error is isolated; listener/configuration
errors still return from the server. Multi-peer gateways must configure at
least two concurrent connections.

Finite iHAT authority gateways should replace `serve_n(listener,
maximum_connections)` with `serve_batch(listener, maximum_connections,
maximum_concurrent_connections)`. The first value remains the signed lifetime
batch size and the second is a separate signed worker bound. Existing
`serve_n` callers remain source-compatible while their configuration schema is
migrated.

Both routes set read and write timeouts before the TLS handshake. After exact
leaf mapping, the per-peer permit bounds frame reads; the current-status guard
then runs after full request-signature verification and immediately before
replay consumption and backend invocation. Shutdown stops new accepts, waits
for bounded in-flight workers, and returns without detached tasks. Replay
consumption remains scoped by the configured peer device ID. Each peer may hold
at most one post-handshake request permit; an excess connection fails before
its request nonce is consumed. Request key IDs and public keys must also be
unique across all configured peers.
