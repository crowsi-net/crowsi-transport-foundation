use super::{AuthorityBackend, AuthorityServer, ReplayGuard};
use crate::TransportError;
use std::{
    io::ErrorKind,
    net::TcpListener,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
    },
    thread,
    time::Duration,
};

const MAX_CONCURRENT: usize = 1_024;
const MAX_FINITE_ACCEPTS: usize = 10_000;
const POLL: Duration = Duration::from_millis(5);

pub(super) fn run<B: AuthorityBackend, R: ReplayGuard>(
    server: &AuthorityServer<B, R>,
    listener: &TcpListener,
    capacity: usize,
    accept_limit: Option<usize>,
    shutdown: Option<&AtomicBool>,
    isolate_connection_errors: bool,
) -> Result<(), TransportError> {
    validate(capacity, accept_limit, shutdown)?;
    listener
        .set_nonblocking(true)
        .map_err(|_| TransportError::Unavailable)?;
    let outcome = thread::scope(|scope| {
        let (completed, receiver) = mpsc::channel();
        let mut active = 0_usize;
        let mut accepted = 0_usize;
        let mut first_error = None;
        loop {
            drain(
                &receiver,
                &mut active,
                &mut first_error,
                isolate_connection_errors,
            );
            let stopping = stopped(accepted, accept_limit, shutdown);
            if stopping && active == 0 {
                break;
            }
            if stopping || active >= capacity {
                wait_one(
                    &receiver,
                    &mut active,
                    &mut first_error,
                    isolate_connection_errors,
                );
                continue;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    accepted = accepted.checked_add(1).ok_or(TransportError::Config)?;
                    active += 1;
                    let sender = completed.clone();
                    scope.spawn(move || {
                        let result = catch_unwind(AssertUnwindSafe(|| server.handle(stream)))
                            .unwrap_or(Err(TransportError::Unavailable));
                        let _ = sender.send(result);
                    });
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    wait_one(
                        &receiver,
                        &mut active,
                        &mut first_error,
                        isolate_connection_errors,
                    );
                }
                Err(_) => return Err(TransportError::Unavailable),
            }
        }
        first_error.map_or(Ok(()), Err)
    });
    let restored = listener
        .set_nonblocking(false)
        .map_err(|_| TransportError::Unavailable);
    outcome.and(restored)
}

fn validate(
    capacity: usize,
    limit: Option<usize>,
    shutdown: Option<&AtomicBool>,
) -> Result<(), TransportError> {
    if !(1..=MAX_CONCURRENT).contains(&capacity)
        || limit.is_some_and(|value| !(1..=MAX_FINITE_ACCEPTS).contains(&value))
        || limit.is_none() != shutdown.is_some()
    {
        Err(TransportError::Config)
    } else {
        Ok(())
    }
}

fn stopped(accepted: usize, limit: Option<usize>, shutdown: Option<&AtomicBool>) -> bool {
    limit.is_some_and(|value| accepted >= value)
        || shutdown.is_some_and(|value| value.load(Ordering::Acquire))
}

fn drain(
    receiver: &Receiver<Result<(), TransportError>>,
    active: &mut usize,
    first: &mut Option<TransportError>,
    isolate: bool,
) {
    while let Ok(result) = receiver.try_recv() {
        complete(result, active, first, isolate);
    }
}

fn wait_one(
    receiver: &Receiver<Result<(), TransportError>>,
    active: &mut usize,
    first: &mut Option<TransportError>,
    isolate: bool,
) {
    if *active == 0 {
        thread::sleep(POLL);
    } else if let Ok(result) = receiver.recv_timeout(POLL) {
        complete(result, active, first, isolate);
    }
}

fn complete(
    result: Result<(), TransportError>,
    active: &mut usize,
    first: &mut Option<TransportError>,
    isolate: bool,
) {
    *active = active.saturating_sub(1);
    if !isolate && first.is_none() {
        *first = result.err();
    }
}
