use super::{
    AuthorityBackend, AuthorityServer, Clock, PeerStatusGuard, ReplayGuard, ServerCredential,
    peer_config, peer_gate,
};
use crate::{PeerBinding, TransportError, validation};
use std::{sync::Arc, time::Duration};

impl<B: AuthorityBackend, R: ReplayGuard> AuthorityServer<B, R> {
    /// Creates a server with mandatory current peer-status authorization.
    ///
    /// # Errors
    /// Rejects invalid configuration, duplicate peers, keys, or TLS credentials.
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_peer_status(
        audience: impl Into<String>,
        authority_epoch: u64,
        credential: ServerCredential,
        peers: Vec<(PeerBinding, Vec<u8>)>,
        peer_status: impl PeerStatusGuard + 'static,
        backend: B,
        replay: R,
        timeout: Duration,
        clock: impl Clock + 'static,
    ) -> Result<Self, TransportError> {
        let audience = audience.into();
        if authority_epoch == 0
            || peers.is_empty()
            || timeout.is_zero()
            || timeout > Duration::from_secs(30)
            || !validation::text(&audience, 256)
            || !peer_config::valid(&peers)
        {
            return Err(TransportError::Config);
        }
        let tls = crate::tls::server(
            &credential.certificate_der,
            &credential.private_key_der,
            &credential.client_trust_anchors_der,
        )?;
        Ok(Self {
            audience,
            authority_epoch,
            peers,
            backend,
            replay,
            credential,
            tls,
            timeout,
            clock: Arc::new(clock),
            peer_gate: peer_gate::PeerGate::new(),
            peer_status: Arc::new(peer_status),
        })
    }

    /// Fail-closed source-compatibility cut set for pre-status callers.
    ///
    /// This constructor never starts an unguarded server. Migrate to
    /// [`Self::new_with_peer_status`] with a durable production guard.
    ///
    /// # Errors
    /// Always returns [`TransportError::Config`].
    #[deprecated(
        since = "0.1.0",
        note = "fail-closed migration cut set; use new_with_peer_status"
    )]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        audience: impl Into<String>,
        authority_epoch: u64,
        credential: ServerCredential,
        peers: Vec<(PeerBinding, Vec<u8>)>,
        backend: B,
        replay: R,
        timeout: Duration,
        clock: impl Clock + 'static,
    ) -> Result<Self, TransportError> {
        drop((
            audience.into(),
            authority_epoch,
            credential,
            peers,
            backend,
            replay,
            timeout,
            clock,
        ));
        Err(TransportError::Config)
    }
}
