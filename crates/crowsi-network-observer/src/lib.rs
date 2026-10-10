//! Read-only network observations with a stable UI-facing contract.

mod model;
mod probe;
pub mod probes;
mod time;
mod validation;

pub use model::{
    NetworkObservationInputV1, NetworkObservationV1, OBSERVATIONS_SCHEMA_V1, ObservationBatchV1,
    ObservationStatusV1,
};
pub use probe::{NetworkProbe, ProbeFailure, collect};
pub use time::{now_rfc3339, unix_millis_to_rfc3339};
