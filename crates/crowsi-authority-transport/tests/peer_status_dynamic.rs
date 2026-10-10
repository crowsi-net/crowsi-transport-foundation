use crate::support::{
    DurableStatusGuard, Echo, StatusValue, Topology, now, root, write_status_token,
};
use ed25519_dalek::SigningKey;
use std::{fs, thread, time::Duration};

#[test]
fn revoked_a_is_denied_immediately_b_survives_and_restart_does_not_resurrect_a() {
    let topology = Topology::new();
    let status_root = root();
    let path = status_root.join("current-status-v1");
    let authority = SigningKey::from_bytes(&[61; 32]);
    let (peer_a, peer_b) = topology.peer_bindings();
    write_status_token(
        &path,
        &authority,
        1,
        &[
            (&peer_a, StatusValue::Active),
            (&peer_b, StatusValue::Active),
        ],
    );
    let guard = DurableStatusGuard::open(&path, authority.verifying_key());
    let (listener, address) = Topology::listener();
    let server = topology.server_with_status(Echo, guard.clone(), Duration::from_secs(2));
    let task = thread::spawn(move || server.serve_n(&listener, 4));
    assert_eq!(
        topology
            .client_a(&address)
            .exchange("snapshot", b"A", &"a".repeat(64), now()),
        Ok(b"device-a:A".to_vec())
    );
    assert_eq!(
        topology
            .client_b(&address)
            .exchange("snapshot", b"B", &"b".repeat(64), now()),
        Ok(b"device-b:B".to_vec())
    );
    write_status_token(
        &path,
        &authority,
        1,
        &[
            (&peer_a, StatusValue::Revoked),
            (&peer_b, StatusValue::Active),
        ],
    );
    assert!(
        topology
            .client_a(&address)
            .exchange("snapshot", b"A2", &"c".repeat(64), now())
            .is_err()
    );
    assert_eq!(
        topology
            .client_b(&address)
            .exchange("snapshot", b"B2", &"d".repeat(64), now()),
        Ok(b"device-b:B2".to_vec())
    );
    assert!(task.join().expect("server task").is_err());
    let checks = guard.observed();
    assert_eq!(checks[4].device_id, peer_a.device_id);
    assert_eq!(
        checks[4].client_certificate_sha256,
        peer_a.certificate_sha256
    );
    assert_eq!(checks[4].request_key_id, peer_a.request_key_id);
    assert_eq!(checks[4].authority_epoch, 1);

    let restarted = DurableStatusGuard::open(&path, authority.verifying_key());
    let (listener, address) = Topology::listener();
    let server = topology.server_with_status(Echo, restarted, Duration::from_secs(2));
    let task = thread::spawn(move || server.serve_n(&listener, 2));
    assert!(
        topology
            .client_a(&address)
            .exchange("snapshot", b"A3", &"e".repeat(64), now())
            .is_err()
    );
    assert_eq!(
        topology
            .client_b(&address)
            .exchange("snapshot", b"B3", &"f".repeat(64), now()),
        Ok(b"device-b:B3".to_vec())
    );
    assert!(task.join().expect("restarted server").is_err());
    fs::remove_dir_all(status_root).expect("status cleanup");
}
