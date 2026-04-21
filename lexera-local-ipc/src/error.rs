use thiserror::Error;

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("descriptor: {0}")]
    Descriptor(String),

    #[error("descriptor encode: {0}")]
    DescriptorEncode(#[from] serde_json::Error),

    #[error("frame encode: {0}")]
    FrameEncode(postcard::Error),

    #[error("frame too large: {0} bytes (max {max})", max = crate::frame::MAX_FRAME_BYTES)]
    FrameTooLarge(usize),

    #[error("protocol version mismatch: expected {expected}, got {actual}")]
    ProtocolMismatch { expected: String, actual: String },

    #[error("secret mismatch")]
    SecretMismatch,

    #[error("stale descriptor: pid {0} is not running")]
    StalePid(u32),

    #[error("peer uid {peer} does not match server uid {server}")]
    CrossUser { peer: u32, server: u32 },

    #[error("backend unavailable")]
    BackendUnavailable,

    #[error("handshake incomplete")]
    HandshakeIncomplete,
}

impl From<postcard::Error> for IpcError {
    fn from(value: postcard::Error) -> Self {
        IpcError::FrameEncode(value)
    }
}
