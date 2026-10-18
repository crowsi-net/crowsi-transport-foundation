use crate::{Error, HttpsRead, client, tls_support::Server};
use std::time::Duration;
fn trusted(server: &Server) -> HttpsRead {
    let client = client::builder()
        .add_root_certificate(reqwest::Certificate::from_pem(&server.ca).unwrap())
        .build()
        .unwrap();
    HttpsRead::create(
        &server.origin,
        "synthetic-only",
        Duration::from_secs(5),
        1,
        client,
    )
    .unwrap()
}
#[test]
fn real_https_read_uses_explicit_trust_and_preserves_wire_bytes() {
    let server = Server::start(200, "{\"value\":1}", None);
    let mut client = trusted(&server);
    assert_eq!(
        &*client
            .get(&format!("{}/inspect", server.origin), &[], 1024)
            .unwrap(),
        b"{\"value\":1}"
    );
    assert_eq!(
        client.get(&format!("{}/inspect", server.origin), &[], 1024),
        Err(Error::Budget)
    );
    server.join();
}
#[test]
fn redirects_and_remote_error_bodies_are_not_followed_or_exposed() {
    for status in [302, 401, 403, 429, 503] {
        let server = Server::start(
            status,
            "synthetic-private-error",
            Some("https://example.invalid/never-contact"),
        );
        let mut client = trusted(&server);
        assert_eq!(
            client.get(&format!("{}/inspect", server.origin), &[], 1024),
            Err(Error::Status(status))
        );
        server.join();
    }
}
#[test]
fn untrusted_tls_and_oversized_response_fail_closed() {
    let server = Server::start(200, "{}", None);
    let mut client =
        HttpsRead::new(&server.origin, "synthetic-only", Duration::from_secs(5), 1).unwrap();
    assert_eq!(
        client.get(&format!("{}/inspect", server.origin), &[], 1024),
        Err(Error::Transport)
    );
    server.join();
    let server = Server::start(200, "1234567890", None);
    assert_eq!(
        trusted(&server).get(&format!("{}/inspect", server.origin), &[], 4),
        Err(Error::BodyLimit)
    );
    server.join();
}
