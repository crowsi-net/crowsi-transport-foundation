use crate::support::{Topology, now};
use crowsi_authority_transport::{AuthorityBackend, SignedRequest, TransportError};
use std::{
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

struct Gate {
    state: Mutex<State>,
    opened: Condvar,
    entered: mpsc::Sender<()>,
}

#[derive(Default)]
struct State {
    active: usize,
    peak: usize,
    released: bool,
}

#[derive(Clone)]
struct Gated(Arc<Gate>);

impl AuthorityBackend for Gated {
    fn handle(&self, request: &SignedRequest) -> Result<Vec<u8>, TransportError> {
        let mut state = self
            .0
            .state
            .lock()
            .map_err(|_| TransportError::Unavailable)?;
        state.active += 1;
        state.peak = state.peak.max(state.active);
        self.0
            .entered
            .send(())
            .map_err(|_| TransportError::Unavailable)?;
        while !state.released {
            state = self
                .0
                .opened
                .wait(state)
                .map_err(|_| TransportError::Unavailable)?;
        }
        state.active -= 1;
        Ok([request.peer.device_id.as_bytes(), b":", &request.payload].concat())
    }
}

#[test]
fn configured_capacity_bounds_workers_not_lifetime_accepts() {
    let topology = Topology::new();
    let (listener, address) = Topology::listener();
    let (entered, observed) = mpsc::channel();
    let gate = Arc::new(Gate {
        state: Mutex::new(State::default()),
        opened: Condvar::new(),
        entered,
    });
    let server = topology.server(Gated(Arc::clone(&gate)), Duration::from_secs(2));
    let stop = Arc::new(AtomicBool::new(false));
    let task_stop = Arc::clone(&stop);
    let server_task = thread::spawn(move || server.serve_until(&listener, 2, &task_stop));
    let clients = [
        (topology.client_a(&address), b'A', 'a'),
        (topology.client_b(&address), b'B', 'b'),
    ];
    let mut requests: Vec<_> = clients
        .into_iter()
        .map(|(client, payload, nonce)| {
            thread::spawn(move || {
                client.exchange("snapshot", &[payload], &nonce.to_string().repeat(64), now())
            })
        })
        .collect();
    observed
        .recv_timeout(Duration::from_secs(1))
        .expect("first");
    observed
        .recv_timeout(Duration::from_secs(1))
        .expect("second");
    let queued = topology.client_a(&address);
    requests.push(thread::spawn(move || {
        queued.exchange("snapshot", b"C", &"c".repeat(64), now())
    }));
    assert!(observed.recv_timeout(Duration::from_millis(100)).is_err());
    {
        let mut state = gate.state.lock().expect("gate");
        assert_eq!(state.peak, 2);
        state.released = true;
        gate.opened.notify_all();
    }
    for request in requests {
        assert!(request.join().expect("request task").is_ok());
    }
    assert_eq!(gate.state.lock().expect("gate").peak, 2);
    stop.store(true, Ordering::Release);
    server_task.join().expect("server task").expect("server");
}
