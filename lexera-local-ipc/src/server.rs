//! Server side of the IPC channel.
//!
//! Holds the authenticated listener plus the descriptor secret expected from
//! connecting clients. [`Server::accept`] accepts one connection, performs the
//! server-side handshake, and returns the authenticated stream.

use crate::descriptor::Descriptor;
use crate::error::IpcError;
use crate::handshake;
use crate::transport::{self, Listener, Stream};

#[derive(Debug)]
pub struct Server {
    listener: Listener,
    secret: String,
}

impl Server {
    /// Bind the listener at the endpoint advertised in `descriptor`. The
    /// descriptor's `secret` is stored and validated on each handshake.
    pub async fn bind_with_descriptor(descriptor: &Descriptor) -> Result<Self, IpcError> {
        #[cfg(unix)]
        let listener = Listener::bind(std::path::Path::new(&descriptor.endpoint)).await?;
        #[cfg(windows)]
        let listener = Listener::bind(&descriptor.endpoint).await?;

        Ok(Self {
            listener,
            secret: descriptor.secret.clone(),
        })
    }

    /// Create a fresh descriptor at the default endpoint, bind, then publish
    /// the descriptor file. The backend's typical startup path.
    ///
    /// The descriptor is written only after the bind succeeds, so a failed
    /// bind never advertises a stale endpoint.
    pub async fn bind_default() -> Result<(Self, Descriptor), IpcError> {
        let desc = Descriptor::new(default_endpoint_string());
        let server = Self::bind_with_descriptor(&desc).await?;
        desc.write()?;
        Ok((server, desc))
    }

    /// Accept the next connection and perform the server handshake. Returns
    /// the authenticated stream, or an error (including handshake failure).
    pub async fn accept(&self) -> Result<Stream, IpcError> {
        let mut stream = self.listener.accept().await?;
        handshake::server(&mut stream, &self.secret).await?;
        Ok(stream)
    }
}

/// Resolve a default endpoint string for use in a descriptor. Unix returns a
/// path string; Windows returns a named-pipe name.
pub fn default_endpoint_string() -> String {
    #[cfg(unix)]
    {
        transport::default_endpoint().to_string_lossy().into_owned()
    }
    #[cfg(windows)]
    {
        transport::default_endpoint()
    }
}
