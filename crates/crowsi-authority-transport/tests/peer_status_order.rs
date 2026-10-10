use crate::support::{Echo, Replay, authority, certificate, peer, root};
use crowsi_authority_transport::{AuthorityServer, ServerCredential, SystemClock, TransportError};
use ed25519_dalek::SigningKey;
use std::{collections::BTreeSet, fs, sync::Mutex, time::Duration};

#[test]
fn peer_status_recheck_follows_signed_frame_and_precedes_replay_and_backend() {
    let handler = include_str!("../src/server/handler.rs");
    let quota = handler.find("peer_gate.enter").expect("peer quota");
    let frame = handler.find("read_frame").expect("frame read");
    let request = handler.find("self.request").expect("request verification");
    let backend = handler.find("backend.handle").expect("backend");
    let response_check = handler
        .find("self.authorize(&request)")
        .expect("response status recheck");
    assert!(quota < frame && frame < request && request < backend && backend < response_check);
    let request_body = &handler[handler.find("fn request").expect("request")..];
    let verified = request_body
        .find("crypto::verify")
        .expect("request signature");
    let replay = request_body.find(".consume(").expect("replay");
    let completed = request_body.find("Ok(request)").expect("verified request");
    let status = request_body
        .find("self.authorize(&request)")
        .expect("current status recheck");
    assert!(verified < status && status < replay && replay < completed);
}

#[test]
#[allow(deprecated)]
fn legacy_constructor_is_an_explicit_fail_closed_migration_cut_set() {
    let directory = root();
    let ca = authority(&directory);
    let server = certificate(&directory, "authority", Some("authority.test"));
    let client = certificate(&directory, "device-a", None);
    let request = SigningKey::from_bytes(&[71; 32]);
    let result = AuthorityServer::new(
        "crowsi://authority",
        1,
        ServerCredential {
            certificate_der: server.cert,
            private_key_der: server.key.into(),
            client_trust_anchors_der: vec![ca.cert],
            response_key_id: "response".into(),
            response_signing_key: SigningKey::from_bytes(&[72; 32]),
        },
        vec![peer("device-a", &client, &request, "request-a")],
        Echo,
        Replay(Mutex::new(BTreeSet::new())),
        Duration::from_secs(1),
        SystemClock,
    );
    assert!(matches!(result, Err(TransportError::Config)));
    fs::remove_dir_all(directory).expect("cleanup");
}

#[test]
fn clients_cannot_supply_peer_status_or_authority_status_tokens() {
    let contract = include_str!("../src/contract.rs");
    let client = include_str!("../src/client/exchange.rs");
    for forbidden in ["peer_status", "status_token", "status_epoch"] {
        assert!(
            !contract.contains(forbidden),
            "request contract leaked {forbidden}"
        );
        assert!(!client.contains(forbidden), "client supplied {forbidden}");
    }
}
