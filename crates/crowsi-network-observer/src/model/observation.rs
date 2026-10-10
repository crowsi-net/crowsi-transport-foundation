use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};

use crate::{ObservationStatusV1, ProbeFailure};

/// Untrusted input accepted only through the validating constructor.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkObservationInputV1 {
    pub id: String,
    pub target_id: String,
    pub label: String,
    pub zone: String,
    pub protocol: String,
    pub status: ObservationStatusV1,
    pub observed_at: String,
    pub latency_ms: Option<u64>,
    pub packet_loss_percent: Option<f64>,
    pub source: String,
    pub finding_codes: Vec<String>,
}

/// Validated, metadata-only observation.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NetworkObservationV1 {
    id: String,
    target_id: String,
    label: String,
    zone: String,
    protocol: String,
    status: ObservationStatusV1,
    observed_at: String,
    latency_ms: Option<u64>,
    packet_loss_percent: Option<f64>,
    source: String,
    finding_codes: Vec<String>,
}

impl NetworkObservationV1 {
    /// Creates an observation only when every closed-contract invariant holds.
    ///
    /// # Errors
    ///
    /// Rejects malformed identifiers, timestamps, ranges, and finding sets.
    pub fn try_new(input: NetworkObservationInputV1) -> Result<Self, ProbeFailure> {
        let value = Self {
            id: input.id,
            target_id: input.target_id,
            label: input.label,
            zone: input.zone,
            protocol: input.protocol,
            status: input.status,
            observed_at: input.observed_at,
            latency_ms: input.latency_ms,
            packet_loss_percent: input.packet_loss_percent,
            source: input.source,
            finding_codes: input.finding_codes,
        };
        crate::validation::validate_observation(&value)?;
        Ok(value)
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }
    #[must_use]
    pub fn target_id(&self) -> &str {
        &self.target_id
    }
    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }
    #[must_use]
    pub const fn status(&self) -> ObservationStatusV1 {
        self.status
    }
    #[must_use]
    pub fn observed_at(&self) -> &str {
        &self.observed_at
    }
    #[must_use]
    pub const fn latency_ms(&self) -> Option<u64> {
        self.latency_ms
    }
    #[must_use]
    pub const fn packet_loss_percent(&self) -> Option<f64> {
        self.packet_loss_percent
    }
    #[must_use]
    pub fn zone(&self) -> &str {
        &self.zone
    }
    #[must_use]
    pub fn protocol(&self) -> &str {
        &self.protocol
    }
    #[must_use]
    pub fn source(&self) -> &str {
        &self.source
    }
    #[must_use]
    pub fn finding_codes(&self) -> &[String] {
        &self.finding_codes
    }
}

impl<'de> Deserialize<'de> for NetworkObservationV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = NetworkObservationInputV1::deserialize(deserializer)?;
        Self::try_new(input).map_err(D::Error::custom)
    }
}
