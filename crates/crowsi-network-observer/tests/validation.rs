use crowsi_network_observer::probes::SampleProbe;
use crowsi_network_observer::{
    NetworkObservationInputV1, NetworkObservationV1, NetworkProbe, ObservationBatchV1,
    ObservationStatusV1, ProbeFailure, collect,
};

const TIME: &str = "2026-08-01T00:00:00.000Z";

struct CustomProbe(Vec<NetworkObservationV1>);

impl NetworkProbe for CustomProbe {
    fn observe(&self, _: &str) -> Result<Vec<NetworkObservationV1>, ProbeFailure> {
        Ok(self.0.clone())
    }
}

fn sample() -> NetworkObservationV1 {
    collect(&SampleProbe, TIME).unwrap().observations()[0].clone()
}

fn observation(id: String) -> NetworkObservationV1 {
    NetworkObservationV1::try_new(NetworkObservationInputV1 {
        id,
        target_id: "sample-edge".to_owned(),
        label: "Sample edge".to_owned(),
        zone: "example".to_owned(),
        protocol: "https".to_owned(),
        status: ObservationStatusV1::Reachable,
        observed_at: TIME.to_owned(),
        latency_ms: Some(18),
        packet_loss_percent: Some(0.0),
        source: "deterministic-sample".to_owned(),
        finding_codes: Vec::new(),
    })
    .unwrap()
}

#[test]
fn rejects_invalid_timestamps_and_measurement_range() {
    assert!(collect(&SampleProbe, "2026-02-30T00:00:00.000Z").is_err());
    let mut value = serde_json::to_value(sample()).unwrap();
    value["observed_at"] = "2026-08-01T24:00:00.000Z".into();
    assert!(serde_json::from_value::<NetworkObservationV1>(value).is_err());

    let mut value = serde_json::to_value(sample()).unwrap();
    value["packet_loss_percent"] = 100.1.into();
    assert!(serde_json::from_value::<NetworkObservationV1>(value).is_err());

    let mut value = serde_json::to_value(sample()).unwrap();
    value["latency_ms"] = 9_007_199_254_740_992_u64.into();
    assert!(serde_json::from_value::<NetworkObservationV1>(value).is_err());
}

#[test]
fn rejects_control_and_bidi_label_characters() {
    for label in [
        "line\nbreak",
        "arabic\u{061c}mark",
        "direction\u{202e}override",
        "isolate\u{2066}text",
    ] {
        let mut value = serde_json::to_value(sample()).unwrap();
        value["label"] = label.into();
        assert!(serde_json::from_value::<NetworkObservationV1>(value).is_err());
    }
}

#[test]
fn rejects_duplicate_projection_keys_and_findings() {
    let observation = sample();
    assert!(collect(&CustomProbe(vec![observation.clone(), observation]), TIME).is_err());
    let mut value = serde_json::to_value(sample()).unwrap();
    value["finding_codes"] = serde_json::json!(["finding-one", "finding-one"]);
    assert!(serde_json::from_value::<NetworkObservationV1>(value).is_err());
}

#[test]
fn rejects_oversized_custom_projection() {
    let mut records = Vec::with_capacity(1_025);
    for index in 0..1_025 {
        records.push(observation(format!("observation-{index}")));
    }
    assert!(collect(&CustomProbe(records), TIME).is_err());
}

#[test]
fn deserialization_rejects_schema_count_and_action_inconsistency() {
    let json = serde_json::to_string(&collect(&SampleProbe, TIME).unwrap()).unwrap();
    let wrong_schema = json.replace(
        "crowsi://network/observations/v1",
        "crowsi://network/observations/v2",
    );
    assert!(serde_json::from_str::<ObservationBatchV1>(&wrong_schema).is_err());
    let wrong_count = json.replace("\"observation_count\":1", "\"observation_count\":2");
    assert!(serde_json::from_str::<ObservationBatchV1>(&wrong_count).is_err());
    let external = json.replace("\"external_actions\":false", "\"external_actions\":true");
    assert!(serde_json::from_str::<ObservationBatchV1>(&external).is_err());
}
