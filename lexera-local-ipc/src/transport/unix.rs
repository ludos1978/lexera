//! Unix domain socket transport.
//!
//! The socket file is created with mode `0600`; the parent directory is
//! `0700`. On accept, the peer's effective uid is compared to the server's
//! uid and mismatches are rejected as [`IpcError::CrossUser`].

use crate::error::IpcError;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{UnixListener, UnixStream};

#[derive(Debug)]
pub struct Listener {
    inner: UnixListener,
    path: PathBuf,
}

impl Listener {
    pub fn endpoint(&self) -> &Path {
        &self.path
    }

    /// Bind a UDS at `endpoint`. Removes a stale socket at the same path.
    /// Ensures the parent dir is `0700` and the socket file is `0600`.
    pub async fn bind(endpoint: &Path) -> Result<Self, IpcError> {
        if let Some(parent) = endpoint.parent() {
            std::fs::create_dir_all(parent)?;
            restrict_dir_permissions(parent)?;
        }
        // Clean up a stale socket from a previous run.
        if endpoint.exists() {
            std::fs::remove_file(endpoint)?;
        }
        let listener = UnixListener::bind(endpoint)?;
        restrict_file_permissions(endpoint)?;
        Ok(Self {
            inner: listener,
            path: endpoint.to_path_buf(),
        })
    }

    /// Accept the next connection and reject cross-user peers.
    pub async fn accept(&self) -> Result<Stream, IpcError> {
        let (stream, _addr) = self.inner.accept().await?;
        let cred = stream.peer_cred()?;
        let own_uid = unsafe { libc::geteuid() };
        if cred.uid() != own_uid {
            return Err(IpcError::CrossUser {
                peer: cred.uid(),
                server: own_uid,
            });
        }
        Ok(Stream {
            inner: stream,
            peer_uid: cred.uid(),
        })
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// An accepted or connected UDS stream.
#[derive(Debug)]
pub struct Stream {
    inner: UnixStream,
    peer_uid: u32,
}

impl Stream {
    pub fn peer_uid(&self) -> u32 {
        self.peer_uid
    }
}

impl AsyncRead for Stream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for Stream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<Result<usize, std::io::Error>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// Client: connect to a UDS endpoint.
pub async fn connect(endpoint: &Path) -> Result<Stream, IpcError> {
    let stream = UnixStream::connect(endpoint).await?;
    // The client's effective uid is, by Unix semantics, the server's uid after
    // cross-user rejection on accept. The client records its own uid.
    let own_uid = unsafe { libc::geteuid() };
    Ok(Stream {
        inner: stream,
        peer_uid: own_uid,
    })
}

/// Default endpoint path: alongside the descriptor file.
pub fn default_endpoint() -> PathBuf {
    let mut p = crate::descriptor::descriptor_path();
    p.set_file_name("ipc.sock");
    p
}

fn restrict_dir_permissions(dir: &Path) -> Result<(), IpcError> {
    use std::os::unix::fs::PermissionsExt;
    let meta = std::fs::metadata(dir)?;
    let mut perms = meta.permissions();
    perms.set_mode(0o700);
    std::fs::set_permissions(dir, perms)?;
    Ok(())
}

fn restrict_file_permissions(path: &Path) -> Result<(), IpcError> {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn roundtrip_uds_bytes() {
        let dir = tempdir().unwrap();
        let sock = dir.path().join("ipc.sock");
        let listener = Listener::bind(&sock).await.unwrap();

        let server_task = tokio::spawn(async move {
            let mut s = listener.accept().await.unwrap();
            let mut buf = [0u8; 5];
            s.read_exact(&mut buf).await.unwrap();
            assert_eq!(&buf, b"hello");
            s.write_all(b"world").await.unwrap();
            s.flush().await.unwrap();
        });

        let mut c = connect(&sock).await.unwrap();
        c.write_all(b"hello").await.unwrap();
        c.flush().await.unwrap();
        let mut reply = [0u8; 5];
        c.read_exact(&mut reply).await.unwrap();
        assert_eq!(&reply, b"world");

        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn socket_file_is_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let sock = dir.path().join("ipc.sock");
        let _listener = Listener::bind(&sock).await.unwrap();
        let mode = std::fs::metadata(&sock).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[tokio::test]
    async fn listener_drop_removes_socket_file() {
        let dir = tempdir().unwrap();
        let sock = dir.path().join("ipc.sock");
        {
            let _listener = Listener::bind(&sock).await.unwrap();
            assert!(sock.exists());
        }
        assert!(!sock.exists(), "socket must be cleaned up on drop");
    }

    #[tokio::test]
    async fn stale_socket_file_is_replaced() {
        use std::os::unix::fs::FileTypeExt;
        let dir = tempdir().unwrap();
        let sock = dir.path().join("ipc.sock");
        std::fs::write(&sock, b"stale").unwrap();
        let _listener = Listener::bind(&sock).await.unwrap();
        // bind must have replaced the stale file with a live socket.
        let meta = std::fs::metadata(&sock).unwrap();
        assert!(meta.file_type().is_socket());
    }

    #[tokio::test]
    async fn peer_uid_matches_own_uid_for_local_connection() {
        let dir = tempdir().unwrap();
        let sock = dir.path().join("ipc.sock");
        let listener = Listener::bind(&sock).await.unwrap();

        let server_task = tokio::spawn(async move {
            let s = listener.accept().await.unwrap();
            let own = unsafe { libc::geteuid() };
            assert_eq!(s.peer_uid(), own);
        });

        let _c = connect(&sock).await.unwrap();
        server_task.await.unwrap();
    }
}
