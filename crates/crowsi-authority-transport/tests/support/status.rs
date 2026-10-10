use crowsi_authority_transport::{
    PeerBinding, PeerStatusGuard, PeerStatusIdentity, TransportError,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy)]
pub enum StatusValue {
    Active,
    Revoked,
}

impl StatusValue {
    const fn wire(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Revoked => "revoked",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObservedStatusCheck {
    pub device_id: String,
    pub client_certificate_sha256: String,
    pub request_key_id: String,
    pub authority_epoch: u64,
}

#[derive(Clone)]
pub struct DurableStatusGuard {
    path: PathBuf,
    key: VerifyingKey,
    observed: Arc<Mutex<Vec<ObservedStatusCheck>>>,
}

impl DurableStatusGuard {
    pub fn open(path: &Path, key: VerifyingKey) -> Self {
        Self {
            path: path.to_owned(),
            key,
            observed: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn observed(&self) -> Vec<ObservedStatusCheck> {
        self.observed.lock().expect("observed status").clone()
    }
}

impl PeerStatusGuard for DurableStatusGuard {
    fn authorize_current(
        &self,
        peer: PeerStatusIdentity<'_>,
        authority_epoch: u64,
    ) -> Result<(), TransportError> {
        self.observed
            .lock()
            .map_err(|_| TransportError::Unavailable)?
            .push(ObservedStatusCheck {
                device_id: peer.device_id.into(),
                client_certificate_sha256: peer.client_certificate_sha256.into(),
                request_key_id: peer.request_key_id.into(),
                authority_epoch,
            });
        let wire = fs::read_to_string(&self.path).map_err(|_| TransportError::Unavailable)?;
        let (body, signature) = wire
            .rsplit_once("\nsignature=")
            .ok_or(TransportError::Unavailable)?;
        let bytes = hex::decode(signature.trim()).map_err(|_| TransportError::Unavailable)?;
        let signature = Signature::from_slice(&bytes).map_err(|_| TransportError::Unavailable)?;
        self.key
            .verify(body.as_bytes(), &signature)
            .map_err(|_| TransportError::Unavailable)?;
        authorize_body(body, peer, authority_epoch)
    }
}

fn authorize_body(
    body: &str,
    peer: PeerStatusIdentity<'_>,
    authority_epoch: u64,
) -> Result<(), TransportError> {
    let mut devices = BTreeSet::new();
    let mut result = None;
    for line in body.lines() {
        let fields: Vec<_> = line.split('|').collect();
        if fields.len() != 5 || !devices.insert(fields[1]) {
            return Err(TransportError::Unavailable);
        }
        let epoch = fields[0]
            .parse::<u64>()
            .map_err(|_| TransportError::Unavailable)?;
        if epoch != authority_epoch || !matches!(fields[4], "active" | "revoked") {
            return Err(TransportError::Unavailable);
        }
        if fields[1] == peer.device_id
            && fields[2] == peer.client_certificate_sha256
            && fields[3] == peer.request_key_id
        {
            result = Some(fields[4] == "active");
        }
    }
    match result {
        Some(true) => Ok(()),
        Some(false) | None => Err(TransportError::Peer),
    }
}

pub fn write_status_token(
    path: &Path,
    key: &SigningKey,
    authority_epoch: u64,
    peers: &[(&PeerBinding, StatusValue)],
) {
    let body = peers
        .iter()
        .map(|(peer, status)| {
            format!(
                "{authority_epoch}|{}|{}|{}|{}",
                peer.device_id,
                peer.certificate_sha256,
                peer.request_key_id,
                status.wire()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let signature = hex::encode(key.sign(body.as_bytes()).to_bytes());
    fs::write(path, format!("{body}\nsignature={signature}")).expect("write status token");
}
