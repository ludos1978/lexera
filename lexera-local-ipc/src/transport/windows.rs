//! Windows named-pipe transport.
//!
//! Pipe names follow the form `\\.\pipe\lexera-ipc-<random>`. The first pipe
//! instance is created with `first_pipe_instance(true)` so a second backend
//! cannot hijack an existing descriptor's endpoint; subsequent instances are
//! created lazily as clients connect.
//!
//! Access control relies on the default named-pipe security descriptor, which
//! restricts write access to the creator's logon session plus
//! LocalSystem/Administrators. The descriptor secret handshake remains the
//! authoritative local-user gate.

use crate::error::IpcError;
use std::pin::Pin;
use std::sync::Mutex;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions};

#[derive(Debug)]
pub struct Listener {
    endpoint: String,
    next: Mutex<Option<NamedPipeServer>>,
}

impl Listener {
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub async fn bind(endpoint: &str) -> Result<Self, IpcError> {
        let first = ServerOptions::new()
            .first_pipe_instance(true)
            .create(endpoint)
            .map_err(IpcError::Io)?;
        Ok(Self {
            endpoint: endpoint.to_string(),
            next: Mutex::new(Some(first)),
        })
    }

    pub async fn accept(&self) -> Result<Stream, IpcError> {
        let server = {
            let mut guard = self.next.lock().expect("listener mutex poisoned");
            guard.take().ok_or_else(|| IpcError::Descriptor(
                "listener missing prepared pipe instance".into(),
            ))?
        };
        server.connect().await.map_err(IpcError::Io)?;

        // Prepare the next instance before handing the current one off.
        let next = ServerOptions::new()
            .create(&self.endpoint)
            .map_err(IpcError::Io)?;
        *self.next.lock().expect("listener mutex poisoned") = Some(next);

        Ok(Stream::Server(server))
    }
}

#[derive(Debug)]
pub enum Stream {
    Server(NamedPipeServer),
    Client(NamedPipeClient),
}

impl AsyncRead for Stream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match &mut *self {
            Stream::Server(s) => Pin::new(s).poll_read(cx, buf),
            Stream::Client(s) => Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for Stream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<Result<usize, std::io::Error>> {
        match &mut *self {
            Stream::Server(s) => Pin::new(s).poll_write(cx, buf),
            Stream::Client(s) => Pin::new(s).poll_write(cx, buf),
        }
    }
    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        match &mut *self {
            Stream::Server(s) => Pin::new(s).poll_flush(cx),
            Stream::Client(s) => Pin::new(s).poll_flush(cx),
        }
    }
    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        match &mut *self {
            Stream::Server(s) => Pin::new(s).poll_shutdown(cx),
            Stream::Client(s) => Pin::new(s).poll_shutdown(cx),
        }
    }
}

pub async fn connect(endpoint: &str) -> Result<Stream, IpcError> {
    let client = ClientOptions::new().open(endpoint).map_err(IpcError::Io)?;
    Ok(Stream::Client(client))
}

/// Default endpoint name. Process id keeps concurrent dev instances distinct.
pub fn default_endpoint() -> String {
    format!(r"\\.\pipe\lexera-ipc-{}", std::process::id())
}
