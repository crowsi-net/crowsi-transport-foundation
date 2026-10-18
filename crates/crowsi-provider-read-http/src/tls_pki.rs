use rustls_pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
use std::{fs, path::Path, process::Command};
pub struct Pki {
    pub ca: Vec<u8>,
    pub cert: CertificateDer<'static>,
    pub key: PrivateKeyDer<'static>,
    pub directory: tempfile::TempDir,
}
fn openssl(root: &Path, args: &[&str]) {
    let output = Command::new("openssl")
        .current_dir(root)
        .args(args)
        .output()
        .expect("existing openssl is required");
    assert!(
        output.status.success(),
        "synthetic certificate generation failed"
    );
}
pub fn create() -> Pki {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    openssl(
        root,
        &[
            "req",
            "-x509",
            "-newkey",
            "ed25519",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=Synthetic Test CA",
            "-keyout",
            "ca.key",
            "-out",
            "ca.pem",
            "-addext",
            "basicConstraints=critical,CA:TRUE",
            "-addext",
            "keyUsage=critical,keyCertSign,cRLSign",
        ],
    );
    openssl(
        root,
        &[
            "req",
            "-new",
            "-newkey",
            "ed25519",
            "-nodes",
            "-subj",
            "/CN=localhost",
            "-keyout",
            "leaf.key",
            "-out",
            "leaf.csr",
        ],
    );
    fs::write(root.join("leaf.ext"),"basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n").unwrap();
    openssl(
        root,
        &[
            "x509",
            "-req",
            "-in",
            "leaf.csr",
            "-CA",
            "ca.pem",
            "-CAkey",
            "ca.key",
            "-CAcreateserial",
            "-days",
            "1",
            "-extfile",
            "leaf.ext",
            "-out",
            "leaf.pem",
        ],
    );
    let cert = CertificateDer::from_pem_file(root.join("leaf.pem")).unwrap();
    let key = PrivateKeyDer::from_pem_file(root.join("leaf.key")).unwrap();
    let ca = fs::read(root.join("ca.pem")).unwrap();
    Pki {
        ca,
        cert,
        key,
        directory,
    }
}
