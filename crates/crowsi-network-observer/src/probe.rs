use std::error::Error;
use std::fmt;

use crate::{NetworkObservationV1, ObservationBatchV1};

/// A safe error whose text is suitable for logs and contains no OS details.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeFailure {
    SourceUnavailable,
    InvalidSourceData,
}

impl fmt::Display for ProbeFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::SourceUnavailable => "observation source is unavailable",
            Self::InvalidSourceData => "observation source returned invalid metadata",
        };
        formatter.write_str(message)
    }
}

impl Error for ProbeFailure {}

/// Implementations observe metadata only and must not mutate network state.
pub trait NetworkProbe {
    /// Returns metadata-only observations for the supplied normalized timestamp.
    ///
    /// # Errors
    ///
    /// Returns a safe failure code when the observation source cannot be used.
    fn observe(&self, observed_at: &str) -> Result<Vec<NetworkObservationV1>, ProbeFailure>;
}

/// Collects and deterministically orders a probe's observations.
///
/// # Errors
///
/// Returns a safe probe failure without exposing raw operating system errors.
pub fn collect(
    probe: &impl NetworkProbe,
    generated_at: &str,
) -> Result<ObservationBatchV1, ProbeFailure> {
    let records = probe.observe(generated_at)?;
    let batch = ObservationBatchV1::new(generated_at, records);
    batch.validate()?;
    Ok(batch)
}
