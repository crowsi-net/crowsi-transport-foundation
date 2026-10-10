mod exchange;

use ed25519_dalek::SigningKey;
use std::{sync::Arc, time::Duration};
use zeroize::Zeroizing;

use crate::{Clock, SystemClock, TransportError, validation};

pub struct ClientCredential {
    pub certificate_der: Vec<u8>,
    pub private_key_der: Zeroizing<Vec<u8>>,
    pub server_trust_anchor_der: Vec<u8>,
    pub expected_server_certificate_sha256: String,
    pub request_key_id: String,
    pub request_signing_key: SigningKey,
}

pub struct AuthorityClient {
    address: String,
    server_name: String,
    audience: String,
    device: String,
    response_key_id: String,
    response_public_key: String,
    server_certificate_sha256: String,
    timeout: Duration,
    tls: Arc<rustls::ClientConfig>,
    request_key_id: String,
    request_signing_key: SigningKey,
    clock: Arc<dyn Clock>,
}

impl AuthorityClient {
    /// Creates a client using the system clock for response freshness.
    ///
    /// # Errors
    /// Rejects invalid bounds, keys, pins, credentials, or TLS configuration.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        address: impl Into<String>,
        server_name: impl Into<String>,
        audience: impl Into<String>,
        device: impl Into<String>,
        response_key_id: impl Into<String>,
        response_public_key: impl Into<String>,
        credential: ClientCredential,
        timeout: Duration,
    ) -> Result<Self, TransportError> {
        Self::with_clock(
            address,
            server_name,
            audience,
            device,
            response_key_id,
            response_public_key,
            credential,
            timeout,
            SystemClock,
        )
    }

    /// Creates a client with an injected trusted response clock.
    ///
    /// # Errors
    /// Rejects invalid bounds, keys, pins, credentials, or TLS configuration.
    #[allow(clippy::too_many_arguments)]
    pub fn with_clock(
        address: impl Into<String>,
        server_name: impl Into<String>,
        audience: impl Into<String>,
        device: impl Into<String>,
        response_key_id: impl Into<String>,
        response_public_key: impl Into<String>,
        credential: ClientCredential,
        timeout: Duration,
        clock: impl Clock + 'static,
    ) -> Result<Self, TransportError> {
        let address = address.into();
        let server_name = server_name.into();
        let audience = audience.into();
        let device = device.into();
        let response_key_id = response_key_id.into();
        let response_public_key = response_public_key.into();
        if timeout.is_zero()
            || timeout > Duration::from_secs(30)
            || !validation::text(&address, 256)
            || !address.contains(':')
            || !validation::text(&server_name, 253)
            || !validation::text(&audience, 256)
            || !validation::text(&device, 128)
            || !validation::text(&response_key_id, 128)
            || !validation::lower_hex(&response_public_key, 32)
            || !validation::text(&credential.request_key_id, 128)
            || !validation::digest(&credential.expected_server_certificate_sha256)
        {
            return Err(TransportError::Config);
        }
        let tls = crate::tls::client(
            &credential.certificate_der,
            &credential.private_key_der,
            &credential.server_trust_anchor_der,
        )?;
        Ok(Self {
            address,
            server_name,
            audience,
            device,
            response_key_id,
            response_public_key,
            server_certificate_sha256: credential.expected_server_certificate_sha256,
            timeout,
            tls,
            request_key_id: credential.request_key_id,
            request_signing_key: credential.request_signing_key,
            clock: Arc::new(clock),
        })
    }
}
