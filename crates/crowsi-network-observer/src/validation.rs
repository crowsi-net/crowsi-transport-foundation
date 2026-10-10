use std::collections::BTreeSet;

use crate::{NetworkObservationV1, OBSERVATIONS_SCHEMA_V1, ObservationBatchV1, ProbeFailure};

const MAX_OBSERVATIONS: usize = 1_024;
const MAX_FINDINGS: usize = 64;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(crate) fn validate_batch(batch: &ObservationBatchV1) -> Result<(), ProbeFailure> {
    if batch.schema() != OBSERVATIONS_SCHEMA_V1
        || batch.external_actions()
        || batch.observation_count() != batch.observations().len()
        || batch.observations().len() > MAX_OBSERVATIONS
        || !timestamp(batch.generated_at())
    {
        return Err(ProbeFailure::InvalidSourceData);
    }
    let mut ids = BTreeSet::new();
    for observation in batch.observations() {
        if !ids.insert(observation.id()) || validate_observation(observation).is_err() {
            return Err(ProbeFailure::InvalidSourceData);
        }
    }
    Ok(())
}

pub(crate) fn validate_observation(observation: &NetworkObservationV1) -> Result<(), ProbeFailure> {
    let invalid = !identifier(observation.id())
        || !identifier(observation.target_id())
        || observation.label().is_empty()
        || observation.label().chars().count() > 128
        || observation.label().chars().any(forbidden_label_character)
        || !identifier(observation.zone())
        || !identifier(observation.protocol())
        || !timestamp(observation.observed_at())
        || !identifier(observation.source())
        || observation.finding_codes().len() > MAX_FINDINGS
        || !unique_identifiers(observation.finding_codes())
        || observation
            .latency_ms()
            .is_some_and(|value| value > MAX_SAFE_INTEGER)
        || observation
            .packet_loss_percent()
            .is_some_and(|value| !value.is_finite() || !(0.0..=100.0).contains(&value));
    if invalid {
        Err(ProbeFailure::InvalidSourceData)
    } else {
        Ok(())
    }
}

fn forbidden_label_character(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{061c}'
                | '\u{200e}'
                | '\u{200f}'
                | '\u{202a}'..='\u{202e}'
                | '\u{2066}'..='\u{2069}'
        )
}

fn unique_identifiers(values: &[String]) -> bool {
    let mut unique = BTreeSet::new();
    values
        .iter()
        .all(|value| identifier(value) && unique.insert(value))
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

pub(crate) fn timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
        || !bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) || byte.is_ascii_digit()
        })
    {
        return false;
    }
    let number = |range| {
        std::str::from_utf8(&bytes[range])
            .ok()
            .and_then(|part| part.parse::<u32>().ok())
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
    ) else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let max_day = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return false,
    };
    day > 0 && day <= max_day && hour < 24 && minute < 60 && second < 60
}
