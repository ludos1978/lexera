//! Client side of the IPC channel.
//!
//! Reads the descriptor, validates protocol version and pid liveness, connects
//! to the advertised endpoint, and performs the client handshake using the
//! descriptor's secret.

use crate::descriptor::Descriptor;
use crate::error::IpcError;
use crate::handshake;
use crate::transport::{self, Stream};
use crate::PROTOCOL_VERSION;

#[derive(Debug)]
pub struct Client {
    stream: Stream,
}

impl Client {
    /// Connect using the current on-disk descriptor.
    pub async fn connect() -> Result<Self, IpcError> {
        let desc = Descriptor::read()?;
        Self::connect_with_descriptor(&desc).await
    }

    /// Connect using an explicitly-provided descriptor.
    pub async fn connect_with_descriptor(desc: &Descriptor) -> Result<Self, IpcError> {
        if desc.protocol != PROTOCOL_VERSION {
            return Err(IpcError::ProtocolMismatch {
                expected: PROTOCOL_VERSION.to_string(),
                actual: desc.protocol.clone(),
            });
        }
        if !desc.pid_alive() {
            return Err(IpcError::StalePid(desc.pid));
        }

        #[cfg(unix)]
        let mut stream = transport::connect(std::path::Path::new(&desc.endpoint)).await?;
        #[cfg(windows)]
        let mut stream = transport::connect(&desc.endpoint).await?;

        handshake::client(&mut stream, &desc.secret).await?;
        Ok(Self { stream })
    }

    pub fn stream(&mut self) -> &mut Stream {
        &mut self.stream
    }

    pub fn into_stream(self) -> Stream {
        self.stream
    }
}
