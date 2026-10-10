mod batch;
mod observation;

use serde::{Deserialize, Serialize};

pub use batch::ObservationBatchV1;
pub use observation::{NetworkObservationInputV1, NetworkObservationV1};

pub const OBSERVATIONS_SCHEMA_V1: &str = "crowsi://network/observations/v1";

/// A status vocabulary designed for operational UI filters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ObservationStatusV1 {
    Reachable,
    Observed,
    Degraded,
    Unavailable,
}
