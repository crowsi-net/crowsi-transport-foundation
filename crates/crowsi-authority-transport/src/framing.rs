use crate::TransportError;
use std::io::{Read, Write};

pub(crate) const MAX: usize = 1_048_576;

pub(crate) fn write(stream: &mut impl Write, value: &[u8]) -> Result<(), TransportError> {
    if value.is_empty() || value.len() > MAX {
        return Err(TransportError::Contract);
    }
    let length = u32::try_from(value.len())
        .map_err(|_| TransportError::Contract)?
        .to_be_bytes();
    stream
        .write_all(&length)
        .and_then(|()| stream.write_all(value))
        .and_then(|()| stream.flush())
        .map_err(|error| io_error_kind(error.kind()))
}

pub(crate) fn read(stream: &mut impl Read) -> Result<Vec<u8>, TransportError> {
    let mut length = [0_u8; 4];
    stream
        .read_exact(&mut length)
        .map_err(|error| io_error_kind(error.kind()))?;
    let length =
        usize::try_from(u32::from_be_bytes(length)).map_err(|_| TransportError::Contract)?;
    if length == 0 || length > MAX {
        return Err(TransportError::Contract);
    }
    let mut value = vec![0; length];
    stream
        .read_exact(&mut value)
        .map_err(|error| io_error_kind(error.kind()))?;
    Ok(value)
}

fn io_error_kind(kind: std::io::ErrorKind) -> TransportError {
    if matches!(
        kind,
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        TransportError::Timeout
    } else {
        TransportError::Unavailable
    }
}
