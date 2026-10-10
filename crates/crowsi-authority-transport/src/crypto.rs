use ed25519_dalek::{Signature, Signer, SigningKey, Verifier as _, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::TransportError;

pub(crate) fn canonical(domain: &str, value: &Value) -> Result<Vec<u8>, TransportError> {
    let mut unsigned = value.clone();
    unsigned
        .as_object_mut()
        .ok_or(TransportError::Contract)?
        .remove("signature");
    let body = serde_json::to_vec(&unsigned).map_err(|_| TransportError::Contract)?;
    Ok([
        domain.as_bytes(),
        b"\0",
        body.len().to_string().as_bytes(),
        b"\n",
        &body,
    ]
    .concat())
}

pub(crate) fn sign(key: &SigningKey, bytes: &[u8]) -> String {
    hex::encode(key.sign(bytes).to_bytes())
}

pub(crate) fn verify(public: &str, signature: &str, bytes: &[u8]) -> bool {
    let Ok(key): Result<[u8; 32], _> = hex::decode(public).and_then(|v| {
        v.try_into()
            .map_err(|_| hex::FromHexError::InvalidStringLength)
    }) else {
        return false;
    };
    let Ok(key) = VerifyingKey::from_bytes(&key) else {
        return false;
    };
    let Ok(value) = hex::decode(signature) else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(&value) else {
        return false;
    };
    key.verify(bytes, &signature).is_ok()
}

pub(crate) fn digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}
