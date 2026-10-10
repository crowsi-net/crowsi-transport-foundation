use crowsi_transport_foundation::*;
#[cfg(feature = "async-io")]
use std::{
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    task::{Context, Poll},
    time::Duration,
};
#[cfg(feature = "async-io")]
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt, ReadBuf};
fn limits(n: usize) -> Limits {
    Limits {
        accepted: n,
        buffered: n + 1,
        frame: n + 2,
        pending_bytes: 4 * (n + 2),
        pending_messages: 2,
    }
}
fn connection() -> Connection {
    let c = Connection::new().unwrap();
    c.open().unwrap();
    c
}

#[test]
fn boundaries_chunks_utf8_and_fail_closed() {
    for n in [0, 1, 15, 16, 17, 65536] {
        let mut d = Decoder::new(limits(16)).unwrap();
        let input = vec![b'x'; n];
        let result = d.feed(&input);
        if n > 16 {
            assert_eq!(result.unwrap_err(), Outcome::InputTooLarge);
            assert!(d.metrics.bytes_consumed <= 17);
            assert_eq!(d.finish().unwrap_err(), Outcome::ConnectionFailed)
        } else {
            assert!(result.is_ok());
            let (_, f) = d.feed(b"\n").unwrap();
            assert_eq!(f.unwrap().payload.len(), n)
        }
        assert!(d.metrics.high_water <= 16);
        assert_eq!(d.metrics.allocation_capacity, 17);
    }
    let mut d = Decoder::new(limits(6)).unwrap();
    let data = "日本\r\nx\n".as_bytes();
    let mut offset = 0;
    let mut frames = vec![];
    while offset < data.len() {
        let (n, f) = d.feed(&data[offset..]).unwrap();
        offset += n;
        if let Some(f) = f {
            frames.push(f.payload)
        }
    }
    assert_eq!(frames, ["日本".as_bytes(), b"x"]);
    let mut d = Decoder::new(limits(6)).unwrap();
    for byte in "日本".as_bytes() {
        assert!(d.feed(&[*byte]).unwrap().1.is_none())
    }
    assert_eq!(d.finish().unwrap().unwrap().payload, "日本".as_bytes());
    let mut d = Decoder::new(limits(6)).unwrap();
    assert_eq!(
        d.feed("日本a".as_bytes()).unwrap_err(),
        Outcome::InputTooLarge
    );
    let mut invalid = limits(6);
    invalid.frame = 6;
    assert!(Decoder::new(invalid).is_err());
}
#[test]
fn identity_rebind_does_not_mutate_application_authority() {
    let references = (
        "operation-41",
        "revision-8",
        "grant-7",
        "invocation-4",
        "provider-3",
        "worker-2",
        "commit-19",
    );
    let first = connection();
    let mut session = LogicalSession::new().unwrap();
    let identity = session.id;
    session.bind(first.clone()).unwrap();
    assert_eq!(session.next_sequence().unwrap(), MessageSequence(1));
    let second = connection();
    assert_ne!(first.id, second.id);
    assert_eq!(
        session.bind(second.clone()),
        Err(Outcome::ProtocolViolation)
    );
    first.fail();
    assert!(first.open().is_err());
    first.close();
    first.close();
    assert_eq!(first.state(), State::Closed);
    session.bind(second.clone()).unwrap();
    assert_eq!(session.id, identity);
    assert_eq!(session.next_sequence().unwrap(), MessageSequence(2));
    assert_eq!(
        references,
        (
            "operation-41",
            "revision-8",
            "grant-7",
            "invocation-4",
            "provider-3",
            "worker-2",
            "commit-19"
        )
    );
    let receipt = DeliveryReceipt {
        connection: second.id,
        sequence: MessageSequence(2),
        bytes: 5,
    };
    assert_ne!(
        std::any::type_name_of_val(&receipt),
        std::any::type_name_of_val(&references.6)
    );
}
#[cfg(feature = "async-io")]
struct Huge {
    read: Arc<AtomicUsize>,
}
#[cfg(feature = "async-io")]
impl AsyncRead for Huge {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let n = buf.remaining().min(8192);
        buf.put_slice(&[b'x'; 8192][..n]);
        self.read.fetch_add(n, Ordering::Relaxed);
        Poll::Ready(Ok(()))
    }
}
#[cfg(feature = "async-io")]
#[tokio::test]
async fn actual_reader_stops_at_bound_and_eof_is_not_replay() {
    let count = Arc::new(AtomicUsize::new(0));
    let c = connection();
    let mut reader = io::Reader::new(
        Huge {
            read: count.clone(),
        },
        Limits::default(),
        c.clone(),
    )
    .unwrap();
    assert_eq!(
        reader.next_frame().await.unwrap_err(),
        Outcome::InputTooLarge
    );
    assert!(count.load(Ordering::Relaxed) <= 1048576 + 8192);
    assert_eq!(reader.decoder.metrics.high_water, 1048576);
    assert_eq!(reader.decoder.metrics.allocation_capacity, 1048577);
    println!(
        "read={} high_water={} capacity={}",
        count.load(Ordering::Relaxed),
        reader.decoder.metrics.high_water,
        reader.decoder.metrics.allocation_capacity
    );
    assert_eq!(c.state(), State::Failed);
    assert_eq!(
        reader.next_frame().await.unwrap_err(),
        Outcome::ConnectionFailed
    );
    let c = connection();
    let mut r = io::Reader::new(&b"a\nb"[..], limits(8), c.clone()).unwrap();
    assert_eq!(r.next_frame().await.unwrap().unwrap().payload, b"a");
    assert_eq!(r.next_frame().await.unwrap().unwrap().payload, b"b");
    assert!(r.next_frame().await.unwrap().is_none());
    assert_eq!(c.state(), State::Closed);
    c.close();
    assert_eq!(r.next_frame().await.unwrap_err(), Outcome::ConnectionClosed);
}

