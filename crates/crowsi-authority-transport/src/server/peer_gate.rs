use crate::TransportError;
use std::{collections::BTreeSet, sync::Mutex};

pub(super) struct PeerGate {
    active: Mutex<BTreeSet<String>>,
}

impl PeerGate {
    pub(super) const fn new() -> Self {
        Self {
            active: Mutex::new(BTreeSet::new()),
        }
    }

    pub(super) fn enter(&self, device: &str) -> Result<PeerPermit<'_>, TransportError> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| TransportError::Unavailable)?;
        if !active.insert(device.to_owned()) {
            return Err(TransportError::Unavailable);
        }
        Ok(PeerPermit {
            gate: self,
            device: device.to_owned(),
        })
    }
}

pub(super) struct PeerPermit<'a> {
    gate: &'a PeerGate,
    device: String,
}

impl Drop for PeerPermit<'_> {
    fn drop(&mut self) {
        let mut active = self
            .gate
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        active.remove(&self.device);
    }
}
