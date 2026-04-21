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
use crate::windows_security;
use std::pin::Pin;
use std::sync::Mutex;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions};
use windows_sys::Win32::Foundation::LocalFree;

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
        // Gap #3: apply an owner-only DACL to the pipe so only the current
        // user's processes can open it. Combined with the descriptor
        // secret and peer-SID check on accept, this is the Windows
        // equivalent of the Unix `0600` + `SO_PEERCRED` story.
        let (sa, psd) = windows_security::owner_only_security_attributes()?;
        let first = {
            let mut opts = ServerOptions::new();
            opts.first_pipe_instance(true);
            // SAFETY: `sa` and its owned security descriptor live until
            // `LocalFree(psd)` below. The created pipe copies the SD into
            // its own kernel object, so freeing after create is safe.
            let result = unsafe {
                opts.security_attributes(&sa as *const _ as *mut _)
                    .create(endpoint)
            };
            unsafe { LocalFree(psd as *mut _) };
            result.map_err(IpcError::Io)?
        };
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

        // Gap #3: verify the connecting peer runs as the same user as the
        // server. Defense in depth on top of the pipe ACL and handshake
        // secret. A mismatch returns CrossUser; the caller drops the pipe.
        windows_security::verify_pipe_peer_same_user(&server)?;

        // Prepare the next instance before handing the current one off.
        let (sa, psd) = windows_security::owner_only_security_attributes()?;
        let next = {
            let mut opts = ServerOptions::new();
            let result = unsafe {
                opts.security_attributes(&sa as *const _ as *mut _)
                    .create(&self.endpoint)
            };
            unsafe { LocalFree(psd as *mut _) };
            result.map_err(IpcError::Io)?
        };
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
