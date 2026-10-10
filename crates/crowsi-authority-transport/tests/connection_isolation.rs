use crate::support::{Echo, SlowProvider, Topology, now};
use crowsi_authority_transport::TransportError;
use ed25519_dalek::SigningKey;
use std::{
    io::Write as _,
    net::TcpStream,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

#[test]
fn slow_a_does_not_block_b() {
    let topology = Topology::new();
    let (listener, address) = Topology::listener();
    let server = topology.server(Echo, Duration::from_millis(800));
    let (stop, task) = serve(server, listener, 2);
    let mut stalled = TcpStream::connect(&address).expect("slow A TCP");
    stalled
        .write_all(b"partial-client-hello")
        .expect("slow bytes");
    thread::sleep(Duration::from_millis(50));
    let started = Instant::now();
    assert_eq!(
        topology
            .client_b(&address)
            .exchange("snapshot", b"B", &"b".repeat(64), now()),
        Ok(b"device-b:B".to_vec())
    );
    assert!(started.elapsed() < Duration::from_millis(500));
    drop(stalled);
    finish(&stop, task);
}

#[test]
fn provider_operation_from_a_does_not_starve_b() {
    let topology = Topology::new();
    let (listener, address) = Topology::listener();
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let server = topology.server(
        SlowProvider::new(entered_tx, Duration::from_millis(700)),
        Duration::from_secs(2),
    );
    let (stop, task) = serve(server, listener, 2);
    let client_a = topology.client_a(&address);
    let operation = thread::spawn(move || {
        client_a.exchange("provider-operation", b"A", &"a".repeat(64), now())
    });
    entered_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("A entered provider");
    let started = Instant::now();
    assert_eq!(
        topology
            .client_b(&address)
            .exchange("snapshot", b"B", &"b".repeat(64), now()),
        Ok(b"device-b:B".to_vec())
    );
    assert!(started.elapsed() < Duration::from_millis(500));
    assert_eq!(
        operation.join().expect("A task"),
        Ok(b"device-a:A".to_vec())
    );
    finish(&stop, task);
}

#[test]
fn configured_concurrent_capacity_is_not_a_lifetime_accept_limit() {
    let topology = Topology::new();
    let (listener, address) = Topology::listener();
    let server = topology.server(Echo, Duration::from_secs(1));
    let (stop, task) = serve(server, listener, 2);
    let client = topology.client_b(&address);
    for value in 1..=5_u64 {
        assert_eq!(
            client.exchange("snapshot", b"B", &format!("{value:064x}"), now()),
            Ok(b"device-b:B".to_vec())
        );
    }
    finish(&stop, task);
}

#[test]
fn listener_continues_after_bad_a() {
    let topology = Topology::new();
    let (listener, address) = Topology::listener();
    let server = topology.server(Echo, Duration::from_secs(1));
    let (stop, task) = serve(server, listener, 2);
    let bad = topology.client_a_with_key(&address, SigningKey::from_bytes(&[99; 32]));
    assert_eq!(
        bad.exchange("snapshot", b"A", &"a".repeat(64), now()),
        Err(TransportError::Unavailable)
    );
    assert_eq!(
        topology
            .client_b(&address)
            .exchange("snapshot", b"B", &"b".repeat(64), now()),
        Ok(b"device-b:B".to_vec())
    );
    finish(&stop, task);
}

#[test]
fn concurrent_capacity_is_closed_and_bounded() {
    let topology = Topology::new();
    let (listener, _) = Topology::listener();
    let server = topology.server(Echo, Duration::from_secs(1));
    let stop = AtomicBool::new(true);
    assert_eq!(
        server.serve_until(&listener, 0, &stop),
        Err(TransportError::Config)
    );
    assert_eq!(
        server.serve_until(&listener, 1, &stop),
        Err(TransportError::Config)
    );
    assert_eq!(
        server.serve_until(&listener, 1_025, &stop),
        Err(TransportError::Config)
    );
}

fn serve<B: crowsi_authority_transport::AuthorityBackend + 'static>(
    server: crowsi_authority_transport::AuthorityServer<B, crate::support::Replay>,
    listener: std::net::TcpListener,
    capacity: usize,
) -> (
    Arc<AtomicBool>,
    thread::JoinHandle<Result<(), TransportError>>,
) {
    let stop = Arc::new(AtomicBool::new(false));
    let task_stop = Arc::clone(&stop);
    let task = thread::spawn(move || server.serve_until(&listener, capacity, &task_stop));
    (stop, task)
}

fn finish(stop: &Arc<AtomicBool>, task: thread::JoinHandle<Result<(), TransportError>>) {
    stop.store(true, Ordering::Release);
    let deadline = Instant::now() + Duration::from_secs(2);
    while !task.is_finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(task.is_finished(), "server ignored finite shutdown");
    task.join().expect("server task").expect("server result");
}
