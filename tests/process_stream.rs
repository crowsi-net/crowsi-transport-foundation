#![cfg(all(target_os = "linux", feature = "process"))]
use crowsi_transport_foundation::process::guarded_tcp_stream;
use std::{
    io::{self, Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[test]
fn first_chunk_is_delivered_before_eof_and_receiver_applies_backpressure() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listen");
    let address = listener.local_addr().expect("address");
    let (tx, rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept");
        let mut request = [0; 4];
        socket.read_exact(&mut request).expect("request");
        assert_eq!(&request, b"once");
        socket.write_all(b"first").expect("first");
        rx.recv_timeout(Duration::from_secs(2))
            .expect("consumer before EOF");
        socket.write_all(b"last").expect("last");
    });
    let mut delivered = Vec::new();
    guarded_tcp_stream(
        address,
        b"once",
        9,
        Instant::now() + Duration::from_secs(3),
        || Ok(()),
        |chunk| {
            delivered.extend_from_slice(chunk);
            if delivered == b"first" {
                tx.send(()).expect("ack");
            }
            Ok(())
        },
    )
    .expect("delivery");
    assert_eq!(delivered, b"firstlast");
    worker.join().expect("worker");
}

fn response_error(maximum: usize, abort: bool) -> io::ErrorKind {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listen");
    let address = listener.local_addr().expect("address");
    let worker = thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept");
        let mut request = [0];
        socket.read_exact(&mut request).expect("request");
        socket.write_all(b"oversized").expect("response");
    });
    let error = guarded_tcp_stream(
        address,
        b"x",
        maximum,
        Instant::now() + Duration::from_secs(2),
        || Ok(()),
        |_| {
            if abort {
                Err(io::ErrorKind::PermissionDenied.into())
            } else {
                Ok(())
            }
        },
    )
    .expect_err("reject");
    worker.join().expect("worker");
    error.kind()
}

#[test]
fn rejects_total_limit_and_propagates_receiver_abort() {
    assert_eq!(response_error(2, false), io::ErrorKind::InvalidData);
    assert_eq!(response_error(100, true), io::ErrorKind::PermissionDenied);
}

#[test]
fn cancellation_before_connect_has_no_delivery() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listen");
    listener.set_nonblocking(true).expect("nonblocking");
    let error = guarded_tcp_stream(
        listener.local_addr().expect("address"),
        b"x",
        10,
        Instant::now() + Duration::from_secs(1),
        || Err(io::ErrorKind::Interrupted.into()),
        |_| panic!("must not receive"),
    )
    .expect_err("cancelled");
    assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    assert_eq!(
        listener.accept().expect_err("no connect").kind(),
        io::ErrorKind::WouldBlock
    );
}

#[test]
fn slow_receiver_cannot_turn_expired_deadline_into_success() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listen");
    let address = listener.local_addr().expect("address");
    let worker = thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept");
        let mut request = [0];
        socket.read_exact(&mut request).expect("request");
        socket.write_all(b"x").expect("response");
    });
    let error = guarded_tcp_stream(
        address,
        b"x",
        10,
        Instant::now() + Duration::from_millis(100),
        || Ok(()),
        |_| {
            thread::sleep(Duration::from_millis(150));
            Ok(())
        },
    )
    .expect_err("expired");
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    worker.join().expect("worker");
}
