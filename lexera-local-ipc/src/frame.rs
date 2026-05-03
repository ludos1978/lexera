//! Frame encoding.
//!
//! Wire format: `[u32 BE length][postcard-encoded frame bytes]`.
//! Postcard is used for stability guarantees and a small footprint; both ends
//! are Rust so cross-language support is not required.
//!
//! Additive enum variants are safe only when appended to the end. Receivers
//! reject unknown variants by returning a postcard deserialization error.

use crate::error::IpcError;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

/// Upper bound on a single frame. Guards against oversized frames on the wire.
/// Chosen large enough to accommodate a full HTTP response body in a single
/// `ApiResponse`; streaming/chunked responses use `AssetChunk` in Phase 4.
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

/// Byte-tunnel representation of an HTTP request.
///
/// `headers` is a list of `(name, value)` byte pairs to preserve any header
/// value that is not valid UTF-8. In Phase 2 this converts to `http::Request`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApiRequest {
    pub method: String,
    pub uri: String,
    pub headers: Vec<(String, Vec<u8>)>,
    pub body: Vec<u8>,
}

/// Byte-tunnel representation of an HTTP response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApiResponse {
    pub status: u16,
    pub headers: Vec<(String, Vec<u8>)>,
    pub body: Vec<u8>,
}

/// Kind of asset. The backend resolves `Media` to `<board_stem>-Media/<name>`
/// so callers do not need to know the board's stem; `File` is a raw path
/// relative to the board directory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AssetKind {
    Media { filename: String },
    File { path: String },
}

/// Streaming asset fetch. `board_id` + the path derived from `kind` are
/// resolved on the backend against the same validation used by the HTTP
/// media/file routes; absolute paths and traversal sequences are rejected
/// before any file I/O.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AssetRequestPayload {
    pub board_id: String,
    pub kind: AssetKind,
    /// Optional HTTP Range header value (e.g. `bytes=0-1023`). `None` means
    /// full content.
    pub range: Option<String>,
    /// Optional HTTP If-None-Match header value (ETag).
    pub if_none_match: Option<String>,
}

/// First frame of an `AssetRequest` response. Subsequent frames are
/// `AssetChunk` followed by `AssetEnd`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AssetResponseHeadPayload {
    pub status: u16,
    pub headers: Vec<(String, Vec<u8>)>,
    /// Total content length when known. For `206 Partial Content` this is
    /// the byte count of the current range, not the full file.
    pub content_length: Option<u64>,
}

/// Target chunk size for asset streaming: 128 KiB. Sits inside the
/// 64–256 KiB window specified by the plan.
pub const ASSET_CHUNK_SIZE: usize = 128 * 1024;

/// Subscription topic. A single connection may host one stream at a time in
/// the current protocol; concurrent streams use parallel connections, same
/// as assets.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StreamTopic {
    /// `/events` equivalent: board-change broadcasts (JSON payloads).
    Events,
    /// `/logs/stream` equivalent: backend log lines (JSON payloads).
    Logs,
    /// Bidirectional sync for a specific board. Payloads are raw CRDT /
    /// presence bytes, identical to what the existing WebSocket carries.
    Sync { board_id: String },
}

/// Frames sent from client to server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ClientFrame {
    /// Initial frame. Server validates and responds with [`ServerFrame::HandshakeOk`]
    /// or [`ServerFrame::HandshakeRejected`].
    Handshake {
        protocol: String,
        secret: String,
    },
    /// Request mapped to the backend's HTTP router.
    ApiRequest {
        correlation_id: Uuid,
        request: ApiRequest,
    },
    /// Abort an in-flight request or stream. Explicit, not inferred from channel close.
    Cancel {
        correlation_id: Uuid,
    },
    /// Liveness probe.
    Ping,
    /// Start a streaming asset fetch. The server replies with exactly one
    /// `AssetResponseHead` followed by zero or more `AssetChunk` and one
    /// `AssetEnd`, all tagged with the same `correlation_id`.
    AssetRequest {
        correlation_id: Uuid,
        request: AssetRequestPayload,
    },
    /// Subscribe to a stream. The server pushes `StreamMessage` frames and
    /// terminates with a `StreamEnd`. The client closes the stream by
    /// sending `Cancel { correlation_id }` or dropping the connection.
    StreamSubscribe {
        correlation_id: Uuid,
        topic: StreamTopic,
    },
    /// Bidirectional streams only (e.g. `Sync`): client → server payload.
    /// Ignored for one-way topics (`Events`, `Logs`).
    StreamSend {
        correlation_id: Uuid,
        payload: Vec<u8>,
    },
    /// Open a chunked upload. Carries the request metadata; body follows as
    /// zero or more `UploadChunk` frames terminated by `UploadEnd`. The
    /// server replies with exactly one `ApiResponse` once the body is
    /// complete (or an `Error` if dispatch fails).
    UploadStart {
        correlation_id: Uuid,
        method: String,
        uri: String,
        headers: Vec<(String, Vec<u8>)>,
    },
    /// Body chunk for an active upload. Chunk size target matches the
    /// asset-streaming window (64-256 KiB).
    UploadChunk {
        correlation_id: Uuid,
        bytes: Vec<u8>,
    },
    /// Terminal marker for an upload: signals that no more `UploadChunk`
    /// frames will follow and the server can dispatch the request.
    UploadEnd {
        correlation_id: Uuid,
    },
}

