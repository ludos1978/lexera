//! Cross-platform IPC transport.
//!
//! Unix: `tokio::net::UnixListener` / `UnixStream` with peer-credential checks.
//! Windows: `tokio::net::windows::named_pipe::NamedPipeServer` / `NamedPipeClient`
//! with a per-user ACL applied by default.
//!
//! Both platforms expose the same public surface: [`Listener`], [`Stream`],
//! [`connect`].

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::{connect, default_endpoint, Listener, Stream};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{connect, default_endpoint, Listener, Stream};
