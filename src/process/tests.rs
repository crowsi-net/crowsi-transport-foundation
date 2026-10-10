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
    let result = guarded_tcp_exchange(address, b"x", 100, start + Duration::from_secs(1), || {
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
    super::write_frame(&mut a, b"bounded", 16, std::time::Duration::from_secs(1)).expect("write");
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
