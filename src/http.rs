//! Provider-neutral HTTP request preparation contracts.
//!
//! This module owns bounded wire preparation, not network execution, routing,
//! credentials, retries, provider endpoints, or application interpretation.

use ::http::{HeaderMap, HeaderValue, Method};
use bytes::Bytes;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BodyLimitExceeded {
    pub limit: usize,
    pub observed_at_least: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BodyCollectError {
    Limit(BodyLimitExceeded),
    AllocationUnavailable,
}

/// Incremental response collector with a strict allocation ceiling.
///
/// Reallocation erases the previous allocation and dropping an incomplete
/// collector erases accepted bytes. HTTP status and provider meaning remain in
/// the execution adapter.
pub struct SensitiveBodyCollector {
    limit: usize,
    bytes: Zeroizing<Vec<u8>>,
}

impl SensitiveBodyCollector {
    pub fn new(limit: usize, declared_length: Option<u64>) -> Result<Self, BodyLimitExceeded> {
        if declared_length.is_some_and(|length| length > limit as u64) {
            return Err(BodyLimitExceeded {
                limit,
                observed_at_least: declared_length.unwrap_or(u64::MAX),
            });
        }
        Ok(Self {
            limit,
            bytes: Zeroizing::new(Vec::new()),
        })
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), BodyCollectError> {
        if chunk.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(BodyCollectError::Limit(BodyLimitExceeded {
                limit: self.limit,
                observed_at_least: (self.bytes.len() as u64).saturating_add(chunk.len() as u64),
            }));
        }
        let required = self.bytes.len() + chunk.len();
        if required > self.bytes.capacity() {
            let capacity = required
                .max(self.bytes.capacity().saturating_mul(2))
                .min(self.limit);
            let mut next = Zeroizing::new(Vec::new());
            next.try_reserve_exact(capacity)
                .map_err(|_| BodyCollectError::AllocationUnavailable)?;
            next.extend_from_slice(&self.bytes);
            self.bytes = next;
        }
        self.bytes.extend_from_slice(chunk);
        Ok(())
    }

    #[must_use]
    pub fn finish(self) -> Zeroizing<Vec<u8>> {
        self.bytes
    }
}

/// A JSON request body serialized once into reference-counted bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodedJsonBody {
    bytes: Bytes,
    prepared: bool,
}

