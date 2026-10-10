use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RequestEnvelopeV1 {
    pub schema: String,
    pub audience: String,
    pub device_id: String,
    pub command: String,
    pub nonce: String,
    pub issued_at_epoch_s: u64,
    pub expires_at_epoch_s: u64,
    pub payload_hex: String,
    pub key_id: String,
    pub signature: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseEnvelopeV1 {
    pub schema: String,
    pub audience: String,
    pub device_id: String,
    pub command: String,
    pub request_digest_sha256: String,
    pub authority_epoch: u64,
    pub issued_at_epoch_s: u64,
    pub expires_at_epoch_s: u64,
    pub payload_hex: String,
    pub key_id: String,
    pub signature: String,
}

pub struct SignedRequest {
    pub peer: PeerBinding,
    pub command: String,
    pub payload: Vec<u8>,
}

#[derive(Clone)]
pub struct PeerBinding {
    pub device_id: String,
    pub certificate_sha256: String,
    pub request_key_id: String,
    pub request_public_key_hex: String,
}
