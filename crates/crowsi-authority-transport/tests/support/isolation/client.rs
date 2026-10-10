use super::Topology;
use crate::support::{pki::Certificate, server_certificate_sha256};
use crowsi_authority_transport::{AuthorityClient, ClientCredential};
use ed25519_dalek::SigningKey;
use std::time::Duration;

impl Topology {
    pub fn client_a(&self, address: &str) -> AuthorityClient {
        self.client(
            address,
            "device-a",
            &self.client_a,
            self.request_a.clone(),
            "request-a",
        )
    }

    pub fn client_a_with_key(&self, address: &str, key: SigningKey) -> AuthorityClient {
        self.client(address, "device-a", &self.client_a, key, "request-a")
    }

    pub fn client_b(&self, address: &str) -> AuthorityClient {
        self.client(
            address,
            "device-b",
            &self.client_b,
            self.request_b.clone(),
            "request-b",
        )
    }

    fn client(
        &self,
        address: &str,
        device: &str,
        certificate: &Certificate,
        key: SigningKey,
        key_id: &str,
    ) -> AuthorityClient {
        AuthorityClient::new(
            address,
            "authority.test",
            "crowsi://authority",
            device,
            "response-isolation",
            hex::encode(self.response.verifying_key().to_bytes()),
            ClientCredential {
                certificate_der: certificate.cert.clone(),
                private_key_der: certificate.key.clone().into(),
                server_trust_anchor_der: self.ca.cert.clone(),
                expected_server_certificate_sha256: server_certificate_sha256(&self.server),
                request_key_id: key_id.into(),
                request_signing_key: key,
            },
            Duration::from_secs(2),
        )
        .expect("client")
    }
}
