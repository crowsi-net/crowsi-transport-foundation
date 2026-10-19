#![forbid(unsafe_code)]
//! Transport only: callers own API selection, IAM, account scope and response meaning.
mod client;
mod response;
mod target;
pub use client::HttpsRead;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Configuration,
    Credential,
    Target,
    Transport,
    Status(u16),
    BodyLimit,
    Budget,
}
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tls_support;
#[cfg(test)]
mod tls_tests;

#[cfg(test)]
mod tls_pki;
