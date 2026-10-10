mod accept;
mod create;
mod deadline;
mod handler;
mod peer_config;
mod peer_gate;
mod peer_status;
mod serve;

use crate::{PeerBinding, SignedRequest, TransportError};
use ed25519_dalek::SigningKey;
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

pub use peer_status::{PeerStatusGuard, PeerStatusIdentity};

pub trait Clock: Send + Sync {
    /// Returns trusted wall-clock seconds.
    ///
    /// # Errors
    /// Returns an error when trusted time is unavailable.
    fn now_epoch_s(&self) -> Result<u64, TransportError>;
}
pub struct SystemClock;
impl Clock for SystemClock {
    fn now_epoch_s(&self) -> Result<u64, TransportError> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .map_err(|_| TransportError::Unavailable)
    }
}

pub trait AuthorityBackend: Send + Sync {
    /// Handles one authenticated opaque request without transport-layer semantics.
    ///
    /// # Errors
    /// Returns a closed transport error if the backend cannot produce a bounded response.
    fn handle(&self, request: &SignedRequest) -> Result<Vec<u8>, TransportError>;
}
pub trait ReplayGuard: Send + Sync {
    /// Atomically consumes one device-scoped request nonce and digest.
    ///
    /// # Errors
    /// Rejects replay or unavailable durable replay state.
    fn consume(&self, device: &str, nonce: &str, digest: &str) -> Result<(), TransportError>;
}

pub struct ServerCredential {
    pub certificate_der: Vec<u8>,
    pub private_key_der: Zeroizing<Vec<u8>>,
    pub client_trust_anchors_der: Vec<Vec<u8>>,
    pub response_key_id: String,
    pub response_signing_key: SigningKey,
}
pub struct AuthorityServer<B: AuthorityBackend, R: ReplayGuard> {
    audience: String,
    authority_epoch: u64,
    peers: Vec<(PeerBinding, Vec<u8>)>,
    backend: B,
    replay: R,
    credential: ServerCredential,
    tls: Arc<rustls::ServerConfig>,
    timeout: Duration,
    clock: Arc<dyn Clock>,
    peer_gate: peer_gate::PeerGate,
    peer_status: Arc<dyn PeerStatusGuard>,
}
