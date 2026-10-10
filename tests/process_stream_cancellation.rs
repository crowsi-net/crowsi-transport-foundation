#![cfg(all(target_os = "linux", feature = "process"))]
use crowsi_transport_foundation::process::guarded_tcp_stream;
use std::{
    io::{self, Read, Write},
    net::TcpListener,
    thread,
    time::{Duration, Instant},
};

#[test]
fn cancellation_after_first_chunk_closes_the_socket_without_retry() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listen");
    let address = listener.local_addr().expect("address");
    let worker = thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept");
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("timeout");
        let mut request = [0];
        socket.read_exact(&mut request).expect("request");
        socket.write_all(b"x").expect("response");
        assert_eq!(socket.read(&mut request).expect("socket closed"), 0);
        listener.set_nonblocking(true).expect("mode");
        assert_eq!(
            listener.accept().expect_err("no retry").kind(),
            io::ErrorKind::WouldBlock
        );
    });
    let cancelled = std::cell::Cell::new(false);
    let error = guarded_tcp_stream(
        address,
        b"x",
        10,
        Instant::now() + Duration::from_secs(3),
        || {
            if cancelled.get() {
                Err(io::ErrorKind::Interrupted.into())
            } else {
                Ok(())
            }
        },
        |_| {
            cancelled.set(true);
            Ok(())
        },
    )
    .expect_err("cancelled");
    assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    worker.join().expect("worker");
}
