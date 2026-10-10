use super::{AuthorityBackend, AuthorityServer, ReplayGuard, accept};
use crate::TransportError;
use std::{net::TcpListener, sync::atomic::AtomicBool};

impl<B: AuthorityBackend, R: ReplayGuard> AuthorityServer<B, R> {
    /// Serves exactly `count` finite connections with bounded parallel workers.
    ///
    /// Compatibility callers should migrate to [`Self::serve_batch`] so the
    /// lifetime accept limit and concurrent capacity are configured separately.
    ///
    /// # Errors
    /// Returns the first transport, peer, replay, or backend error.
    pub fn serve_n(&self, listener: &TcpListener, count: usize) -> Result<(), TransportError> {
        self.serve_batch(listener, count, count.min(64))
    }

    /// Serves a finite connection batch with an independent worker bound.
    ///
    /// # Errors
    /// Rejects invalid bounds and returns the first connection or listener error
    /// after all accepted workers have finished.
    pub fn serve_batch(
        &self,
        listener: &TcpListener,
        connection_limit: usize,
        concurrent_capacity: usize,
    ) -> Result<(), TransportError> {
        if connection_limit > 1 && self.peers.len() > 1 && concurrent_capacity < 2 {
            return Err(TransportError::Config);
        }
        accept::run(
            self,
            listener,
            concurrent_capacity,
            Some(connection_limit),
            None,
            false,
        )
    }

    /// Serves until `shutdown` is set, isolating each failed connection.
    ///
    /// The capacity bounds live worker threads, not lifetime accepts. Shutdown
    /// is polled without accepting new work, then every active worker is joined.
    ///
    /// # Errors
    /// Rejects an invalid capacity or returns a listener-mode/accept error.
    pub fn serve_until(
        &self,
        listener: &TcpListener,
        concurrent_capacity: usize,
        shutdown: &AtomicBool,
    ) -> Result<(), TransportError> {
        if self.peers.len() > 1 && concurrent_capacity < 2 {
            return Err(TransportError::Config);
        }
        accept::run(
            self,
            listener,
            concurrent_capacity,
            None,
            Some(shutdown),
            true,
        )
    }
}
