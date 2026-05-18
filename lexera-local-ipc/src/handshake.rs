//! Handshake.
//!
//! The client sends [`ClientFrame::Handshake`] with the protocol version and
//! the descriptor secret. The server validates both and replies with
//! [`ServerFrame::HandshakeOk`] or [`ServerFrame::HandshakeRejected`].
//!
//! Both sides must complete the handshake before any other frame is exchanged.

use crate::error::IpcError;
use crate::frame::{read_frame, write_frame, ClientFrame, HandshakeRejection, ServerFrame};
use crate::PROTOCOL_VERSION;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Payload of a handshake request frame. Kept as a distinct type for callers
/// that want a higher-level API than the raw enum variant.
#[derive(Debug, Clone)]
pub struct HandshakeRequest {
    pub protocol: String,
    pub secret: String,
}

/// Result of a handshake as seen by the server.
#[derive(Debug, Clone)]
pub enum HandshakeResponse {
    Ok,
    Rejected(HandshakeRejection, String),
}

/// Client side: send handshake and wait for the server's response.
///
/// Returns `Ok(())` on success, `Err(IpcError)` on any failure.
pub async fn client<S>(stream: &mut S, secret: &str) -> Result<(), IpcError>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let req = ClientFrame::Handshake {
        protocol: PROTOCOL_VERSION.to_string(),
        secret: secret.to_string(),
    };
    write_frame(stream, &req).await?;

    match read_frame::<_, ServerFrame>(stream).await? {
        Some(ServerFrame::HandshakeOk) => Ok(()),
        Some(ServerFrame::HandshakeRejected { code, message }) => Err(map_rejection(code, message)),
        Some(_) => Err(IpcError::HandshakeIncomplete),
        None => Err(IpcError::HandshakeIncomplete),
    }
}

/// Server side: read the handshake frame, validate it against the expected
/// secret and protocol version, and send the response.
pub async fn server<S>(stream: &mut S, expected_secret: &str) -> Result<(), IpcError>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let frame = read_frame::<_, ClientFrame>(stream).await?;
    let (protocol, secret) = match frame {
        Some(ClientFrame::Handshake { protocol, secret }) => (protocol, secret),
        Some(_) => {
            write_frame(
                stream,
                &ServerFrame::HandshakeRejected {
                    code: HandshakeRejection::Malformed,
                    message: "expected Handshake frame".into(),
                },
            )
            .await?;
            return Err(IpcError::HandshakeIncomplete);
        }
        None => return Err(IpcError::HandshakeIncomplete),
    };

    if protocol != PROTOCOL_VERSION {
        let msg = format!("expected {}, got {}", PROTOCOL_VERSION, protocol);
        write_frame(
            stream,
            &ServerFrame::HandshakeRejected {
                code: HandshakeRejection::ProtocolMismatch,
                message: msg.clone(),
            },
        )
        .await?;
        return Err(IpcError::ProtocolMismatch {
            expected: PROTOCOL_VERSION.to_string(),
            actual: protocol,
        });
    }

    if !constant_time_eq(secret.as_bytes(), expected_secret.as_bytes()) {
        write_frame(
            stream,
            &ServerFrame::HandshakeRejected {
                code: HandshakeRejection::SecretMismatch,
                message: "secret does not match current descriptor".into(),
            },
        )
        .await?;
        return Err(IpcError::SecretMismatch);
    }

    write_frame(stream, &ServerFrame::HandshakeOk).await?;
    Ok(())
}

fn map_rejection(code: HandshakeRejection, message: String) -> IpcError {
    match code {
        HandshakeRejection::ProtocolMismatch => IpcError::ProtocolMismatch {
            expected: PROTOCOL_VERSION.to_string(),
            actual: message,
        },
        HandshakeRejection::SecretMismatch => IpcError::SecretMismatch,
        HandshakeRejection::Malformed => IpcError::HandshakeIncomplete,
    }
}

/// Constant-time byte slice equality. Prevents a timing oracle on the secret.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    async fn run_both<'a>(
        secret_client: &'a str,
        secret_server: &'a str,
    ) -> (Result<(), IpcError>, Result<(), IpcError>) {
        let (mut c, mut s) = duplex(64 * 1024);
        let client_task = async move { client(&mut c, secret_client).await };
        let server_task = async move { server(&mut s, secret_server).await };
        tokio::join!(client_task, server_task)
    }

    #[tokio::test]
    async fn matching_secret_succeeds() {
        let (c, s) = run_both("correct-horse", "correct-horse").await;
        assert!(c.is_ok());
        assert!(s.is_ok());
    }

    #[tokio::test]
    async fn wrong_secret_rejected() {
        let (c, s) = run_both("bad", "good").await;
        assert!(matches!(c, Err(IpcError::SecretMismatch)));
        assert!(matches!(s, Err(IpcError::SecretMismatch)));
    }

    #[tokio::test]
    async fn wrong_protocol_rejected() {
        let (mut c, mut s) = duplex(64 * 1024);
        let client_task = async move {
            let req = ClientFrame::Handshake {
                protocol: "lexera-local-ipc/v9".into(),
                secret: "x".into(),
            };
            write_frame(&mut c, &req).await?;
            match read_frame::<_, ServerFrame>(&mut c).await? {
                Some(ServerFrame::HandshakeRejected { code, .. }) => Ok(code),
                _ => panic!("expected rejection"),
            }
        };
        let server_task = async move { server(&mut s, "x").await };

        let (c_res, s_res): (Result<HandshakeRejection, IpcError>, Result<(), IpcError>) =
            tokio::join!(client_task, server_task);
        assert_eq!(c_res.unwrap(), HandshakeRejection::ProtocolMismatch);
        assert!(matches!(s_res, Err(IpcError::ProtocolMismatch { .. })));
    }

    #[tokio::test]
    async fn non_handshake_first_frame_rejected() {
        let (mut c, mut s) = duplex(64 * 1024);
        let client_task = async move {
            let bad_first = ClientFrame::Ping;
            write_frame(&mut c, &bad_first).await?;
            match read_frame::<_, ServerFrame>(&mut c).await? {
                Some(ServerFrame::HandshakeRejected { code, .. }) => Ok(code),
                _ => panic!("expected rejection"),
            }
        };
        let server_task = async move { server(&mut s, "x").await };

        let (c_res, s_res): (Result<HandshakeRejection, IpcError>, Result<(), IpcError>) =
            tokio::join!(client_task, server_task);
        assert_eq!(c_res.unwrap(), HandshakeRejection::Malformed);
        assert!(matches!(s_res, Err(IpcError::HandshakeIncomplete)));
    }

    #[test]
    fn constant_time_eq_matches_ordinary_eq() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"x"));
        assert!(constant_time_eq(b"", b""));
    }
}
