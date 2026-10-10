use super::{AuthorityBackend, AuthorityServer, PeerStatusIdentity, ReplayGuard, deadline};
use crate::{
    PeerBinding, RequestEnvelopeV1, ResponseEnvelopeV1, SignedRequest, TransportError, crypto,
    framing, validation,
};
use rustls::{ServerConnection, StreamOwned};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{net::TcpStream, sync::Arc};

impl<B: AuthorityBackend, R: ReplayGuard> AuthorityServer<B, R> {
    pub(super) fn handle(&self, tcp: TcpStream) -> Result<(), TransportError> {
        let mut connection = ServerConnection::new(Arc::clone(&self.tls))
            .map_err(|_| TransportError::Unavailable)?;
        let mut tcp = tcp;
        deadline::handshake(&mut connection, &mut tcp, self.timeout)?;
        let certificate = connection
            .peer_certificates()
            .and_then(|items| items.first())
            .ok_or(TransportError::Peer)?;
        let digest = format!("sha256:{:x}", Sha256::digest(certificate.as_ref()));
        let peer = self
            .peers
            .iter()
            .find(|(peer, _)| peer.certificate_sha256 == digest)
            .map(|(peer, _)| peer.clone())
            .ok_or(TransportError::Peer)?;
        let _peer_permit = self.peer_gate.enter(&peer.device_id)?;
        let mut stream = StreamOwned::new(connection, tcp);
        let wire = deadline::read_frame(&mut stream, self.timeout)?;
        let now = self.clock.now_epoch_s()?;
        let request = self.request(&wire, &peer, now)?;
        let payload = self.backend.handle(&request)?;
        self.authorize(&request)?;
        let response = self.response(&request, &wire, &payload, now)?;
        deadline::write_frame(&mut stream, &response, self.timeout)
    }

    fn request(
        &self,
        wire: &[u8],
        peer: &PeerBinding,
        now: u64,
    ) -> Result<SignedRequest, TransportError> {
        let item: RequestEnvelopeV1 =
            serde_json::from_slice(wire).map_err(|_| TransportError::Contract)?;
        let value: Value = serde_json::from_slice(wire).map_err(|_| TransportError::Contract)?;
        let valid = item.schema == "crowsi://authority-transport/request/v1"
            && item.audience == self.audience
            && item.device_id == peer.device_id
            && item.key_id == peer.request_key_id
            && item.issued_at_epoch_s <= now
            && now < item.expires_at_epoch_s
            && item
                .expires_at_epoch_s
                .saturating_sub(item.issued_at_epoch_s)
                <= 15
            && validation::command(&item.command)
            && validation::lower_hex(&item.nonce, 32)
            && validation::lower_hex(&item.signature, 64)
            && !item.payload_hex.is_empty()
            && item.payload_hex.len() <= 1_048_576
            && crypto::verify(
                &peer.request_public_key_hex,
                &item.signature,
                &crypto::canonical("CROWSI-AUTHORITY-TRANSPORT-REQUEST-V1", &value)?,
            );
        if !valid {
            return Err(TransportError::Signature);
        }
        let payload = hex::decode(item.payload_hex).map_err(|_| TransportError::Contract)?;
        if payload.is_empty() || payload.len() > framing::MAX {
            return Err(TransportError::Contract);
        }
        let request = SignedRequest {
            peer: peer.clone(),
            command: item.command,
            payload,
        };
        self.authorize(&request)?;
        self.replay
            .consume(&peer.device_id, &item.nonce, &crypto::digest(wire))?;
        Ok(request)
    }

    fn authorize(&self, request: &SignedRequest) -> Result<(), TransportError> {
        self.peer_status.authorize_request(
            PeerStatusIdentity {
                device_id: &request.peer.device_id,
                client_certificate_sha256: &request.peer.certificate_sha256,
                request_key_id: &request.peer.request_key_id,
            },
            self.authority_epoch,
            request,
        )
    }

    fn response(
        &self,
        request: &SignedRequest,
        wire: &[u8],
        payload: &[u8],
        now: u64,
    ) -> Result<Vec<u8>, TransportError> {
        if payload.is_empty() || payload.len() > 524_288 {
            return Err(TransportError::Contract);
        }
        let mut item = ResponseEnvelopeV1 {
            schema: "crowsi://authority-transport/response/v1".into(),
            audience: self.audience.clone(),
            device_id: request.peer.device_id.clone(),
            command: request.command.clone(),
            request_digest_sha256: crypto::digest(wire),
            authority_epoch: self.authority_epoch,
            issued_at_epoch_s: now,
            expires_at_epoch_s: now + 15,
            payload_hex: hex::encode(payload),
            key_id: self.credential.response_key_id.clone(),
            signature: String::new(),
        };
        let value = serde_json::to_value(&item).map_err(|_| TransportError::Contract)?;
        item.signature = crypto::sign(
            &self.credential.response_signing_key,
            &crypto::canonical("CROWSI-AUTHORITY-TRANSPORT-RESPONSE-V1", &value)?,
        );
        serde_json::to_vec(&item).map_err(|_| TransportError::Contract)
    }
}
