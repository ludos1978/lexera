//! Lexera local IPC primitives.
//!
//! Shared crate for the local OS-IPC bridge between `lexera-kanban` and
//! `lexera-backend`. Provides:
//!
//! - Descriptor file read/write (atomic, 0600, per-user config dir).
//! - Frame encoding using postcard with a length prefix.
//! - Handshake with secret + protocol-version validation.
//! - Unix domain socket / Windows named pipe transport.
//! - Server accept loop and client connect helpers.
//!
//! Protocol version: [`PROTOCOL_VERSION`].

pub mod client;
pub mod descriptor;
pub mod error;
pub mod frame;
pub mod handshake;
pub mod server;
pub mod transport;
#[cfg(windows)]
pub mod windows_security;

pub use client::Client;
pub use descriptor::{descriptor_path, Descriptor};
pub use error::IpcError;
pub use frame::{ClientFrame, ServerFrame, MAX_FRAME_BYTES};
pub use handshake::{HandshakeRequest, HandshakeResponse};
pub use server::{default_endpoint_string, Server};

/// Wire protocol version. Mismatches are rejected; they are not negotiated.
pub const PROTOCOL_VERSION: &str = "lexera-local-ipc/v1";
