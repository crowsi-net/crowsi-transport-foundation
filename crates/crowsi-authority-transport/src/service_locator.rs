use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::TransportError;

pub const SERVICE_LOCATOR_SCHEMA: &str = "crowsi://authority-transport/service-locator/v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceLocatorV1 {
    pub schema: String,
    pub locator_id: String,
    pub route_ref: String,
    pub transport_profile_ref: String,
    pub service_identity_ref: String,
    pub address: String,
    pub server_name: String,
    pub audience: String,
    pub server_certificate_sha256: String,
    pub revision: u64,
    pub issued_at_epoch_s: u64,
    pub expires_at_epoch_s: u64,
    pub key_id: String,
    pub signature: String,
}

pub struct VerifiedServiceLocator(ServiceLocatorV1);

impl VerifiedServiceLocator {
    #[must_use]
    pub fn route_ref(&self) -> &str {
        &self.0.route_ref
    }

    #[must_use]
    pub fn value(&self) -> &ServiceLocatorV1 {
        &self.0
    }

    #[must_use]
    pub fn into_value(self) -> ServiceLocatorV1 {
        self.0
    }
}

/// Returns domain-separated bytes signed by a locator authority.
///
/// # Errors
///
/// Returns a contract error if serialization fails.
pub fn service_locator_signing_bytes(value: &ServiceLocatorV1) -> Result<Vec<u8>, TransportError> {
    let mut unsigned = value.clone();
    unsigned.signature.clear();
    let json = serde_json::to_vec(&unsigned).map_err(|_| TransportError::Contract)?;
    let mut bytes = b"crowsi-authority-transport-service-locator-v1\0".to_vec();
    bytes.extend_from_slice(&json);
    Ok(bytes)
}

/// Verifies a locator under a caller-pinned signing key and current time.
///
/// # Errors
///
/// Returns a closed transport error for invalid identity, address, lifetime or signature.
pub fn verify_service_locator_at(
    value: &ServiceLocatorV1,
    expected_key_id: &str,
    public_key_hex: &str,
    now: u64,
) -> Result<VerifiedServiceLocator, TransportError> {
    crate::service_locator_validation::validate(value, expected_key_id, now)?;
    let public: [u8; 32] = hex::decode(public_key_hex)
        .map_err(|_| TransportError::Config)?
        .try_into()
        .map_err(|_| TransportError::Config)?;
    let signature: [u8; 64] = hex::decode(&value.signature)
        .map_err(|_| TransportError::Signature)?
        .try_into()
        .map_err(|_| TransportError::Signature)?;
    let key = VerifyingKey::from_bytes(&public).map_err(|_| TransportError::Config)?;
    key.verify_strict(
        &service_locator_signing_bytes(value)?,
        &Signature::from_bytes(&signature),
    )
    .map_err(|_| TransportError::Signature)?;
    Ok(VerifiedServiceLocator(value.clone()))
}