#[cfg(feature = "async-io")]
struct Broken(bool);
#[cfg(feature = "async-io")]
impl AsyncRead for Broken {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if self.0 {
            Poll::Ready(Err(std::io::Error::other("private failure")))
        } else {
            self.0 = true;
            buf.put_slice(b"x");
            Poll::Ready(Ok(()))
        }
    }
}
#[cfg(feature = "async-io")]
impl tokio::io::AsyncWrite for Broken {
    fn poll_write(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
        _: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        if self.0 {
            Poll::Ready(Err(std::io::Error::other("private failure")))
        } else {
            self.0 = true;
            Poll::Ready(Ok(1))
        }
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}
#[cfg(feature = "async-io")]
#[tokio::test]
async fn partial_io_failure_is_terminal_without_exposing_io_text() {
    let c = connection();
    let mut reader = io::Reader::new(Broken(false), limits(8), c.clone()).unwrap();
    assert_eq!(
        reader.next_frame().await.unwrap_err(),
        Outcome::ConnectionFailed
    );
    assert_eq!(c.state(), State::Failed);
    assert_eq!(reader.decoder.metrics.high_water, 1);
    let c = connection();
    let writer =
        io::Writer::new(Broken(false), limits(8), c.clone(), Duration::from_secs(1)).unwrap();
    assert_eq!(
        writer.send(|w| w.write_all(b"ab")).await.unwrap_err(),
        Outcome::ConnectionFailed
    );
    assert_eq!(
        writer.send(|w| w.write_all(b"no retry")).await.unwrap_err(),
        Outcome::ConnectionFailed
    );
    assert_eq!(c.state(), State::Failed);
}
#[cfg(feature = "async-io")]
#[tokio::test]
async fn bounded_output_pressure_drain_timeout_and_cancel() {
    let (tx, mut rx) = tokio::io::duplex(1);
    let c = connection();
    let writer =
        Arc::new(io::Writer::new(tx, limits(16), c.clone(), Duration::from_millis(200)).unwrap());
    let a = writer.clone();
    let first = tokio::spawn(async move { a.send(|w| w.write_all(b"one")).await });
    tokio::task::yield_now().await;
    let b = writer.clone();
    let second = tokio::spawn(async move { b.send(|w| w.write_all(b"two")).await });
    tokio::task::yield_now().await;
    assert_eq!(
        writer.send(|w| w.write_all(b"overflow")).await.unwrap_err(),
        Outcome::Backpressure
    );
    let mut out = [0u8; 8];
    rx.read_exact(&mut out).await.unwrap();
    assert_eq!(&out, b"one\ntwo\n");
    assert_eq!(first.await.unwrap().unwrap().sequence, MessageSequence(1));
    assert_eq!(second.await.unwrap().unwrap().sequence, MessageSequence(2));
    assert_eq!(
        writer.send(|w| w.write_all(&[b'x'; 17])).await.unwrap_err(),
        Outcome::InputTooLarge
    );
    let a = writer.clone();
    let third = tokio::spawn(async move { a.send(|w| w.write_all(b"ok")).await });
    let mut out = [0; 3];
    rx.read_exact(&mut out).await.unwrap();
    assert!(third.await.unwrap().is_ok());
    assert_eq!(
        writer.send(|w| w.write_all(b"timeout")).await.unwrap_err(),
        Outcome::Timeout
    );
    assert_eq!(c.state(), State::Failed);
    assert_eq!(
        writer.send(|w| w.write_all(b"no retry")).await.unwrap_err(),
        Outcome::ConnectionFailed
    );
    c.close();
    assert_eq!(
        writer.send(|_| Ok(())).await.unwrap_err(),
        Outcome::ConnectionClosed
    );
    let (tx, _rx) = tokio::io::duplex(1);
    let c = connection();
    let writer =
        Arc::new(io::Writer::new(tx, limits(8), c.clone(), Duration::from_secs(1)).unwrap());
    let a = writer.clone();
    let task = tokio::spawn(async move { a.send(|w| w.write_all(b"partial")).await });
    tokio::task::yield_now().await;
    task.abort();
    assert!(task.await.is_err());
    assert_eq!(c.state(), State::Failed);
    // Reader error after a prefix is transport failure, not a second application frame.
    let (mut tx, rx) = tokio::io::duplex(16);
    tx.write_all(b"short").await.unwrap();
    drop(tx);
    let c = connection();
    let mut r = io::Reader::new(rx, limits(8), c).unwrap();
    assert_eq!(r.next_frame().await.unwrap().unwrap().payload, b"short");
}
