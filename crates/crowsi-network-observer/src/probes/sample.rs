use crate::{
    NetworkObservationInputV1, NetworkObservationV1, NetworkProbe, ObservationStatusV1,
    ProbeFailure,
};

/// A deterministic probe for examples, contract tests, and UI fixtures.
#[derive(Debug, Default, Clone, Copy)]
pub struct SampleProbe;

impl NetworkProbe for SampleProbe {
    fn observe(&self, observed_at: &str) -> Result<Vec<NetworkObservationV1>, ProbeFailure> {
        let observation = NetworkObservationV1::try_new(NetworkObservationInputV1 {
            id: "observation-sample-edge".to_owned(),
            target_id: "sample-edge".to_owned(),
            label: "Sample edge".to_owned(),
            zone: "example".to_owned(),
            protocol: "https".to_owned(),
            status: ObservationStatusV1::Reachable,
            observed_at: observed_at.to_owned(),
            latency_ms: Some(18),
            packet_loss_percent: Some(0.0),
            source: "deterministic-sample".to_owned(),
            finding_codes: Vec::new(),
        })?;
        Ok(vec![observation])
    }
}
