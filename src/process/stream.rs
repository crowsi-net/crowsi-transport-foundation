//! Byte delivery only: the caller owns protocol framing and completion evidence.
use std::{
    io::{self, Read, Write},
    net::{SocketAddr, TcpStream},
    time::{Duration, Instant},
};

/// Delivers bounded response chunks without buffering the entire response.
/// One connection and deadline are used; request bytes are never retried.
/// The synchronous receiver provides backpressure and may abort with an error.
/// Bytes already observed are provisional when delivery subsequently fails.
/// Receivers must return promptly: the deadline cannot preempt user code.
/// # Errors
/// Rejects invalid bounds, expired deadlines, cancellation, receiver failure,
/// oversized responses and socket failures. EOF is transport completion only.
pub fn guarded_tcp_stream(
    address: SocketAddr,
    request: &[u8],
    maximum: usize,
    deadline: Instant,
    mut guard: impl FnMut() -> io::Result<()>,
    mut receive: impl FnMut(&[u8]) -> io::Result<()>,
) -> io::Result<()> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or(io::ErrorKind::TimedOut)?;
    if maximum > 1024 * 1024 || request.len() > 65536 || remaining > Duration::from_secs(30) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    guard()?;
    let quantum = Duration::from_millis(50);
    let mut stream = TcpStream::connect_timeout(&address, remaining.min(quantum))?;
    let mut rest = request;
    let mut total = 0;
    let mut buffer = [0; 4096];
    loop {
        guard()?;
        let timeout = deadline
            .checked_duration_since(Instant::now())
            .ok_or(io::ErrorKind::TimedOut)?
            .min(quantum);
        let result = if rest.is_empty() {
            stream.set_read_timeout(Some(timeout))?;
            stream.read(&mut buffer)
        } else {
            stream.set_write_timeout(Some(timeout))?;
            stream.write(rest)
        };
        match result {
            Ok(0) if !rest.is_empty() => return Err(io::ErrorKind::WriteZero.into()),
            Ok(0) => {
                guard()?;
                if Instant::now() >= deadline {
                    return Err(io::ErrorKind::TimedOut.into());
                }
                return Ok(());
            }
            Ok(n) if !rest.is_empty() => rest = &rest[n..],
            Ok(n) => {
                total += n;
                if total > maximum {
                    return Err(io::ErrorKind::InvalidData.into());
                }
                guard()?;
                if Instant::now() >= deadline {
                    return Err(io::ErrorKind::TimedOut.into());
                }
                receive(&buffer[..n])?;
            }
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock
                        | io::ErrorKind::TimedOut
                        | io::ErrorKind::Interrupted
                ) => {}
            Err(e) => return Err(e),
        }
    }
}
