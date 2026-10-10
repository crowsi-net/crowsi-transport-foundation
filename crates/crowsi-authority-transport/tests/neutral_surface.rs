#[test]
fn transport_owns_no_identity_credential_provider_or_custody_semantics() {
    let source = concat!(
        include_str!("../src/client.rs"),
        include_str!("../src/contract.rs"),
        include_str!("../src/crypto.rs"),
        include_str!("../src/server.rs"),
        include_str!("../src/tls.rs"),
    );
    for forbidden in [
        "CredentialAuthority",
        "FileAuthorityStore",
        "FreshUvV1",
        "CurrentDeviceStatusV1",
        "provider_evidence",
        "custody_operation",
        "account_ref",
    ] {
        assert!(!source.contains(forbidden), "semantic leak: {forbidden}");
    }
}

#[test]
fn secret_credentials_are_not_debuggable_or_cloneable() {
    let client = include_str!("../src/client.rs");
    let server = include_str!("../src/server.rs");
    for source in [client, server] {
        assert!(!source.contains("derive(Clone"));
        assert!(!source.contains("derive(Debug"));
    }
    assert!(client.contains("Zeroizing<Vec<u8>>"));
    assert!(server.contains("Zeroizing<Vec<u8>>"));
}
