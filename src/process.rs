//! Non-privileged Linux child ownership. No runtime/model selection or persisted PID authority.
use rustix::process::{Pid, Signal};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
mod stream;
use std::{
    io,
    process::Child,
    thread,
    time::{Duration, Instant},
};
pub use stream::guarded_tcp_stream;

/// Bounded local frame with a whole-frame deadline, including partial reads.
pub fn read_frame(
    stream: &mut UnixStream,
    maximum: usize,
    timeout: Duration,
) -> io::Result<Vec<u8>> {
    if maximum > 1024 * 1024 || timeout > Duration::from_secs(60) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let end = Instant::now() + timeout;
    let mut length = [0; 4];
    read_until(stream, &mut length, end)?;
    let count = u32::from_be_bytes(length) as usize;
    if count > maximum {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut bytes = vec![0; count];
    read_until(stream, &mut bytes, end)?;
    Ok(bytes)
}
fn read_until(stream: &mut UnixStream, mut bytes: &mut [u8], end: Instant) -> io::Result<()> {
    while !bytes.is_empty() {
        stream.set_read_timeout(Some(
            end.checked_duration_since(Instant::now())
                .ok_or(io::ErrorKind::TimedOut)?,
        ))?;
        let n = stream.read(bytes)?;
        if n == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        bytes = &mut bytes[n..];
    }
    Ok(())
}
pub fn write_frame(
    stream: &mut UnixStream,
    bytes: &[u8],
    maximum: usize,
    timeout: Duration,
) -> io::Result<()> {
    if bytes.len() > maximum || maximum > 1024 * 1024 || timeout > Duration::from_secs(60) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let size = u32::try_from(bytes.len()).map_err(|_| io::ErrorKind::InvalidInput)?;
    let mut framed = size.to_be_bytes().to_vec();
    framed.extend_from_slice(bytes);
    let end = Instant::now() + timeout;
    let mut rest = framed.as_slice();
    while !rest.is_empty() {
        stream.set_write_timeout(Some(
            end.checked_duration_since(Instant::now())
                .ok_or(io::ErrorKind::TimedOut)?,
        ))?;
        let n = stream.write(rest)?;
        if n == 0 {
            return Err(io::ErrorKind::WriteZero.into());
        }
        rest = &rest[n..];
    }
    Ok(())
}

/// Owner-selected address and bytes. This mechanism has no HTTP/model knowledge.
pub fn tcp_exchange(
    address: std::net::SocketAddr,
    request: &[u8],
    maximum: usize,
    timeout: Duration,
) -> io::Result<Vec<u8>> {
    if maximum > 1024 * 1024 || request.len() > 65536 || timeout > Duration::from_secs(5) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let end = Instant::now() + timeout;
    let mut stream = std::net::TcpStream::connect_timeout(&address, timeout)?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(request)?;
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        stream.set_read_timeout(Some(
            end.checked_duration_since(Instant::now())
                .ok_or(io::ErrorKind::TimedOut)?,
        ))?;
        let n = stream.read(&mut buffer)?;
        if n == 0 {
            return Ok(bytes);
        }
        if bytes.len() + n > maximum {
            return Err(io::ErrorKind::InvalidData.into());
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
}

/// A single exchange with a caller-owned cancellation/generation guard. No
/// reconnect or retry of request bytes; dropping the socket ends delivery.
/// The guard is checked before connecting and at least every 50 ms of I/O wait.
pub fn guarded_tcp_exchange(
    address: std::net::SocketAddr,
    request: &[u8],
    maximum: usize,
    deadline: Instant,
    guard: impl FnMut() -> io::Result<()>,
) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    guarded_tcp_stream(address, request, maximum, deadline, guard, |chunk| {
        bytes.extend_from_slice(chunk);
        Ok(())
    })?;
    Ok(bytes)
}

/// Called by the child before executing work. Arm first, then check the parent:
/// if the owner died between spawn and prctl the child exits without executing.
/// The spawning owner thread must live as long as its child (Linux task semantics).
pub fn bind_parent(expected: u32) -> io::Result<()> {
    let expected = Pid::from_raw(i32::try_from(expected).map_err(|_| io::ErrorKind::InvalidInput)?)
        .ok_or(io::ErrorKind::InvalidInput)?;
    rustix::process::set_parent_process_death_signal(Some(Signal::KILL))?;
    if rustix::process::getppid() != Some(expected) {
        return Err(io::ErrorKind::ConnectionAborted.into());
    }
    Ok(())
}

/// The supplied Child must own a dedicated process group, never a restored PID.
/// Keep the leader unreaped until the final group signal, preventing PID reuse.
pub fn terminate(child: &mut Child, grace: Duration) -> io::Result<()> {
    if grace > Duration::from_secs(5) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let pid = Pid::from_raw(i32::try_from(child.id()).map_err(|_| io::ErrorKind::InvalidInput)?)
        .ok_or(io::ErrorKind::InvalidInput)?;
    signal(pid, Signal::TERM)?;
    let end = Instant::now() + grace;
    // Do not try_wait here: it reaps the group leader before the final signal.
    while Instant::now() < end {
        thread::sleep(Duration::from_millis(10));
    }
    signal(pid, Signal::KILL)?;
    child.wait()?;
    Ok(())
}
fn signal(pid: Pid, signal: Signal) -> io::Result<()> {
    match rustix::process::kill_process_group(pid, signal) {
        Ok(()) | Err(rustix::io::Errno::SRCH) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests;
