use std::fmt::{Display, Formatter};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransportError {
    Config,
    Contract,
    Peer,
    Replay,
    Signature,
    Timeout,
    Unavailable,
}

impl Display for TransportError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Config => "authority-transport-config-invalid",
            Self::Contract => "authority-transport-contract-invalid",
            Self::Peer => "authority-transport-peer-invalid",
            Self::Replay => "authority-transport-replay",
            Self::Signature => "authority-transport-signature-invalid",
            Self::Timeout => "authority-transport-timeout",
            Self::Unavailable => "authority-transport-unavailable",
        })
    }
}

impl std::error::Error for TransportError {}
