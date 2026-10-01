//! Bounded parsing for a short-lived loopback HTTP callback.

use std::{io, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt};

#[derive(Debug)]
pub enum CallbackInputError {
    TooLarge,
    Malformed,
    Timeout,
}

impl std::fmt::Display for CallbackInputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "callback input {self:?}")
    }
}

impl std::error::Error for CallbackInputError {}

fn invalid(error: CallbackInputError) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error)
}

/// Reads one bounded GET request addressed to the selected loopback port.
pub async fn read_loopback_get(
    reader: &mut (impl AsyncRead + Unpin),
    port: u16,
) -> io::Result<String> {
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut bytes = [0; 16_384];
        let mut used = 0;
        loop {
            if used == bytes.len() {
                return Err(invalid(CallbackInputError::TooLarge));
            }
            let count = reader.read(&mut bytes[used..]).await?;
            if count == 0 {
                return Err(invalid(CallbackInputError::Malformed));
            }
            used += count;
            let mut headers = [httparse::EMPTY_HEADER; 32];
            let mut request = httparse::Request::new(&mut headers);
            let parsed = request
                .parse(&bytes[..used])
                .map_err(|_| invalid(CallbackInputError::Malformed))?;
            if let httparse::Status::Complete(length) = parsed {
                let host = request
                    .headers
                    .iter()
                    .filter(|header| header.name.eq_ignore_ascii_case("host"))
                    .collect::<Vec<_>>();
                let allowed = [format!("localhost:{port}"), format!("127.0.0.1:{port}")];
                if length != used
                    || request.method != Some("GET")
                    || host.len() != 1
                    || !allowed
                        .iter()
                        .any(|candidate| candidate.as_bytes() == host[0].value)
                    || request.headers.iter().any(|header| {
                        header.name.eq_ignore_ascii_case("transfer-encoding")
                            || (header.name.eq_ignore_ascii_case("content-length")
                                && header.value != b"0")
                    })
                {
                    return Err(invalid(CallbackInputError::Malformed));
                }
                let target = request
                    .path
                    .ok_or_else(|| invalid(CallbackInputError::Malformed))?;
                if target.len() > 8_192 {
                    return Err(invalid(CallbackInputError::TooLarge));
                }
                if !target.starts_with('/') || target.starts_with("//") {
                    return Err(invalid(CallbackInputError::Malformed));
                }
                return Ok(target.to_owned());
            }
        }
    })
    .await
    .map_err(|_| invalid(CallbackInputError::Timeout))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn accepts_only_one_finite_loopback_get() {
        let target = read_loopback_get(
            &mut &b"GET /auth/callback?state=x HTTP/1.1\r\nHost: localhost:1455\r\n\r\n"[..],
            1455,
        )
        .await
        .expect("callback");
        assert_eq!(target, "/auth/callback?state=x");
        for bytes in [
            vec![b'x'; 16_385],
            b"GET / HTTP/1.1\r\nHost: evil.invalid\r\n\r\n".to_vec(),
            b"GET / HTTP/1.1\r\nHost: localhost:1455\r\nContent-Length: 500\r\n\r\n".to_vec(),
        ] {
            assert!(
                read_loopback_get(&mut bytes.as_slice(), 1455)
                    .await
                    .is_err()
            );
        }
    }
}
