use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};

use crate::{NetworkObservationV1, OBSERVATIONS_SCHEMA_V1, ProbeFailure};

/// Closed envelope shared with Nuxt modules and other local consumers.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ObservationBatchV1 {
    schema: String,
    generated_at: String,
    external_actions: bool,
    observation_count: usize,
    observations: Vec<NetworkObservationV1>,
}

impl ObservationBatchV1 {
    pub(crate) fn new(
        generated_at: impl Into<String>,
        mut observations: Vec<NetworkObservationV1>,
    ) -> Self {
        observations.sort_by(|left, right| left.id().cmp(right.id()));
        Self {
            schema: OBSERVATIONS_SCHEMA_V1.to_owned(),
            generated_at: generated_at.into(),
            external_actions: false,
            observation_count: observations.len(),
            observations,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), ProbeFailure> {
        crate::validation::validate_batch(self)
    }

    #[must_use]
    pub fn schema(&self) -> &str {
        &self.schema
    }
    #[must_use]
    pub fn generated_at(&self) -> &str {
        &self.generated_at
    }
    #[must_use]
    pub const fn external_actions(&self) -> bool {
        self.external_actions
    }
    #[must_use]
    pub const fn observation_count(&self) -> usize {
        self.observation_count
    }
    #[must_use]
    pub fn observations(&self) -> &[NetworkObservationV1] {
        &self.observations
    }
}

impl<'de> Deserialize<'de> for ObservationBatchV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            schema: String,
            generated_at: String,
            external_actions: bool,
            observation_count: usize,
            observations: Vec<NetworkObservationV1>,
        }
        let wire = Wire::deserialize(deserializer)?;
        let batch = Self {
            schema: wire.schema,
            generated_at: wire.generated_at,
            external_actions: wire.external_actions,
            observation_count: wire.observation_count,
            observations: wire.observations,
        };
        batch.validate().map_err(D::Error::custom)?;
        Ok(batch)
    }
}
