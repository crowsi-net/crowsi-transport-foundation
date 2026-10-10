use crate::support::{Echo, Replay, TestPeerStatus, authority, certificate, peer, root};
use crowsi_authority_transport::{AuthorityServer, ServerCredential, SystemClock, TransportError};
use ed25519_dalek::SigningKey;
use std::{collections::BTreeSet, fs, sync::Mutex, time::Duration};

#[test]
fn duplicate_request_key_id_is_rejected() {
    assert_alias_rejected(Alias::KeyId);
}

#[test]
fn duplicate_request_public_key_is_rejected() {
    assert_alias_rejected(Alias::PublicKey);
}

#[derive(Clone, Copy)]
enum Alias {
    KeyId,
    PublicKey,
}

fn assert_alias_rejected(alias: Alias) {
    let directory = root();
    let ca = authority(&directory);
    let server = certificate(&directory, "authority", Some("authority.test"));
    let client_a = certificate(&directory, "device-a", None);
    let client_b = certificate(&directory, "device-b", None);
    let key_a = SigningKey::from_bytes(&[51; 32]);
    let key_b = SigningKey::from_bytes(&[52; 32]);
    let mut peers = vec![
        peer("device-a", &client_a, &key_a, "request-a"),
        peer("device-b", &client_b, &key_b, "request-b"),
    ];
    let request_key_id = peers[0].0.request_key_id.clone();
    let request_public_key = peers[0].0.request_public_key_hex.clone();
    match alias {
        Alias::KeyId => peers[1].0.request_key_id = request_key_id,
        Alias::PublicKey => peers[1]
            .0
            .request_public_key_hex
            .clone_from(&request_public_key),
    }
    let result = AuthorityServer::new_with_peer_status(
        "crowsi://authority",
        1,
        ServerCredential {
            certificate_der: server.cert.clone(),
            private_key_der: server.key.clone().into(),
            client_trust_anchors_der: vec![ca.cert],
            response_key_id: "response".into(),
            response_signing_key: SigningKey::from_bytes(&[53; 32]),
        },
        peers,
        TestPeerStatus,
        Echo,
        Replay(Mutex::new(BTreeSet::new())),
        Duration::from_secs(1),
        SystemClock,
    );
    assert!(matches!(result, Err(TransportError::Config)));
    fs::remove_dir_all(directory).expect("cleanup");
}
