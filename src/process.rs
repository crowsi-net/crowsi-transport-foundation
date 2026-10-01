//! Non-privileged Linux child ownership. No runtime/model selection or persisted PID authority.
use rustix::process::{Pid, Signal};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::{
    io,
    process::Child,
    thread,
    time::{Duration, Instant},
};

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
    mut guard: impl FnMut() -> io::Result<()>,
) -> io::Result<Vec<u8>> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or(io::ErrorKind::TimedOut)?;
    if maximum > 1024 * 1024 || request.len() > 65536 || remaining > Duration::from_secs(30) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    guard()?;
    let quantum = Duration::from_millis(50);
    let mut stream = std::net::TcpStream::connect_timeout(&address, remaining.min(quantum))?;
    let mut rest = request;
    let mut bytes = Vec::new();
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
                return Ok(bytes);
            }
            Ok(n) if !rest.is_empty() => rest = &rest[n..],
            Ok(n) => {
                if bytes.len() + n > maximum {
                    return Err(io::ErrorKind::InvalidData.into());
                }
                bytes.extend_from_slice(&buffer[..n]);
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
mod tests {
    #[test]
    fn guarded_exchange_bounds_cancellation_deadline_and_output() {
        use super::*;
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").expect("listen");
        let address = listener.local_addr().expect("address");
        let rejected = || Err(io::ErrorKind::PermissionDenied.into());
        assert_eq!(
            guarded_tcp_exchange(
                address,
                b"x",
                100,
                Instant::now() + Duration::from_secs(1),
                rejected
            )
            .expect_err("guard")
            .kind(),
            io::ErrorKind::PermissionDenied
        );
        listener.set_nonblocking(true).expect("mode");
        assert_eq!(
            listener.accept().expect_err("no connection").kind(),
            io::ErrorKind::WouldBlock
        );
        listener.set_nonblocking(false).expect("mode");
        let worker = thread::spawn(move || {
            let (mut client, _) = listener.accept().expect("accept");
            let mut b = [0];
            client.read_exact(&mut b).expect("request");
            thread::sleep(Duration::from_millis(200));
        });
        let start = Instant::now();
        let result =
            guarded_tcp_exchange(address, b"x", 100, start + Duration::from_secs(1), || {
                if start.elapsed() > Duration::from_millis(70) {
                    Err(io::ErrorKind::Interrupted.into())
                } else {
                    Ok(())
                }
            });
        assert_eq!(
            result.expect_err("cancel").kind(),
            io::ErrorKind::Interrupted
        );
        assert!(start.elapsed() < Duration::from_millis(190));
        worker.join().expect("worker");
        assert_eq!(
            guarded_tcp_exchange(address, b"x", 100, Instant::now(), || Ok(()))
                .expect_err("deadline")
                .kind(),
            io::ErrorKind::TimedOut
        );
        let listener = TcpListener::bind("127.0.0.1:0").expect("listen");
        let address = listener.local_addr().expect("address");
        let worker = thread::spawn(move || {
            let (mut client, _) = listener.accept().expect("accept");
            let mut b = [0];
            client.read_exact(&mut b).expect("request");
            client.write_all(&[0; 101]).expect("response");
        });
        assert_eq!(
            guarded_tcp_exchange(
                address,
                b"x",
                100,
                Instant::now() + Duration::from_secs(1),
                || Ok(())
            )
            .expect_err("output bound")
            .kind(),
            io::ErrorKind::InvalidData
        );
        worker.join().expect("worker");
    }
    #[test]
    fn bad_parent_rejected_without_executing_work() {
        // Invalid value rejects before changing the test runner's death signal.
        assert!(super::bind_parent(0).is_err());
        assert!(super::bind_parent(u32::MAX).is_err());
    }
    #[test]
    fn frames_round_trip_and_oversized_header_rejects_before_body() {
        use std::io::Write;
        let (mut a, mut b) = std::os::unix::net::UnixStream::pair().expect("pair");
        super::write_frame(&mut a, b"bounded", 16, std::time::Duration::from_secs(1))
            .expect("write");
        assert_eq!(
            super::read_frame(&mut b, 16, std::time::Duration::from_secs(1)).expect("read"),
            b"bounded"
        );
        a.write_all(&17u32.to_be_bytes()).expect("header");
        assert_eq!(
            super::read_frame(&mut b, 16, std::time::Duration::from_secs(1))
                .expect_err("oversized")
                .kind(),
            std::io::ErrorKind::InvalidData
        );
    }
}
