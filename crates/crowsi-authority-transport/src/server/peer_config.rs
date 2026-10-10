use crate::{PeerBinding, validation};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub(super) fn valid(peers: &[(PeerBinding, Vec<u8>)]) -> bool {
    let mut devices = BTreeSet::new();
    let mut certificates = BTreeSet::new();
    let mut key_ids = BTreeSet::new();
    let mut public_keys = BTreeSet::new();
    peers.len() <= 10_000
        && peers.iter().all(|(peer, certificate)| {
            validation::text(&peer.device_id, 128)
                && validation::digest(&peer.certificate_sha256)
                && validation::text(&peer.request_key_id, 128)
                && validation::lower_hex(&peer.request_public_key_hex, 32)
                && !certificate.is_empty()
                && certificate.len() <= 262_144
                && devices.insert(&peer.device_id)
                && certificates.insert(&peer.certificate_sha256)
                && key_ids.insert(&peer.request_key_id)
                && public_keys.insert(&peer.request_public_key_hex)
                && format!("sha256:{:x}", Sha256::digest(certificate)) == peer.certificate_sha256
        })
}
