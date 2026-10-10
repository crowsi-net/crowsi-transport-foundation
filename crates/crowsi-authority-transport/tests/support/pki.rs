use crowsi_authority_transport::PeerBinding;
use ed25519_dalek::SigningKey;
use sha2::{Digest, Sha256};
use std::{
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT: AtomicU64 = AtomicU64::new(1);
pub struct Certificate {
    pub cert: Vec<u8>,
    pub key: Vec<u8>,
}
pub fn authority(root: &Path) -> Certificate {
    let pem = root.join("ca.pem");
    let key_pem = root.join("ca.key");
    run(Command::new("openssl")
        .args([
            "req",
            "-x509",
            "-newkey",
            "ed25519",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=Crowsi Test CA",
            "-keyout",
        ])
        .arg(&key_pem)
        .arg("-out")
        .arg(&pem)
        .args([
            "-addext",
            "basicConstraints=critical,CA:TRUE",
            "-addext",
            "keyUsage=critical,keyCertSign,cRLSign",
        ]));
    read_der(root, "ca", &pem, &key_pem)
}
pub fn certificate(root: &Path, name: &str, dns: Option<&str>) -> Certificate {
    let cert_pem = root.join(format!("{name}.pem"));
    let key_pem = root.join(format!("{name}.key"));
    let csr = root.join(format!("{name}.csr"));
    let extension = root.join(format!("{name}.ext"));
    run(Command::new("openssl")
        .args([
            "req",
            "-new",
            "-newkey",
            "ed25519",
            "-nodes",
            "-subj",
            &format!("/CN={name}"),
            "-keyout",
        ])
        .arg(&key_pem)
        .arg("-out")
        .arg(&csr));
    let usage = if dns.is_some() {
        "serverAuth"
    } else {
        "clientAuth"
    };
    let mut body = format!(
        "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage={usage}\n"
    );
    if let Some(value) = dns {
        writeln!(body, "subjectAltName=DNS:{value}").expect("write string");
    }
    fs::write(&extension, body).expect("extension");
    run(Command::new("openssl")
        .args(["x509", "-req", "-in"])
        .arg(&csr)
        .args(["-CA"])
        .arg(root.join("ca.pem"))
        .args(["-CAkey"])
        .arg(root.join("ca.key"))
        .args(["-CAcreateserial", "-days", "1", "-extfile"])
        .arg(&extension)
        .args(["-out"])
        .arg(&cert_pem));
    read_der(root, name, &cert_pem, &key_pem)
}

fn read_der(root: &Path, name: &str, pem: &Path, key_pem: &Path) -> Certificate {
    let cert = root.join(format!("{name}.der"));
    let key = root.join(format!("{name}.pk8"));
    run(Command::new("openssl")
        .args(["x509", "-in"])
        .arg(pem)
        .args(["-outform", "DER", "-out"])
        .arg(&cert));
    run(Command::new("openssl")
        .args(["pkcs8", "-topk8", "-nocrypt", "-in"])
        .arg(key_pem)
        .args(["-outform", "DER", "-out"])
        .arg(&key));
    Certificate {
        cert: fs::read(cert).expect("cert"),
        key: fs::read(key).expect("key"),
    }
}

fn run(command: &mut Command) {
    assert!(command.status().expect("openssl").success());
}

pub fn peer(
    device: &str,
    certificate: &Certificate,
    key: &SigningKey,
    id: &str,
) -> (PeerBinding, Vec<u8>) {
    (
        PeerBinding {
            device_id: device.into(),
            certificate_sha256: server_certificate_sha256(certificate),
            request_key_id: id.into(),
            request_public_key_hex: hex::encode(key.verifying_key().to_bytes()),
        },
        certificate.cert.clone(),
    )
}

pub fn server_certificate_sha256(certificate: &Certificate) -> String {
    format!("sha256:{:x}", Sha256::digest(&certificate.cert))
}

pub fn root() -> PathBuf {
    let value = std::env::temp_dir().join(format!(
        "crowsi-mtls-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&value).expect("root");
    value
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_secs()
}
