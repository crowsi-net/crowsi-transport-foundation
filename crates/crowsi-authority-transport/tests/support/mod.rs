mod isolation;
mod pki;
mod status;

pub use isolation::{SlowProvider, Topology};
pub use pki::{authority, certificate, now, peer, root, server_certificate_sha256};
pub use status::{DurableStatusGuard, StatusValue, write_status_token};

use crowsi_authority_transport::{
    AuthorityBackend, PeerStatusGuard, PeerStatusIdentity, ReplayGuard, SignedRequest,
    TransportError,
};
use std::{collections::BTreeSet, sync::Mutex};

pub struct Echo;

impl AuthorityBackend for Echo {
    fn handle(&self, request: &SignedRequest) -> Result<Vec<u8>, TransportError> {
        Ok([request.peer.device_id.as_bytes(), b":", &request.payload].concat())
    }
}

pub struct Replay(pub Mutex<BTreeSet<String>>);

pub struct TestPeerStatus;

impl PeerStatusGuard for TestPeerStatus {
    fn authorize_current(&self, _: PeerStatusIdentity<'_>, _: u64) -> Result<(), TransportError> {
        Ok(())
    }
}

impl ReplayGuard for Replay {
    fn consume(&self, device: &str, nonce: &str, _: &str) -> Result<(), TransportError> {
        if self
            .0
            .lock()
            .map_err(|_| TransportError::Unavailable)?
            .insert(format!("{device}:{nonce}"))
        {
            Ok(())
        } else {
            Err(TransportError::Replay)
        }
    }
}
