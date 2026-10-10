use std::fs::File;
use std::io::{Read, Take};

use crate::{
    NetworkObservationInputV1, NetworkObservationV1, NetworkProbe, ObservationStatusV1,
    ProbeFailure,
};

const MAX_SOURCE_BYTES: u64 = 1_048_576;
const PROC_NET_DEV: &str = "/proc/net/dev";

/// Linux interface-presence probe. Counter values are validated but not emitted.
#[derive(Debug, Default, Clone, Copy)]
pub struct ProcNetDevProbe;

impl NetworkProbe for ProcNetDevProbe {
    fn observe(&self, observed_at: &str) -> Result<Vec<NetworkObservationV1>, ProbeFailure> {
        let file = File::open(PROC_NET_DEV).map_err(|_| ProbeFailure::SourceUnavailable)?;
        let metadata = file
            .metadata()
            .map_err(|_| ProbeFailure::SourceUnavailable)?;
        if !metadata.file_type().is_file() {
            return Err(ProbeFailure::SourceUnavailable);
        }
        let mut source = String::new();
        let mut bounded: Take<File> = file.take(MAX_SOURCE_BYTES + 1);
        bounded
            .read_to_string(&mut source)
            .map_err(|_| ProbeFailure::InvalidSourceData)?;
        if source.len() as u64 > MAX_SOURCE_BYTES {
            return Err(ProbeFailure::InvalidSourceData);
        }
        parse_proc_net_dev(&source, observed_at)
    }
}

/// Parses interface metadata while intentionally discarding traffic counters.
///
/// # Errors
///
/// Rejects malformed names, missing fields, and non-numeric counters.
fn parse_proc_net_dev(
    source: &str,
    observed_at: &str,
) -> Result<Vec<NetworkObservationV1>, ProbeFailure> {
    if source.lines().count() < 2 {
        return Err(ProbeFailure::InvalidSourceData);
    }
    let mut records = Vec::new();
    for line in source
        .lines()
        .skip(2)
        .filter(|line| !line.trim().is_empty())
    {
        let (raw_name, raw_fields) = line
            .split_once(':')
            .ok_or(ProbeFailure::InvalidSourceData)?;
        let name = raw_name.trim();
        if !valid_interface_name(name) {
            return Err(ProbeFailure::InvalidSourceData);
        }
        let fields: Vec<&str> = raw_fields.split_ascii_whitespace().collect();
        if fields.len() < 16 || fields.iter().any(|value| value.parse::<u64>().is_err()) {
            return Err(ProbeFailure::InvalidSourceData);
        }
        records.push(interface_observation(name, observed_at)?);
    }
    if records.is_empty() {
        Err(ProbeFailure::InvalidSourceData)
    } else {
        Ok(records)
    }
}

fn valid_interface_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn interface_observation(
    name: &str,
    observed_at: &str,
) -> Result<NetworkObservationV1, ProbeFailure> {
    let normalized = name.to_ascii_lowercase();
    NetworkObservationV1::try_new(NetworkObservationInputV1 {
        id: format!("observation-interface-{normalized}"),
        target_id: format!("interface-{normalized}"),
        label: name.to_owned(),
        zone: "local-host".to_owned(),
        protocol: "interface".to_owned(),
        status: ObservationStatusV1::Observed,
        observed_at: observed_at.to_owned(),
        latency_ms: None,
        packet_loss_percent: None,
        source: "linux-proc-net-dev".to_owned(),
        finding_codes: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::parse_proc_net_dev;

    const TIME: &str = "2026-08-01T00:00:00.000Z";

    #[test]
    fn parses_names_without_emitting_counters() {
        let source = "head\nhead\n eth0: 10 1 0 0 0 0 0 0 20 2 0 0 0 0 0 0\n";
        let records = parse_proc_net_dev(source, TIME).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].target_id(), "interface-eth0");
        let json = serde_json::to_string(&records).unwrap();
        assert!(!json.contains("\"10\""));
        assert!(!json.contains("\"20\""));
    }

    #[test]
    fn rejects_malformed_or_missing_observations() {
        let invalid_name = "head\nhead\n user@host: 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1\n";
        assert!(parse_proc_net_dev(invalid_name, TIME).is_err());
        assert!(parse_proc_net_dev("", TIME).is_err());
        assert!(parse_proc_net_dev("head\n", TIME).is_err());
        assert!(parse_proc_net_dev("head\nhead\n", TIME).is_err());
    }
}
