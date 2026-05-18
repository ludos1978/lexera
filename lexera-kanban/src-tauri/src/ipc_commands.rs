//! Tauri commands for talking to `lexera-backend` over local IPC.
//!
//! Phase 3 ships two commands:
//!
//! - `backend_ipc_status` — non-blocking health check: reads the descriptor
//!   and reports `connected` / `waiting` / `unavailable`.
//! - `backend_ipc_request` — request/response against the backend's Axum
//!   router via IPC. Bodies are UTF-8 strings in this phase; binary paths
//!   (asset URLs, uploads) land in Phase 4.

use crate::ipc_client::{status, BackendStatus, SharedIpcClient};
use crate::ipc_streams::{self, SharedStreamRegistry, StreamMessageOut, StreamTopicArg};
use lexera_local_ipc::frame::ApiRequest;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct IpcRequestArg {
    pub method: String,
    pub uri: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct IpcResponseOut {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[tauri::command]
pub fn backend_ipc_status() -> BackendStatus {
    status()
}

/// Gap #2: authoritative URL builder for asset resources. JS may continue
/// building URLs inline for synchronous call sites; this command is the
/// abstraction point for opacity-sensitive callers and platform-specific
/// URL rewriting if Tauri ever changes the Windows auto-rewrite rules.
#[tauri::command]
pub fn backend_asset_url(board_id: String, kind: String, value: String) -> Result<String, String> {
    crate::asset_protocol::build_url(&board_id, &kind, &value)
}

#[tauri::command]
pub async fn backend_ipc_stream_open(
    caller: tauri::Webview,
    registry: tauri::State<'_, SharedStreamRegistry>,
    topic: StreamTopicArg,
    channel: Channel<StreamMessageOut>,
) -> Result<String, String> {
    let owner_window = caller.window().label().to_string();
    let id = ipc_streams::open(&registry, topic, channel, owner_window).await?;
    Ok(id.to_string())
}

#[tauri::command]
pub async fn backend_ipc_stream_close(
    registry: tauri::State<'_, SharedStreamRegistry>,
    correlation_id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&correlation_id).map_err(|e| e.to_string())?;
    ipc_streams::close(&registry, uuid).await;
    Ok(())
}

/// Send a UTF-8 payload into an active bidirectional stream (currently only
/// `Sync` uses this). Returns an error if the subscription is closed.
#[tauri::command]
pub async fn backend_ipc_stream_send(
    registry: tauri::State<'_, SharedStreamRegistry>,
    correlation_id: String,
    payload: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&correlation_id).map_err(|e| e.to_string())?;
    ipc_streams::send(&registry, uuid, payload.into_bytes()).await
}

#[derive(Debug, Deserialize)]
pub struct IpcUploadArg {
    pub method: String,
    pub uri: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// Body bytes, transferred from the webview in one invoke. The Tauri
    /// invoke boundary is the memory ceiling; the Rust→backend hop streams
    /// the body in 128 KiB chunks via `UploadChunk` frames.
    #[serde(default)]
    pub body: Vec<u8>,
}

#[tauri::command]
pub async fn backend_ipc_upload(
    client: tauri::State<'_, SharedIpcClient>,
    arg: IpcUploadArg,
) -> Result<IpcResponseOut, String> {
    let headers = arg
        .headers
        .into_iter()
        .map(|(k, v)| (k, v.into_bytes()))
        .collect();
    let resp = client
        .upload(arg.method, arg.uri, headers, arg.body)
        .await
        .map_err(|e| e.to_string())?;
    let body = String::from_utf8_lossy(&resp.body).into_owned();
    let response_headers = resp
        .headers
        .into_iter()
        .map(|(k, v)| (k, String::from_utf8_lossy(&v).into_owned()))
        .collect();
    Ok(IpcResponseOut {
        status: resp.status,
        headers: response_headers,
        body,
    })
}

#[tauri::command]
pub async fn backend_ipc_request(
    client: tauri::State<'_, SharedIpcClient>,
    arg: IpcRequestArg,
) -> Result<IpcResponseOut, String> {
    let body_bytes = arg.body.map(|s| s.into_bytes()).unwrap_or_default();
    let req = ApiRequest {
        method: arg.method,
        uri: arg.uri,
        headers: arg
            .headers
            .into_iter()
            .map(|(k, v)| (k, v.into_bytes()))
            .collect(),
        body: body_bytes,
    };

    let resp = client.request(req).await.map_err(|e| e.to_string())?;

    // Lossy UTF-8 conversion: for the JSON / text routes this phase exercises
    // the body is always UTF-8. Binary routes use the asset protocol (Phase 4).
    let body = String::from_utf8_lossy(&resp.body).into_owned();
    let headers = resp
        .headers
        .into_iter()
        .map(|(k, v)| (k, String::from_utf8_lossy(&v).into_owned()))
        .collect();

    Ok(IpcResponseOut {
        status: resp.status,
        headers,
        body,
    })
}
