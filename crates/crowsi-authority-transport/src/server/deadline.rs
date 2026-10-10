use crate::{TransportError, framing};
use rustls::{ServerConnection, StreamOwned};
use std::{
    io::{self, ErrorKind, Read, Write},
    net::TcpStream,
    time::{Duration, Instant},
};

const IO_SLICE: Duration = Duration::from_millis(50);

pub(super) fn handshake(
    connection: &mut ServerConnection,
    tcp: &mut TcpStream,
    timeout: Duration,
) -> Result<(), TransportError> {
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(TransportError::Config)?;
    let slice = timeout.min(IO_SLICE);
    tcp.set_read_timeout(Some(slice))
        .map_err(|_| TransportError::Unavailable)?;
    tcp.set_write_timeout(Some(slice))
        .map_err(|_| TransportError::Unavailable)?;
    while connection.is_handshaking() {
        if Instant::now() >= deadline {
            return Err(TransportError::Timeout);
        }
        match connection.complete_io(tcp) {
            Ok(_) => {}
            Err(error) if timed_out(&error) => {}
            Err(_) => return Err(TransportError::Peer),
        }
    }
    if Instant::now() >= deadline {
        Err(TransportError::Timeout)
    } else {
        Ok(())
    }
}

pub(super) fn read_frame(
    stream: &mut StreamOwned<ServerConnection, TcpStream>,
    timeout: Duration,
) -> Result<Vec<u8>, TransportError> {
    framing::read(&mut DeadlineIo::new(stream, timeout)?)
}

pub(super) fn write_frame(
    stream: &mut StreamOwned<ServerConnection, TcpStream>,
    value: &[u8],
    timeout: Duration,
) -> Result<(), TransportError> {
    framing::write(&mut DeadlineIo::new(stream, timeout)?, value)
}

struct DeadlineIo<'a, T> {
    inner: &'a mut T,
    deadline: Instant,
}

impl<'a, T> DeadlineIo<'a, T> {
    fn new(inner: &'a mut T, timeout: Duration) -> Result<Self, TransportError> {
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or(TransportError::Config)?;
        Ok(Self { inner, deadline })
    }

    fn expired(&self) -> io::Result<()> {
        if Instant::now() >= self.deadline {
            Err(io::Error::new(
                ErrorKind::TimedOut,
                "authority transport deadline",
            ))
        } else {
            Ok(())
        }
    }
}

impl<T: Read> Read for DeadlineIo<'_, T> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        loop {
            self.expired()?;
            match self.inner.read(output) {
                Err(error) if timed_out(&error) => {}
                value => return value,
            }
        }
    }
}

impl<T: Write> Write for DeadlineIo<'_, T> {
    fn write(&mut self, input: &[u8]) -> io::Result<usize> {
        loop {
            self.expired()?;
            match self.inner.write(input) {
                Err(error) if timed_out(&error) => {}
                value => return value,
            }
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        self.expired()?;
        self.inner.flush()
    }
}

fn timed_out(error: &io::Error) -> bool {
    matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock)
}
