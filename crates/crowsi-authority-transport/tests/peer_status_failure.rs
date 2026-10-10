use crate::support::{DurableStatusGuard, StatusValue, Topology, now, root, write_status_token};
use crowsi_authority_transport::{AuthorityBackend, SignedRequest, TransportError};
use ed25519_dalek::SigningKey;
use std::{
    fs,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

#[derive(Clone)]
struct CountingBackend(Arc<AtomicUsize>);

impl AuthorityBackend for CountingBackend {
    fn handle(&self, request: &SignedRequest) -> Result<Vec<u8>, TransportError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(request.payload.clone())
    }
}

#[test]
fn tampered_or_unavailable_status_fails_before_replay_and_backend() {
    let topology = Topology::new();
    let status_root = root();
    let path = status_root.join("current-status-v1");
    let authority = SigningKey::from_bytes(&[62; 32]);
    let (peer_a, peer_b) = topology.peer_bindings();
    write_status_token(&path, &authority, 2, &[(&peer_a, StatusValue::Active)]);
    let calls = Arc::new(AtomicUsize::new(0));
    let guard = DurableStatusGuard::open(&path, authority.verifying_key());
    let (listener, address) = Topology::listener();
    let server = topology.server_with_status(
        CountingBackend(Arc::clone(&calls)),
        guard,
        Duration::from_secs(2),
    );
    let task = thread::spawn(move || server.serve_n(&listener, 5));
    let nonce = "1".repeat(64);
    assert!(
        topology
            .client_a(&address)
            .exchange("snapshot", b"A", &nonce, now())
            .is_err()
    );
    let mut rebound_a = peer_a.clone();
    rebound_a.request_key_id.clone_from(&peer_b.request_key_id);
    write_status_token(&path, &authority, 1, &[(&rebound_a, StatusValue::Active)]);
    assert!(
        topology
            .client_a(&address)
            .exchange("snapshot", b"A", &nonce, now())
            .is_err()
    );
    write_status_token(&path, &authority, 1, &[(&peer_a, StatusValue::Revoked)]);
    let wire = fs::read_to_string(&path).expect("status token");
    fs::write(&path, wire.replace("revoked", "active")).expect("tamper token");
    assert!(
        topology
            .client_a(&address)
            .exchange("snapshot", b"A", &nonce, now())
            .is_err()
    );
    write_status_token(
        &path,
        &authority,
        1,
        &[
            (&peer_a, StatusValue::Active),
            (&peer_b, StatusValue::Active),
        ],
    );
    assert_eq!(
        topology
            .client_a(&address)
            .exchange("snapshot", b"A", &nonce, now()),
        Ok(b"A".to_vec())
    );
    fs::remove_file(&path).expect("remove token");
    assert!(
        topology
            .client_b(&address)
            .exchange("snapshot", b"B", &"2".repeat(64), now())
            .is_err()
    );
    assert!(task.join().expect("server task").is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(status_root).expect("status cleanup");
}
