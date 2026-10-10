use crate::support::{
    Echo, Replay, TestPeerStatus, authority, certificate, now, peer, root,
    server_certificate_sha256,
};
use crowsi_authority_transport::{
    AuthorityClient, AuthorityServer, ClientCredential, ServerCredential, SystemClock,
};
use ed25519_dalek::SigningKey;
use std::{collections::BTreeSet, fs, net::TcpListener, sync::Mutex, thread, time::Duration};

#[test]
// E2E-08: two isolated endpoints use one remote authority with exact mTLS peer binding.
fn e2e_08_two_isolated_endpoints_use_one_remote_mtls_authority() {
    let root = root();
    let ca = authority(&root);
    let server_cert = certificate(&root, "authority", Some("authority.test"));
    let client_a = certificate(&root, "device-a", None);
    let client_b = certificate(&root, "device-b", None);
    let response = SigningKey::from_bytes(&[9; 32]);
    let request_a = SigningKey::from_bytes(&[7; 32]);
    let request_b = SigningKey::from_bytes(&[8; 32]);
    let peers = vec![
        peer("device-a", &client_a, &request_a, "request-a"),
        peer("device-b", &client_b, &request_b, "request-b"),
    ];
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
        peers,
        TestPeerStatus,
        Echo,
        Replay(Mutex::new(BTreeSet::new())),
        Duration::from_secs(3),
        SystemClock,
    )
    .expect("server");
    let task = thread::spawn(move || server.serve_n(&listener, 2));
    for (device, certificate, key, key_id, nonce) in [
        (
            "device-a",
            &client_a,
            request_a,
            "request-a",
            "a".repeat(64),
        ),
        (
            "device-b",
            &client_b,
            request_b,
            "request-b",
            "a".repeat(64),
        ),
    ] {
        let client = AuthorityClient::new(
            &address,
            "authority.test",
            "crowsi://authority",
            device,
            "response-1",
            hex::encode(response.verifying_key().to_bytes()),
            ClientCredential {
                certificate_der: certificate.cert.clone(),
                private_key_der: certificate.key.clone().into(),
                server_trust_anchor_der: ca.cert.clone(),
                expected_server_certificate_sha256: server_certificate_sha256(&server_cert),
                request_key_id: key_id.into(),
                request_signing_key: key,
            },
            Duration::from_secs(3),
        )
        .expect("client");
        assert_eq!(
            client
                .exchange("snapshot", b"metadata", &nonce, now())
                .expect("exchange"),
            [device.as_bytes(), b":metadata"].concat()
        );
    }
    task.join().expect("server thread").expect("server result");
    fs::remove_dir_all(root).expect("cleanup");
}
