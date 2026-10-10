#![doc = include_str!("../README.crate.md")]
//! Owner-neutral bounded transport. Delivery never authorizes or confirms an effect.
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};

#[cfg(feature = "async-io")]
pub mod io;

#[cfg(feature = "http-contract")]
pub mod http;

#[cfg(feature = "loopback-http")]
pub mod loopback_http;

#[cfg(all(target_os = "linux", feature = "process"))]
pub mod process;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    InputTooLarge,
    FrameTooLarge,
    Backpressure,
    ConnectionClosed,
    ConnectionFailed,
    ProtocolViolation,
    MalformedFrame,
    Timeout,
    SequenceExhausted,
}
impl std::fmt::Display for Outcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for Outcome {}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub accepted: usize,
    pub buffered: usize,
    pub frame: usize,
    pub pending_bytes: usize,
    pub pending_messages: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            accepted: 1 << 20,
            buffered: (1 << 20) + 1,
            frame: (1 << 20) + 2,
            pending_bytes: 4 * ((1 << 20) + 2),
            pending_messages: 64,
        }
    }
}
impl Limits {
    pub fn validate(self) -> Result<Self, Outcome> {
        if self.accepted == 0
            || self.accepted > 16 << 20
            || self.buffered != self.accepted + 1
            || self.frame != self.accepted + 2
            || self.pending_bytes < self.frame
            || self.pending_bytes > 64 << 20
            || self.pending_messages == 0
            || self.pending_messages > 128
        {
            return Err(Outcome::ProtocolViolation);
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectionId(u64);
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionId(u64);
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct MessageSequence(pub u64);
static IDS: AtomicU64 = AtomicU64::new(1);
fn identity() -> Result<u64, Outcome> {
    IDS.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
        .map_err(|_| Outcome::SequenceExhausted)
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Created,
    Opening,
    Open,
    Closing,
    Closed,
    Failed,
}
#[derive(Debug, Clone)]
pub struct Connection {
    pub id: ConnectionId,
    state: Arc<Mutex<State>>,
}
impl Connection {
    pub fn new() -> Result<Self, Outcome> {
        Ok(Self {
            id: ConnectionId(identity()?),
            state: Arc::new(Mutex::new(State::Created)),
        })
    }
    pub fn state(&self) -> State {
        *self.state.lock().expect("transport state lock")
    }
    pub fn open(&self) -> Result<(), Outcome> {
        let mut s = self.state.lock().expect("transport state lock");
        if *s != State::Created {
            return Err(Outcome::ProtocolViolation);
        }
        *s = State::Opening;
        *s = State::Open;
        Ok(())
    }
    pub fn ensure_open(&self) -> Result<(), Outcome> {
        match self.state() {
            State::Open => Ok(()),
            State::Failed => Err(Outcome::ConnectionFailed),
            _ => Err(Outcome::ConnectionClosed),
        }
    }
    pub fn fail(&self) {
        let mut s = self.state.lock().expect("transport state lock");
        if *s != State::Closed {
            *s = State::Failed
        }
    }
    pub fn close(&self) {
        let mut s = self.state.lock().expect("transport state lock");
        if *s != State::Closed {
            *s = State::Closing;
            *s = State::Closed
        }
    }
}
#[derive(Debug)]
pub struct LogicalSession {
    pub id: SessionId,
    connection: Option<Connection>,
    sequence: u64,
}
impl LogicalSession {
    pub fn new() -> Result<Self, Outcome> {
        Ok(Self {
            id: SessionId(identity()?),
            connection: None,
            sequence: 0,
        })
    }
    pub fn bind(&mut self, connection: Connection) -> Result<(), Outcome> {
        connection.ensure_open()?;
        if self
            .connection
            .as_ref()
            .is_some_and(|c| !matches!(c.state(), State::Closed | State::Failed))
        {
            return Err(Outcome::ProtocolViolation);
        }
        self.connection = Some(connection);
        Ok(())
    }
    pub fn next_sequence(&mut self) -> Result<MessageSequence, Outcome> {
        self.connection
            .as_ref()
            .ok_or(Outcome::ConnectionClosed)?
            .ensure_open()?;
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or(Outcome::SequenceExhausted)?;
        Ok(MessageSequence(self.sequence))
    }
}
/// Local write completion only; not a peer acknowledgement or any application receipt.
#[derive(Debug, PartialEq, Eq)]
pub struct DeliveryReceipt {
    pub connection: ConnectionId,
    pub sequence: MessageSequence,
    pub bytes: usize,
}
#[derive(Debug)]
pub struct Frame {
    pub payload: Vec<u8>,
    pub wire_bytes: usize,
}
#[derive(Debug, Default, Clone, Copy)]
pub struct Metrics {
    pub bytes_consumed: u64,
    pub high_water: usize,
    pub allocation_capacity: usize,
}
pub struct Decoder {
    limits: Limits,
    buffer: Vec<u8>,
    pub metrics: Metrics,
    failed: bool,
}
impl Decoder {
    pub fn new(limits: Limits) -> Result<Self, Outcome> {
        let limits = limits.validate()?;
        let buffer = Vec::with_capacity(limits.buffered);
        let metrics = Metrics {
            allocation_capacity: buffer.capacity(),
            ..Metrics::default()
        };
        Ok(Self {
            limits,
            buffer,
            metrics,
            failed: false,
        })
    }
    /// Consumes at most through one delimiter; caller retains the unconsumed slice.
    pub fn feed(&mut self, input: &[u8]) -> Result<(usize, Option<Frame>), Outcome> {
        if self.failed {
            return Err(Outcome::ConnectionFailed);
        }
        for (i, &byte) in input.iter().enumerate() {
            self.metrics.bytes_consumed += 1;
            if byte == b'\n' {
                let frame = self.take(true)?;
                return Ok((i + 1, Some(frame)));
            }
            let n = self.buffer.len();
            if n >= self.limits.accepted && !(n == self.limits.accepted && byte == b'\r') {
                self.failed = true;
                return Err(Outcome::InputTooLarge);
            }
            self.buffer.push(byte);
            self.metrics.high_water = self.metrics.high_water.max(self.buffer.len());
        }
        Ok((input.len(), None))
    }
    fn take(&mut self, delimited: bool) -> Result<Frame, Outcome> {
        let wire_bytes = self.buffer.len() + usize::from(delimited);
        if wire_bytes > self.limits.frame {
            self.failed = true;
            return Err(Outcome::FrameTooLarge);
        }
        if delimited && self.buffer.last() == Some(&b'\r') {
            self.buffer.pop();
        }
        if self.buffer.len() > self.limits.accepted {
            self.failed = true;
            return Err(Outcome::InputTooLarge);
        }
        let payload = std::mem::replace(&mut self.buffer, Vec::with_capacity(self.limits.buffered));
        Ok(Frame {
            payload,
            wire_bytes,
        })
    }
    pub fn finish(&mut self) -> Result<Option<Frame>, Outcome> {
        if self.failed {
            return Err(Outcome::ConnectionFailed);
        }
        if self.buffer.is_empty() {
            Ok(None)
        } else {
            self.take(false).map(Some)
        }
    }
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test]
    fn sequence_exhaustion_never_reuses() {
        let c = Connection::new().unwrap();
        c.open().unwrap();
        let mut s = LogicalSession::new().unwrap();
        s.bind(c).unwrap();
        s.sequence = u64::MAX;
        assert_eq!(s.next_sequence(), Err(Outcome::SequenceExhausted));
        assert_eq!(s.next_sequence(), Err(Outcome::SequenceExhausted));
    }
}
