use rustls::{ClientConfig, RootCertStore, ServerConfig, server::WebPkiClientVerifier};
use rustls_pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use std::sync::{Arc, Once};

use crate::TransportError;

static PROVIDER: Once = Once::new();

pub(crate) fn client(
    cert: &[u8],
    key: &[u8],
    server: &[u8],
) -> Result<Arc<ClientConfig>, TransportError> {
    install();
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from(server.to_vec()))
        .map_err(|_| TransportError::Config)?;
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.to_vec()));
    ClientConfig::builder()
        .with_root_certificates(roots)
        .with_client_auth_cert(vec![CertificateDer::from(cert.to_vec())], key)
        .map(Arc::new)
        .map_err(|_| TransportError::Config)
}

pub(crate) fn server(
    cert: &[u8],
    key: &[u8],
    clients: &[Vec<u8>],
) -> Result<Arc<ServerConfig>, TransportError> {
    install();
    let mut roots = RootCertStore::empty();
    for value in clients {
        roots
            .add(CertificateDer::from(value.clone()))
            .map_err(|_| TransportError::Config)?;
    }
    let verifier = WebPkiClientVerifier::builder(Arc::new(roots))
        .build()
        .map_err(|_| TransportError::Config)?;
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.to_vec()));
    ServerConfig::builder()
        .with_client_cert_verifier(verifier)
        .with_single_cert(vec![CertificateDer::from(cert.to_vec())], key)
        .map(Arc::new)
        .map_err(|_| TransportError::Config)
}

fn install() {
    PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}
