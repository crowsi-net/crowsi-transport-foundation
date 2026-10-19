use crate::{Error, Result};
use crowsi_transport_foundation::http::SensitiveBodyCollector;
use std::io::Read;
use zeroize::Zeroizing;
pub(crate) fn collect(
    response: reqwest::blocking::Response,
    maximum: usize,
) -> Result<Zeroizing<Vec<u8>>> {
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(Error::Status(status));
    }
    read(response, maximum)
}
fn read(mut response: impl Read, maximum: usize) -> Result<Zeroizing<Vec<u8>>> {
    let mut collector = SensitiveBodyCollector::new(maximum, None).map_err(|_| Error::BodyLimit)?;
    let mut buffer = Zeroizing::new([0u8; 8192]);
    loop {
        let size = response
            .read(&mut buffer[..])
            .map_err(|_| Error::Transport)?;
        if size == 0 {
            break;
        }
        collector
            .push(&buffer[..size])
            .map_err(|_| Error::BodyLimit)?;
    }
    Ok(collector.finish())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn declared_and_streaming_limits_are_not_truncation() {
        assert!(read(&b"12345"[..], 4).is_err());
        assert_eq!(&*read(&b"1234"[..], 4).unwrap(), b"1234");
        assert_eq!(&*read(&b""[..], 4).unwrap(), b"");
    }
}
