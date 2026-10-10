use std::net::SocketAddr;

use crate::{SERVICE_LOCATOR_SCHEMA, ServiceLocatorV1, TransportError};

pub(crate) fn validate(
    value: &ServiceLocatorV1,
    expected_key_id: &str,
    now: u64,
) -> Result<(), TransportError> {
    if value.schema != SERVICE_LOCATOR_SCHEMA
        || !token(&value.locator_id, 128)
        || !reference(&value.route_ref, "crowsi/route/")
        || value.transport_profile_ref != "crowsi/mtls-authority-v1"
        || !reference(&value.service_identity_ref, "ihat/service/")
        || value.address.parse::<SocketAddr>().is_err()
        || !server_name(&value.server_name)
        || !token(&value.audience, 256)
        || !sha256(&value.server_certificate_sha256)
        || value.revision == 0
        || value.issued_at_epoch_s > now
        || now >= value.expires_at_epoch_s
        || value.expires_at_epoch_s <= value.issued_at_epoch_s
        || value.expires_at_epoch_s - value.issued_at_epoch_s > 300
        || value.key_id != expected_key_id
        || !token(&value.key_id, 128)
        || value.signature.len() != 128
    {
        return Err(TransportError::Contract);
    }
    Ok(())
}

fn token(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'.')
        })
}

fn reference(value: &str, prefix: &str) -> bool {
    value.len() <= 256
        && value.strip_prefix(prefix).is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'-' | b'/')
                })
        })
}

fn server_name(value: &str) -> bool {
    value.len() <= 253
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}
