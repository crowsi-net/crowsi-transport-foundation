//! Ephemeral synthetic test PKI; never uses platform credentials or weakens TLS.
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::Arc,
    thread,
};
pub struct Server {
    pub origin: String,
    pub ca: Vec<u8>,
    thread: thread::JoinHandle<()>,
    _directory: tempfile::TempDir,
}
impl Server {
    pub fn start(status: u16, body: &str, location: Option<&str>) -> Self {
        let pki = crate::tls_pki::create();
        let cert = pki.cert;
        let key = pki.key;
        let directory = pki.directory;
        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)
            .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!(
            "https://localhost:{}",
            listener.local_addr().unwrap().port()
        );
        let response = format!(
            "HTTP/1.1 {status} Synthetic\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{body}",
            body.len(),
            location
                .map(|v| format!("Location: {v}\r\n"))
                .unwrap_or_default()
        );
        let ca = pki.ca;
        let thread = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut tls =
                StreamOwned::new(ServerConnection::new(Arc::new(config)).unwrap(), socket);
            let mut request = Vec::new();
            loop {
                let mut byte = [0];
                if tls.read_exact(&mut byte).is_err() {
                    return;
                }
                request.push(byte[0]);
                if request.ends_with(b"\r\n\r\n") {
                    break;
                }
                assert!(request.len() < 32768);
            }
            let request = String::from_utf8(request).unwrap();
            assert!(request.starts_with("GET /inspect "));
            assert!(request.to_ascii_lowercase().contains(concat!(
                "user-agent: crowsi-provider-read-http/",
                env!("CARGO_PKG_VERSION"),
                "\r\n"
            )));
            assert!(
                request
                    .to_ascii_lowercase()
                    .contains("authorization: bearer synthetic-only")
            );
            let _ = tls.write_all(response.as_bytes());
            let _ = tls.flush();
        });
        Self {
            origin,
            ca,
            thread,
            _directory: directory,
        }
    }
    pub fn join(self) {
        self.thread.join().unwrap();
    }
}
