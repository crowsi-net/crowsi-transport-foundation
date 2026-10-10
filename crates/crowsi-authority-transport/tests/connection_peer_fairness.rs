use crate::support::{SlowProvider, Topology, now};
use crowsi_authority_transport::TransportError;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

#[test]
fn authenticated_a_cannot_fill_every_backend_slot() {
    let topology = Topology::new();
    let (listener, address) = Topology::listener();
    let (entered, observed) = mpsc::sync_channel(1);
    let server = topology.server(
        SlowProvider::new(entered, Duration::from_millis(800)),
        Duration::from_secs(2),
    );
    let stop = Arc::new(AtomicBool::new(false));
    let task_stop = Arc::clone(&stop);
    let server_task = thread::spawn(move || server.serve_until(&listener, 2, &task_stop));
    let first = topology.client_a(&address);
    let first_task =
        thread::spawn(move || first.exchange("provider-operation", b"A1", &"a".repeat(64), now()));
    observed
        .recv_timeout(Duration::from_secs(1))
        .expect("first A entered backend");
    let excess = topology.client_a(&address);
    let excess_task =
        thread::spawn(move || excess.exchange("provider-operation", b"A2", &"c".repeat(64), now()));
    thread::sleep(Duration::from_millis(75));
    let started = Instant::now();
    let b_result = topology
        .client_b(&address)
        .exchange("snapshot", b"B", &"b".repeat(64), now());
    let b_elapsed = started.elapsed();
    let first_result = first_task.join().expect("first A task");
    let excess_result = excess_task.join().expect("excess A task");
    stop.store(true, Ordering::Release);
    server_task.join().expect("server task").expect("server");
    assert_eq!(b_result, Ok(b"device-b:B".to_vec()));
    assert!(b_elapsed < Duration::from_millis(500));
    assert_eq!(first_result, Ok(b"device-a:A1".to_vec()));
    assert_eq!(excess_result, Err(TransportError::Unavailable));
}
