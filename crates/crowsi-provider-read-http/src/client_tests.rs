use super::*;
#[test]
fn credential_and_budget_validation_precedes_any_network_operation() {
    for token in ["", "bad\r\nvalue", "bad token"] {
        assert!(
            HttpsRead::new(
                "https://service.example.invalid",
                token,
                Duration::from_secs(1),
                1
            )
            .is_err()
        );
    }
    for requests in [0, 33] {
        assert!(
            HttpsRead::new(
                "https://service.example.invalid",
                "synthetic",
                Duration::from_secs(1),
                requests
            )
            .is_err()
        );
    }
    let mut client = HttpsRead::new(
        "https://service.example.invalid",
        "synthetic",
        Duration::from_secs(1),
        1,
    )
    .unwrap();
    assert_eq!(
        client.get("http://service.example.invalid/", &[], 1024),
        Err(Error::Target)
    );
    assert_eq!(
        client.get("https://other.example.invalid/", &[], 1024),
        Err(Error::Target)
    );
    assert_eq!(
        client.get("https://service.example.invalid/", &[], 0),
        Err(Error::Configuration)
    );
    client.remaining = 0;
    assert_eq!(
        client.get("https://service.example.invalid/", &[], 1024),
        Err(Error::Budget)
    );
}
