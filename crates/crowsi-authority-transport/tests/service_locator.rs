use crowsi_authority_transport::{
    SERVICE_LOCATOR_SCHEMA, ServiceLocatorV1, service_locator_signing_bytes,
    verify_service_locator_at,
};
use ed25519_dalek::{Signer, SigningKey};

const DIGEST: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn locator() -> ServiceLocatorV1 {
    ServiceLocatorV1 {
        schema: SERVICE_LOCATOR_SCHEMA.into(),
        locator_id: "source-curator-tokyo-1".into(),
        route_ref: "crowsi/route/source-curator-tokyo".into(),
        transport_profile_ref: "crowsi/mtls-authority-v1".into(),
        service_identity_ref: "ihat/service/source-curator-tokyo".into(),
        address: "203.0.113.20:443".into(),
        server_name: "worker.example.test".into(),
        audience: "hathq-hat-federation".into(),
        server_certificate_sha256: DIGEST.into(),
        revision: 2,
        issued_at_epoch_s: 1_000,
        expires_at_epoch_s: 1_300,
        key_id: "locator-root-1".into(),
        signature: String::new(),
    }
}

fn signed() -> (ServiceLocatorV1, String) {
    let key = SigningKey::from_bytes(&[4; 32]);
    let mut value = locator();
    value.signature = hex::encode(
        key.sign(&service_locator_signing_bytes(&value).expect("signing bytes"))
            .to_bytes(),
    );
    (value, hex::encode(key.verifying_key().to_bytes()))
}

#[test]
fn signed_locator_is_exact_fresh_and_transport_only() {
    let (value, public) = signed();
    let verified = verify_service_locator_at(&value, "locator-root-1", &public, 1_100)
        .expect("verified locator");
    assert_eq!(verified.route_ref(), "crowsi/route/source-curator-tokyo");
    assert!(verify_service_locator_at(&value, "locator-root-1", &public, 1_300).is_err());
}

#[test]
fn address_scheme_route_and_signature_substitution_fail_closed() {
    for mutate in [
        |value: &mut ServiceLocatorV1| value.address = "https://worker.example".into(),
        |value: &mut ServiceLocatorV1| value.route_ref = "https://route.example".into(),
        |value: &mut ServiceLocatorV1| value.audience = "other".into(),
    ] {
        let (mut value, public) = signed();
        mutate(&mut value);
        assert!(verify_service_locator_at(&value, "locator-root-1", &public, 1_100).is_err());
    }
}

#[test]
fn locator_wire_rejects_credentials_and_unknown_fields() {
    let (value, _) = signed();
    let mut json = serde_json::to_value(value).expect("locator JSON");
    json["bearer_token"] = serde_json::json!("secret");
    assert!(serde_json::from_value::<ServiceLocatorV1>(json).is_err());
}
