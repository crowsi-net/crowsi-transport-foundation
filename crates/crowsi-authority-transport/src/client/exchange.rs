use rustls::{ClientConnection, StreamOwned};
use rustls_pki_types::ServerName;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    net::{TcpStream, ToSocketAddrs},
    sync::Arc,
};

use super::AuthorityClient;
use crate::{RequestEnvelopeV1, ResponseEnvelopeV1, TransportError, crypto, framing, validation};

impl AuthorityClient {
    /// Sends one finite signed request after mTLS and exact server-leaf verification.
    ///
    /// # Errors
    /// Fails closed for invalid input, transport failure, peer mismatch, or bad response evidence.
    pub fn exchange(
        &self,
        command: &str,
        payload: &[u8],
        nonce: &str,
        now: u64,
    ) -> Result<Vec<u8>, TransportError> {
        let request = self.request(command, payload, nonce, now)?;
        let wire = serde_json::to_vec(&request).map_err(|_| TransportError::Contract)?;
        let address = self
            .address
            .to_socket_addrs()
            .map_err(|_| TransportError::Config)?
            .next()
            .ok_or(TransportError::Config)?;
        let tcp = TcpStream::connect_timeout(&address, self.timeout)
            .map_err(|_| TransportError::Timeout)?;
        tcp.set_read_timeout(Some(self.timeout))
            .map_err(|_| TransportError::Unavailable)?;
        tcp.set_write_timeout(Some(self.timeout))
            .map_err(|_| TransportError::Unavailable)?;
        let name =
            ServerName::try_from(self.server_name.clone()).map_err(|_| TransportError::Config)?;
        let mut connection = ClientConnection::new(Arc::clone(&self.tls), name)
            .map_err(|_| TransportError::Unavailable)?;
        let mut tcp = tcp;
        while connection.is_handshaking() {
            connection
                .complete_io(&mut tcp)
                .map_err(|_| TransportError::Peer)?;
        }
        let leaf = connection
            .peer_certificates()
            .and_then(|items| items.first())
            .ok_or(TransportError::Peer)?;
        if format!("sha256:{:x}", Sha256::digest(leaf.as_ref())) != self.server_certificate_sha256 {
            return Err(TransportError::Peer);
        }
        let mut stream = StreamOwned::new(connection, tcp);
        framing::write(&mut stream, &wire)?;
        let response = framing::read(&mut stream)?;
        self.response(command, &wire, &response, self.clock.now_epoch_s()?)
    }

    fn request(
        &self,
        command: &str,
        payload: &[u8],
        nonce: &str,
        now: u64,
    ) -> Result<RequestEnvelopeV1, TransportError> {
        if !validation::command(command)
            || payload.is_empty()
            || payload.len() > 524_288
            || !validation::lower_hex(nonce, 32)
            || now == 0
        {
            return Err(TransportError::Contract);
        }
        let mut item = RequestEnvelopeV1 {
            schema: "crowsi://authority-transport/request/v1".into(),
            audience: self.audience.clone(),
            device_id: self.device.clone(),
            command: command.into(),
            nonce: nonce.into(),
            issued_at_epoch_s: now,
            expires_at_epoch_s: now + 15,
            payload_hex: hex::encode(payload),
            key_id: self.request_key_id.clone(),
            signature: String::new(),
        };
        let value = serde_json::to_value(&item).map_err(|_| TransportError::Contract)?;
        item.signature = crypto::sign(
            &self.request_signing_key,
            &crypto::canonical("CROWSI-AUTHORITY-TRANSPORT-REQUEST-V1", &value)?,
        );
        Ok(item)
    }

    fn response(
        &self,
        command: &str,
        request: &[u8],
        response: &[u8],
        now: u64,
    ) -> Result<Vec<u8>, TransportError> {
        let item: ResponseEnvelopeV1 =
            serde_json::from_slice(response).map_err(|_| TransportError::Contract)?;
        let value: Value =
            serde_json::from_slice(response).map_err(|_| TransportError::Contract)?;
        let valid = item.schema == "crowsi://authority-transport/response/v1"
            && item.audience == self.audience
            && item.device_id == self.device
            && item.command == command
            && item.request_digest_sha256 == crypto::digest(request)
            && validation::digest(&item.request_digest_sha256)
            && validation::text(&item.key_id, 128)
            && validation::lower_hex(&item.signature, 64)
            && !item.payload_hex.is_empty()
            && item.payload_hex.len() <= 1_048_576
            && validation::lower_hex(&item.payload_hex, item.payload_hex.len() / 2)
            && item.authority_epoch > 0
            && item.issued_at_epoch_s <= now
            && now < item.expires_at_epoch_s
            && item
                .expires_at_epoch_s
                .saturating_sub(item.issued_at_epoch_s)
                <= 15
            && item.key_id == self.response_key_id
            && crypto::verify(
                &self.response_public_key,
                &item.signature,
                &crypto::canonical("CROWSI-AUTHORITY-TRANSPORT-RESPONSE-V1", &value)?,
            );
        if !valid {
            return Err(TransportError::Signature);
        }
        hex::decode(item.payload_hex).map_err(|_| TransportError::Contract)
    }
}
