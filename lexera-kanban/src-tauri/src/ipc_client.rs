//! Kanban-side IPC client.
//!
//! Holds a lazy, shared [`lexera_local_ipc::Client`] connection to
//! `lexera-backend` and dispatches `ApiRequest` frames through it.
//!
//! Requests are serialized per connection (the current protocol does not
//! multiplex — frames are in-order on a single stream). If the connection
//! drops mid-request, the cached client is cleared and the next request
//! reconnects from scratch.

use lexera_local_ipc::frame::{read_frame, write_frame, ApiRequest, ApiResponse, ClientFrame, ServerFrame};
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
                Some(ServerFrame::Error {
                    code, message, ..
                }) => Err(IpcError::Descriptor(format!("{}: {}", code, message))),
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

/// Payload for the `backend_ipc_status` command. Mirrors the planned
/// `backend-status` Tauri event shape.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum BackendStatus {
    Connected { pid: u32, endpoint: String },
    Waiting,
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
