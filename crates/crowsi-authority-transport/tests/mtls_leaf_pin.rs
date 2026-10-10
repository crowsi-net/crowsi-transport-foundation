use crate::support::{
    Echo, Replay, TestPeerStatus, authority, certificate, now, peer, root,
    server_certificate_sha256,
};
use crowsi_authority_transport::{
    AuthorityClient, AuthorityServer, ClientCredential, ServerCredential, SystemClock,
    TransportError,
};
use ed25519_dalek::SigningKey;
use std::{collections::BTreeSet, fs, net::TcpListener, sync::Mutex, thread, time::Duration};

#[test]
fn same_ca_server_with_different_leaf_is_rejected_before_request() {
    let root = root();
    let ca = authority(&root);
    let server_cert = certificate(&root, "authority", Some("authority.test"));
    let other_cert = certificate(&root, "other-authority", Some("authority.test"));
    let client_cert = certificate(&root, "device-a", None);
    let response = SigningKey::from_bytes(&[9; 32]);
    let request = SigningKey::from_bytes(&[7; 32]);
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let address = listener.local_addr().expect("address").to_string();
    let server = AuthorityServer::new_with_peer_status(
        "crowsi://authority",
        1,
        ServerCredential {
            certificate_der: server_cert.cert.clone(),
            private_key_der: server_cert.key.clone().into(),
            client_trust_anchors_der: vec![ca.cert.clone()],
            response_key_id: "response-1".into(),
            response_signing_key: response.clone(),
        },
        vec![peer("device-a", &client_cert, &request, "request-a")],
        TestPeerStatus,
        Echo,
        Replay(Mutex::new(BTreeSet::new())),
        Duration::from_secs(3),
        SystemClock,
    )
    .expect("server");
    let task = thread::spawn(move || server.serve_n(&listener, 1));
    let client = AuthorityClient::new(
        &address,
        "authority.test",
        "crowsi://authority",
        "device-a",
        "response-1",
        hex::encode(response.verifying_key().to_bytes()),
        ClientCredential {
            certificate_der: client_cert.cert.clone(),
            private_key_der: client_cert.key.clone().into(),
            server_trust_anchor_der: ca.cert.clone(),
            expected_server_certificate_sha256: server_certificate_sha256(&other_cert),
            request_key_id: "request-a".into(),
            request_signing_key: request,
        },
        Duration::from_secs(3),
    )
    .expect("client");
    assert_eq!(
        client.exchange("snapshot", b"metadata", &"a".repeat(64), now()),
        Err(TransportError::Peer)
    );
    assert!(task.join().expect("server thread").is_err());
    fs::remove_dir_all(root).expect("cleanup");
}
