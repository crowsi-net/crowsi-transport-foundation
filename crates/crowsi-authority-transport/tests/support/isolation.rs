mod client;

use super::{Replay, TestPeerStatus, authority, certificate, peer, pki::Certificate, root};
use crowsi_authority_transport::{
    AuthorityBackend, AuthorityServer, PeerBinding, PeerStatusGuard, ServerCredential,
    SignedRequest, SystemClock, TransportError,
};
use ed25519_dalek::SigningKey;
use std::{
    collections::BTreeSet,
    fs,
    net::TcpListener,
    path::PathBuf,
    sync::{Mutex, mpsc::SyncSender},
    thread,
    time::Duration,
};

pub struct Topology {
    root: PathBuf,
    ca: Certificate,
    server: Certificate,
    client_a: Certificate,
    client_b: Certificate,
    response: SigningKey,
    request_a: SigningKey,
    request_b: SigningKey,
}

impl Topology {
    pub fn new() -> Self {
        let root = root();
        Self {
            ca: authority(&root),
            server: certificate(&root, "authority", Some("authority.test")),
            client_a: certificate(&root, "device-a", None),
            client_b: certificate(&root, "device-b", None),
            response: SigningKey::from_bytes(&[41; 32]),
            request_a: SigningKey::from_bytes(&[42; 32]),
            request_b: SigningKey::from_bytes(&[43; 32]),
            root,
        }
    }

    pub fn listener() -> (TcpListener, String) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let address = listener.local_addr().expect("address").to_string();
        (listener, address)
    }

    pub fn server<B: AuthorityBackend>(
        &self,
        backend: B,
        timeout: Duration,
    ) -> AuthorityServer<B, Replay> {
        self.server_with_status(backend, TestPeerStatus, timeout)
    }

    pub fn server_with_status<B: AuthorityBackend>(
        &self,
        backend: B,
        status: impl PeerStatusGuard + 'static,
        timeout: Duration,
    ) -> AuthorityServer<B, Replay> {
        AuthorityServer::new_with_peer_status(
            "crowsi://authority",
            1,
            ServerCredential {
                certificate_der: self.server.cert.clone(),
                private_key_der: self.server.key.clone().into(),
                client_trust_anchors_der: vec![self.ca.cert.clone()],
                response_key_id: "response-isolation".into(),
                response_signing_key: self.response.clone(),
            },
            vec![
                peer("device-a", &self.client_a, &self.request_a, "request-a"),
                peer("device-b", &self.client_b, &self.request_b, "request-b"),
            ],
            status,
            backend,
            Replay(Mutex::new(BTreeSet::new())),
            timeout,
            SystemClock,
        )
        .expect("server")
    }

    pub fn peer_bindings(&self) -> (PeerBinding, PeerBinding) {
        (
            peer("device-a", &self.client_a, &self.request_a, "request-a").0,
            peer("device-b", &self.client_b, &self.request_b, "request-b").0,
        )
    }
}

impl Drop for Topology {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).expect("cleanup");
    }
}

pub struct SlowProvider {
    entered: SyncSender<()>,
    delay: Duration,
}

impl SlowProvider {
    pub const fn new(entered: SyncSender<()>, delay: Duration) -> Self {
        Self { entered, delay }
    }
}

impl AuthorityBackend for SlowProvider {
    fn handle(&self, request: &SignedRequest) -> Result<Vec<u8>, TransportError> {
        if request.peer.device_id == "device-a" && request.command == "provider-operation" {
            self.entered
                .send(())
                .map_err(|_| TransportError::Unavailable)?;
            thread::sleep(self.delay);
        }
        Ok([request.peer.device_id.as_bytes(), b":", &request.payload].concat())
    }
}
