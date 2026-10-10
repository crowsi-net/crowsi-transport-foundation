use crate::{SignedRequest, TransportError};

/// The exact transport identity resolved from a configured mTLS leaf mapping.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PeerStatusIdentity<'a> {
    pub device_id: &'a str,
    pub client_certificate_sha256: &'a str,
    pub request_key_id: &'a str,
}

/// Authorizes one resolved peer against current authority status.
///
/// Implementations must atomically load and validate a durable,
/// authority-provided status token for every call. The token must be authentic,
/// current for `authority_epoch`, active, and bound to every field in `peer`.
/// Missing, stale, malformed, unavailable, or denied state must return an error.
/// A positive result must not survive a status update or process restart.
pub trait PeerStatusGuard: Send + Sync {
    /// Checks one exact mTLS peer against current status.
    ///
    /// # Errors
    /// Returns [`TransportError::Peer`] for a denied or unknown peer and
    /// [`TransportError::Unavailable`] when current status cannot be trusted.
    fn authorize_current(
        &self,
        peer: PeerStatusIdentity<'_>,
        authority_epoch: u64,
    ) -> Result<(), TransportError>;

    /// Rechecks status after signature verification, immediately before replay
    /// consumption/backend invocation, and again before emitting the response.
    ///
    /// Implementations may override this only to admit a narrowly verified,
    /// durable recovery request for a peer that is no longer current.
    ///
    /// # Errors
    /// Returns [`TransportError::Peer`] for a denied request and
    /// [`TransportError::Unavailable`] when its current status cannot be trusted.
    fn authorize_request(
        &self,
        peer: PeerStatusIdentity<'_>,
        authority_epoch: u64,
        request: &SignedRequest,
    ) -> Result<(), TransportError> {
        let _ = request;
        self.authorize_current(peer, authority_epoch)
    }
}
