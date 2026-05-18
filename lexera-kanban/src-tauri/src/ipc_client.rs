//! Kanban-side IPC client.
//!
//! Holds a lazy, shared [`lexera_local_ipc::Client`] connection to
//! `lexera-backend` and dispatches `ApiRequest` frames through it.
//!
//! Requests are serialized per connection (the current protocol does not
//! multiplex — frames are in-order on a single stream). If the connection
//! drops mid-request, the cached client is cleared and the next request
//! reconnects from scratch.

use lexera_local_ipc::frame::{
    read_frame, write_frame, ApiRequest, ApiResponse, ClientFrame, ServerFrame,
};
use lexera_local_ipc::{Client, Descriptor, IpcError, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Shared connection manager. Held inside Tauri state.
#[derive(Default)]
pub struct IpcClientState {
    /// `None` until the first request; refreshed on connection failure.
    conn: Mutex<Option<Client>>,
}

impl IpcClientState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Perform a single API request. Reuses the cached connection when
    /// possible; reconnects on failure.
    pub async fn request(&self, req: ApiRequest) -> Result<ApiResponse, IpcError> {
        let mut guard = self.conn.lock().await;

        // Take the cached client, or connect from scratch.
        let mut client = match guard.take() {
            Some(c) => c,
            None => Client::connect().await?,
        };

        let correlation_id = Uuid::new_v4();
        let send = ClientFrame::ApiRequest {
            correlation_id,
            request: req,
        };

        // Send + receive. On any error, the cached client is not put back.
        let result = async {
            write_frame(client.stream(), &send).await?;
            match read_frame::<_, ServerFrame>(client.stream()).await? {
                Some(ServerFrame::ApiResponse {
                    correlation_id: cid,
                    response,
                }) => {
                    if cid != correlation_id {
                        Err(IpcError::Descriptor(format!(
                            "correlation id mismatch: expected {}, got {}",
                            correlation_id, cid
                        )))
                    } else {
                        Ok(response)
                    }
                }
                Some(ServerFrame::Error { code, message, .. }) => {
                    Err(IpcError::Descriptor(format!("{}: {}", code, message)))
                }
                Some(other) => Err(IpcError::Descriptor(format!(
                    "unexpected frame: {:?}",
                    other
                ))),
                None => Err(IpcError::BackendUnavailable),
            }
        }
        .await;

        if result.is_ok() {
            *guard = Some(client);
        }
        result
    }

    /// Stream an upload over IPC: `UploadStart` + N `UploadChunk` + `UploadEnd`,
    /// then read the single `ApiResponse`. Matches the plan's
    /// `backend_ipc_upload` contract; the JS→Rust boundary takes the full
    /// body as bytes, but the Rust→backend hop chunks into
    /// [`UPLOAD_CHUNK_SIZE`]-byte pieces so the backend never buffers both
    /// the source and a single large frame.
    pub async fn upload(
        &self,
        method: String,
        uri: String,
        headers: Vec<(String, Vec<u8>)>,
        body: Vec<u8>,
    ) -> Result<ApiResponse, IpcError> {
        let mut guard = self.conn.lock().await;
        let mut client = match guard.take() {
            Some(c) => c,
            None => Client::connect().await?,
        };
        let correlation_id = Uuid::new_v4();

        let result = async {
            write_frame(
                client.stream(),
                &ClientFrame::UploadStart {
                    correlation_id,
                    method,
                    uri,
                    headers,
                },
            )
            .await?;
            for chunk in body.chunks(UPLOAD_CHUNK_SIZE) {
                write_frame(
                    client.stream(),
                    &ClientFrame::UploadChunk {
                        correlation_id,
                        bytes: chunk.to_vec(),
                    },
                )
                .await?;
            }
            write_frame(client.stream(), &ClientFrame::UploadEnd { correlation_id }).await?;

            match read_frame::<_, ServerFrame>(client.stream()).await? {
                Some(ServerFrame::ApiResponse {
                    correlation_id: cid,
                    response,
                }) if cid == correlation_id => Ok(response),
                Some(ServerFrame::Error { code, message, .. }) => {
                    Err(IpcError::Descriptor(format!("{}: {}", code, message)))
                }
                Some(other) => Err(IpcError::Descriptor(format!(
                    "unexpected frame: {:?}",
                    other
                ))),
                None => Err(IpcError::BackendUnavailable),
            }
        }
        .await;

        if result.is_ok() {
            *guard = Some(client);
        }
        result
    }
}

/// Upload chunk size: 128 KiB. Middle of the plan's 64–256 KiB window, same
/// target as asset streaming.
pub const UPLOAD_CHUNK_SIZE: usize = 128 * 1024;

/// Payload for the `backend_ipc_status` command and the `backend-status`
/// Tauri event. Matches the plan's Backend Lifecycle shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BackendStatus {
    Connected { pid: u32, endpoint: String },
    Waiting,
    Reconnecting { attempt: u32 },
    Unavailable { reason: String },
}

/// Read the descriptor and report whether the backend is reachable. Does not
/// open a connection.
pub fn status() -> BackendStatus {
    match Descriptor::read() {
        Ok(desc) => {
            if desc.protocol != PROTOCOL_VERSION {
                BackendStatus::Unavailable {
                    reason: format!(
                        "protocol mismatch: expected {}, found {}",
                        PROTOCOL_VERSION, desc.protocol
                    ),
                }
            } else if !desc.pid_alive() {
                BackendStatus::Unavailable {
                    reason: format!("stale descriptor: pid {} is not running", desc.pid),
                }
            } else {
                BackendStatus::Connected {
                    pid: desc.pid,
                    endpoint: desc.endpoint,
                }
            }
        }
        Err(IpcError::BackendUnavailable) => BackendStatus::Waiting,
        Err(e) => BackendStatus::Unavailable {
            reason: e.to_string(),
        },
    }
}

pub type SharedIpcClient = Arc<IpcClientState>;
