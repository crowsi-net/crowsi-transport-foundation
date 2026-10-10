use std::fs;

use crowsi_network_observer::probes::SampleProbe;
use crowsi_network_observer::{OBSERVATIONS_SCHEMA_V1, ObservationBatchV1, collect};

const SAMPLE_TIME: &str = "2026-08-01T00:00:00.000Z";
const UTC_MILLIS_PATTERN: &str =
    "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$";

#[test]
fn deterministic_sample_matches_checked_in_contract() {
    let actual = serde_json::to_value(collect(&SampleProbe, SAMPLE_TIME).unwrap()).unwrap();
    let expected: serde_json::Value =
        serde_json::from_str(&fs::read_to_string("examples/observation.sample.json").unwrap())
            .unwrap();
    assert_eq!(actual, expected);
}

#[test]
fn rejects_unknown_contract_fields() {
    let source = format!(
        r#"{{"schema":"{OBSERVATIONS_SCHEMA_V1}","generated_at":"{SAMPLE_TIME}","external_actions":false,"observation_count":0,"observations":[],"secret":"no"}}"#
    );
    assert!(serde_json::from_str::<ObservationBatchV1>(&source).is_err());
}

#[test]
fn output_has_no_secret_or_packet_fields() {
    let json = serde_json::to_string(&collect(&SampleProbe, SAMPLE_TIME).unwrap()).unwrap();
    for forbidden in ["credential", "password", "token", "packet_body", "payload"] {
        assert!(!json.contains(forbidden));
    }
}

#[test]
fn timestamp_schema_shapes_match_the_executable_contract() {
    let schema: serde_json::Value = serde_json::from_str(include_str!(
        "../schemas/network-observations-v1.schema.json"
    ))
    .unwrap();
    for pointer in [
        "/properties/generated_at/pattern",
        "/$defs/observation/properties/observed_at/pattern",
    ] {
        assert_eq!(schema.pointer(pointer).unwrap(), UTC_MILLIS_PATTERN);
    }
    assert_eq!(
        schema
            .pointer("/$defs/observation/properties/label/pattern")
            .unwrap(),
        "^[^\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]+$"
    );
    assert_eq!(
        schema
            .pointer("/$defs/observation/properties/latency_ms/maximum")
            .unwrap(),
        9_007_199_254_740_991_u64
    );
}
