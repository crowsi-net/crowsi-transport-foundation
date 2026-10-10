//! Opaque signed metadata envelopes over mutually authenticated TLS.

#![forbid(unsafe_code)]

mod client;
mod contract;
mod crypto;
mod error;
mod framing;
mod server;
mod service_locator;
mod service_locator_validation;
mod tls;
mod validation;

pub use client::{AuthorityClient, ClientCredential};
pub use contract::{PeerBinding, RequestEnvelopeV1, ResponseEnvelopeV1, SignedRequest};
pub use error::TransportError;
pub use server::{
    AuthorityBackend, AuthorityServer, Clock, PeerStatusGuard, PeerStatusIdentity, ReplayGuard,
    ServerCredential, SystemClock,
};
pub use service_locator::{
    SERVICE_LOCATOR_SCHEMA, ServiceLocatorV1, VerifiedServiceLocator,
    service_locator_signing_bytes, verify_service_locator_at,
};
