//! Cancellation-safe bounded IO; no detached worker or automatic replay.
use crate::{Connection, Decoder, DeliveryReceipt, Frame, Limits, MessageSequence, Outcome};
use std::{
    io::Write,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{Mutex, Semaphore},
};

pub struct Reader<R> {
    reader: BufReader<R>,
    pub decoder: Decoder,
    pub connection: Connection,
    eof: bool,
}
impl<R: AsyncRead + Unpin> Reader<R> {
    pub fn new(reader: R, limits: Limits, connection: Connection) -> Result<Self, Outcome> {
        Ok(Self {
            reader: BufReader::with_capacity(8192, reader),
            decoder: Decoder::new(limits)?,
            connection,
            eof: false,
        })
    }
    pub async fn next_frame(&mut self) -> Result<Option<Frame>, Outcome> {
        self.connection.ensure_open()?;
        if self.eof {
            self.connection.close();
            return Ok(None);
        }
        loop {
            let chunk = match self.reader.fill_buf().await {
                Ok(c) => c,
                Err(_) => {
                    self.connection.fail();
                    return Err(Outcome::ConnectionFailed);
                }
            };
            if chunk.is_empty() {
                self.eof = true;
                let frame = self
                    .decoder
                    .finish()
                    .inspect_err(|_| self.connection.fail());
                if matches!(frame, Ok(None)) {
                    self.connection.close();
                }
                return frame;
            }
            let (n, frame) = match self.decoder.feed(chunk) {
                Ok(v) => v,
                Err(e) => {
                    self.connection.fail();
                    return Err(e);
                }
            };
            self.reader.consume(n);
            if frame.is_some() {
                return Ok(frame);
            }
        }
    }
}
pub struct Writer<W> {
    writer: Mutex<W>,
    limits: Limits,
    slots: Semaphore,
    bytes: Semaphore,
    connection: Connection,
    failed: AtomicBool,
    sequence: AtomicU64,
    timeout: Duration,
}
impl<W: AsyncWrite + Unpin> Writer<W> {
    pub fn new(
        writer: W,
        limits: Limits,
        connection: Connection,
        timeout: Duration,
    ) -> Result<Self, Outcome> {
        let limits = limits.validate()?;
        if timeout.is_zero() {
            return Err(Outcome::ProtocolViolation);
        }
        Ok(Self {
            writer: Mutex::new(writer),
            limits,
            slots: Semaphore::new(limits.pending_messages),
            bytes: Semaphore::new(limits.pending_bytes),
            connection,
            failed: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            timeout,
        })
    }
    pub async fn send(
        &self,
        encode: impl FnOnce(&mut dyn Write) -> std::io::Result<()>,
    ) -> Result<DeliveryReceipt, Outcome> {
        self.connection.ensure_open()?;
        let _slot = self
            .slots
            .try_acquire()
            .map_err(|_| Outcome::Backpressure)?;
        // Reserve a whole bounded serialization frame BEFORE allocation, including waiters.
        let _bytes = self
            .bytes
            .try_acquire_many(self.limits.frame as u32)
            .map_err(|_| Outcome::Backpressure)?;
        let mut buffer = LimitedBuffer {
            bytes: Vec::with_capacity(self.limits.frame),
            limit: self.limits.accepted,
            overflow: false,
        };
        let encoded = encode(&mut buffer);
        if buffer.overflow {
            return Err(Outcome::InputTooLarge);
        }
        encoded.map_err(|_| Outcome::ProtocolViolation)?;
        buffer.bytes.push(b'\n');
        let mut writer = tokio::time::timeout(self.timeout, self.writer.lock())
            .await
            .map_err(|_| Outcome::Timeout)?;
        self.connection.ensure_open()?;
        if self.failed.load(Ordering::Relaxed) {
            return Err(Outcome::ConnectionFailed);
        }
        let sequence = self
            .sequence
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
            .map_err(|_| Outcome::SequenceExhausted)?
            + 1;
        // Dropping this future during write must poison the stream, never append to a partial frame.
        let mut guard = WriteGuard {
            failed: &self.failed,
            connection: &self.connection,
            complete: false,
        };
        match tokio::time::timeout(self.timeout, async {
            writer.write_all(&buffer.bytes).await?;
            writer.flush().await
        })
        .await
        {
            Ok(Ok(())) => {
                guard.complete = true;
                Ok(DeliveryReceipt {
                    connection: self.connection.id,
                    sequence: MessageSequence(sequence),
                    bytes: buffer.bytes.len(),
                })
            }
            Ok(Err(_)) => Err(Outcome::ConnectionFailed),
            Err(_) => Err(Outcome::Timeout),
        }
    }
}
struct WriteGuard<'a> {
    failed: &'a AtomicBool,
    connection: &'a Connection,
    complete: bool,
}
impl Drop for WriteGuard<'_> {
    fn drop(&mut self) {
        if !self.complete {
            self.failed.store(true, Ordering::Relaxed);
            self.connection.fail()
        }
    }
}
struct LimitedBuffer {
    bytes: Vec<u8>,
    limit: usize,
    overflow: bool,
}
impl Write for LimitedBuffer {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        if b.len() > self.limit - self.bytes.len() {
            self.overflow = true;
            return Err(std::io::Error::other(Outcome::InputTooLarge));
        }
        self.bytes.extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