impl EncodedJsonBody {
    /// Serializes `value` into reusable JSON wire bytes.
    pub fn encode<T: Serialize + ?Sized>(value: &T) -> Result<Self, serde_json::Error> {
        serde_json::to_vec(value).map(|bytes| Self {
            bytes: Bytes::from(bytes),
            prepared: false,
        })
    }

    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RequestCompression {
    #[default]
    None,
    Zstd,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestBody {
    Json(Value),
    EncodedJson(EncodedJsonBody),
    Raw(Bytes),
}

impl RequestBody {
    #[must_use]
    pub fn json(&self) -> Option<&Value> {
        match self {
            Self::Json(value) => Some(value),
            Self::EncodedJson(_) | Self::Raw(_) => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedRequestBody {
    pub headers: HeaderMap,
    pub body: Option<Bytes>,
}

impl PreparedRequestBody {
    #[must_use]
    pub fn body_bytes(&self) -> Bytes {
        self.body.clone().unwrap_or_default()
    }
}

#[derive(Debug, Clone)]
pub struct Request {
    pub method: Method,
    pub url: String,
    pub headers: HeaderMap,
    pub body: Option<RequestBody>,
    pub compression: RequestCompression,
    pub timeout: Option<Duration>,
    /// Finite body-byte budget for buffered success and error responses.
    pub max_response_bytes: usize,
}

impl Request {
    #[must_use]
    pub fn new(method: Method, url: String) -> Self {
        Self {
            method,
            url,
            headers: HeaderMap::new(),
            body: None,
            compression: RequestCompression::None,
            timeout: None,
            max_response_bytes: 8 * 1024 * 1024,
        }
    }

    #[must_use]
    pub fn with_json<T: Serialize>(mut self, body: &T) -> Self {
        self.body = serde_json::to_value(body).ok().map(RequestBody::Json);
        self
    }

    #[must_use]
    pub fn with_raw_body(mut self, body: impl Into<Bytes>) -> Self {
        self.body = Some(RequestBody::Raw(body.into()));
        self
    }

    #[must_use]
    pub fn with_compression(mut self, compression: RequestCompression) -> Self {
        self.compression = compression;
        self
    }

    /// Stores the exact bytes later attempts must send.
    pub fn into_prepared(mut self) -> Result<Self, String> {
        let is_json = matches!(
            self.body,
            Some(RequestBody::Json(_) | RequestBody::EncodedJson(_))
        );
        let prepared = self.prepare_body_for_send()?;
        self.headers = prepared.headers;
        self.body = match (is_json, prepared.body) {
            (true, Some(bytes)) => Some(RequestBody::EncodedJson(EncodedJsonBody {
                bytes,
                prepared: true,
            })),
            (false, Some(body)) => Some(RequestBody::Raw(body)),
            (_, None) => None,
        };
        self.compression = RequestCompression::None;
        Ok(self)
    }

    /// Produces the exact headers and bytes that network execution must use.
    pub fn prepare_body_for_send(&self) -> Result<PreparedRequestBody, String> {
        let headers = self.headers.clone();
        match self.body.as_ref() {
            Some(RequestBody::Raw(raw_body)) => {
                if self.compression != RequestCompression::None {
                    return Err("request compression cannot be used with raw bodies".to_owned());
                }
                Ok(PreparedRequestBody {
                    headers,
                    body: Some(raw_body.clone()),
                })
            }
            Some(RequestBody::Json(body)) => {
                let body = EncodedJsonBody::encode(body).map_err(|error| error.to_string())?;
                self.prepare_encoded_json(headers, &body)
            }
            Some(RequestBody::EncodedJson(body)) => self.prepare_encoded_json(headers, body),
            None => Ok(PreparedRequestBody {
                headers,
                body: None,
            }),
        }
    }

    fn prepare_encoded_json(
        &self,
        mut headers: HeaderMap,
        body: &EncodedJsonBody,
    ) -> Result<PreparedRequestBody, String> {
        if body.prepared {
            return Ok(PreparedRequestBody {
                headers,
                body: Some(body.bytes.clone()),
            });
        }

        let bytes = if self.compression != RequestCompression::None {
            if headers.contains_key(::http::header::CONTENT_ENCODING) {
                return Err(
                    "request compression was requested but content-encoding is already set"
                        .to_owned(),
                );
            }
            let before = body.bytes.len();
            let started = std::time::Instant::now();
            let (compressed, encoding) = match self.compression {
                RequestCompression::None => unreachable!("compression is checked above"),
                RequestCompression::Zstd => (
                    zstd::stream::encode_all(std::io::Cursor::new(body.as_bytes()), 3)
                        .map_err(|error| error.to_string())?,
                    HeaderValue::from_static("zstd"),
                ),
            };
            tracing::debug!(
                pre_compression_bytes = before,
                post_compression_bytes = compressed.len(),
                compression_duration_ms = started.elapsed().as_millis(),
                "compressed HTTP request body"
            );
            headers.insert(::http::header::CONTENT_ENCODING, encoding);
            Bytes::from(compressed)
        } else {
            body.bytes.clone()
        };

        if !headers.contains_key(::http::header::CONTENT_TYPE) {
            headers.insert(
                ::http::header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
        }
        Ok(PreparedRequestBody {
            headers,
            body: Some(bytes),
        })
    }
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: ::http::StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prepares_json_once_and_reuses_the_exact_wire_bytes() {
        let request = Request::new(Method::POST, "https://example.test/items".to_owned())
            .with_json(&json!({"item": "one"}))
            .with_compression(RequestCompression::Zstd)
            .into_prepared()
            .expect("prepare");
        let first = request.prepare_body_for_send().expect("first");
        let second = request.prepare_body_for_send().expect("second");
        assert_eq!(first, second);
        assert_eq!(request.compression, RequestCompression::None);
        assert_eq!(
            first.headers.get(::http::header::CONTENT_ENCODING),
            Some(&HeaderValue::from_static("zstd"))
        );
    }

    #[test]
    fn rejects_compression_for_raw_or_already_encoded_input() {
        let raw = Request::new(Method::POST, "https://example.test/items".to_owned())
            .with_raw_body(Bytes::from_static(b"raw"))
            .with_compression(RequestCompression::Zstd);
        assert!(raw.prepare_body_for_send().is_err());

        let mut json = Request::new(Method::POST, "https://example.test/items".to_owned())
            .with_json(&json!({"item": "one"}))
            .with_compression(RequestCompression::Zstd);
        json.headers.insert(
            ::http::header::CONTENT_ENCODING,
            HeaderValue::from_static("gzip"),
        );
        assert!(json.prepare_body_for_send().is_err());
    }

    #[test]
    fn bounds_declared_and_incremental_response_bytes() {
        assert_eq!(
            SensitiveBodyCollector::new(4, Some(5))
                .err()
                .expect("declared oversize"),
            BodyLimitExceeded {
                limit: 4,
                observed_at_least: 5,
            }
        );
        let mut collector = SensitiveBodyCollector::new(4, None).expect("collector");
        collector.push(b"abc").expect("first chunk");
        assert_eq!(
            collector.push(b"de"),
            Err(BodyCollectError::Limit(BodyLimitExceeded {
                limit: 4,
                observed_at_least: 5,
            }))
        );
    }
}
