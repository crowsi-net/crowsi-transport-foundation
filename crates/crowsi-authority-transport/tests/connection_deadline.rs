use crate::support::{Echo, Topology, now};
use crowsi_authority_transport::TransportError;
use std::{
    net::TcpStream,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

#[test]
fn handshake_deadline_releases_capacity_for_b() {
    let topology = Topology::new();
    let (listener, address) = Topology::listener();
    let server = topology.server(Echo, Duration::from_millis(150));
    let stop = Arc::new(AtomicBool::new(false));
    let task_stop = Arc::clone(&stop);
    let task = thread::spawn(move || server.serve_until(&listener, 2, &task_stop));
    let stalled_a = TcpStream::connect(&address).expect("stalled handshake A");
    let stalled_b = TcpStream::connect(&address).expect("stalled handshake B");
    thread::sleep(Duration::from_millis(30));
    let started = Instant::now();
    assert_eq!(
        topology
            .client_b(&address)
            .exchange("snapshot", b"B", &"b".repeat(64), now()),
        Ok(b"device-b:B".to_vec())
    );
    assert!(started.elapsed() < Duration::from_millis(700));
    drop((stalled_a, stalled_b));
    stop.store(true, Ordering::Release);
    join_finite(task);
}

fn join_finite(task: thread::JoinHandle<Result<(), TransportError>>) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !task.is_finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(task.is_finished(), "server ignored finite shutdown");
    task.join().expect("server task").expect("server result");
}