/// Frames sent from server to client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ServerFrame {
    HandshakeOk,
    HandshakeRejected {
        code: HandshakeRejection,
        message: String,
    },
    ApiResponse {
        correlation_id: Uuid,
        response: ApiResponse,
    },
    Error {
        correlation_id: Option<Uuid>,
        code: String,
        message: String,
    },
    Pong,
    /// First frame of an asset response. Followed by 0..N `AssetChunk` and
    /// one `AssetEnd`.
    AssetResponseHead {
        correlation_id: Uuid,
        head: AssetResponseHeadPayload,
    },
    /// Intermediate asset chunk. `bytes` is at most `ASSET_CHUNK_SIZE`.
    AssetChunk {
        correlation_id: Uuid,
        bytes: Vec<u8>,
    },
    /// Terminal frame of an asset stream. `error` is `Some(message)` when the
    /// stream aborted partway (e.g. file I/O failure after head was sent).
    AssetEnd {
        correlation_id: Uuid,
        error: Option<String>,
    },
    /// Server-to-client stream payload. Opaque bytes; interpretation is
    /// topic-specific (JSON for Events/Logs, raw CRDT bytes for Sync).
    StreamMessage {
        correlation_id: Uuid,
        payload: Vec<u8>,
    },
    /// Terminal frame of a subscription. `error` is `Some(message)` on
    /// abnormal termination; `None` on a clean close (e.g. topic closed
    /// server-side, or client canceled).
    StreamEnd {
        correlation_id: Uuid,
        error: Option<String>,
    },
    /// Server-originated heartbeat. Used to keep the connection alive and
    /// detect dead peers in the absence of active traffic.
    Heartbeat,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum HandshakeRejection {
    ProtocolMismatch,
    SecretMismatch,
    Malformed,
}

/// Encode a frame to bytes (postcard). Does not include the length prefix.
pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, IpcError> {
    postcard::to_allocvec(value).map_err(IpcError::FrameEncode)
}

/// Decode a frame from bytes (postcard).
pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, IpcError> {
    postcard::from_bytes(bytes).map_err(IpcError::FrameEncode)
}

/// Write a length-prefixed frame to an async writer.
pub async fn write_frame<W, T>(writer: &mut W, value: &T) -> Result<(), IpcError>
where
    W: AsyncWriteExt + Unpin,
    T: Serialize,
{
    let bytes = encode(value)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(IpcError::FrameTooLarge(bytes.len()));
    }
    let len = bytes.len() as u32;
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(&bytes).await?;
    writer.flush().await?;
    Ok(())
}

/// Read one length-prefixed frame from an async reader.
///
/// Returns `Ok(None)` on clean EOF (peer closed before sending a length),
/// `Ok(Some(frame))` on a complete frame, and an error on a partial read or
/// oversized frame.
pub async fn read_frame<R, T>(reader: &mut R) -> Result<Option<T>, IpcError>
where
    R: AsyncReadExt + Unpin,
    T: for<'de> Deserialize<'de>,
{
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(IpcError::Io(e)),
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(IpcError::FrameTooLarge(len));
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await?;
    let value = decode::<T>(&body)?;
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[test]
    fn roundtrip_handshake() {
        let frame = ClientFrame::Handshake {
            protocol: "lexera-local-ipc/v1".into(),
            secret: "abc".into(),
        };
        let bytes = encode(&frame).unwrap();
        let decoded: ClientFrame = decode(&bytes).unwrap();
        assert_eq!(frame, decoded);
    }

    #[test]
    fn roundtrip_api_request() {
        let frame = ClientFrame::ApiRequest {
            correlation_id: Uuid::new_v4(),
            request: ApiRequest {
                method: "GET".into(),
                uri: "/boards".into(),
                headers: vec![("accept".into(), b"application/json".to_vec())],
                body: vec![],
            },
        };
        let bytes = encode(&frame).unwrap();
        let decoded: ClientFrame = decode(&bytes).unwrap();
        assert_eq!(frame, decoded);
    }

    #[test]
    fn roundtrip_cancel() {
        let frame = ClientFrame::Cancel {
            correlation_id: Uuid::new_v4(),
        };
        let bytes = encode(&frame).unwrap();
        let decoded: ClientFrame = decode(&bytes).unwrap();
        assert_eq!(frame, decoded);
    }

    #[test]
    fn roundtrip_handshake_rejected() {
        let frame = ServerFrame::HandshakeRejected {
            code: HandshakeRejection::SecretMismatch,
            message: "bad secret".into(),
        };
        let bytes = encode(&frame).unwrap();
        let decoded: ServerFrame = decode(&bytes).unwrap();
        assert_eq!(frame, decoded);
    }

    #[tokio::test]
    async fn write_then_read_frame_through_duplex() {
        let (mut a, mut b) = duplex(64 * 1024);
        let sent = ClientFrame::Ping;
        write_frame(&mut a, &sent).await.unwrap();
        drop(a);

        let received: Option<ClientFrame> = read_frame(&mut b).await.unwrap();
        assert_eq!(received, Some(ClientFrame::Ping));

        let eof: Option<ClientFrame> = read_frame(&mut b).await.unwrap();
        assert!(eof.is_none(), "clean EOF must yield None");
    }

    #[tokio::test]
    async fn reject_oversize_length_prefix() {
        let (mut a, mut b) = duplex(16);
        let huge_len = (MAX_FRAME_BYTES as u32 + 1).to_be_bytes();
        a.write_all(&huge_len).await.unwrap();
        drop(a);

        let err = read_frame::<_, ClientFrame>(&mut b).await.unwrap_err();
        assert!(matches!(err, IpcError::FrameTooLarge(_)));
    }

    #[tokio::test]
    async fn partial_frame_is_an_error() {
        let (mut a, mut b) = duplex(64);
        // Announce 100 bytes but send only 4.
        a.write_all(&100u32.to_be_bytes()).await.unwrap();
        a.write_all(&[0u8; 4]).await.unwrap();
        drop(a);

        let err = read_frame::<_, ClientFrame>(&mut b).await.unwrap_err();
        assert!(matches!(err, IpcError::Io(_)));
    }
}
