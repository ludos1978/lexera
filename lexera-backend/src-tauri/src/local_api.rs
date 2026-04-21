//! In-process Tauri commands that back the connection-settings and
//! quick-capture windows.
//!
//! These windows live inside the `lexera-backend` Tauri process, so they can
//! reach the router directly rather than going over loopback HTTP. Phase 6
//! of the IPC migration swaps their `fetch` / `EventSource` calls onto these
//! commands via a transport shim; the HTTP server is no longer required for
//! these windows to function.

use crate::ipc_dispatch::dispatch_api_request;
use crate::state::AppState;
use lexera_local_ipc::frame::ApiRequest;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct LocalApiRequestArg {
    pub method: String,
    pub uri: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalApiResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalStreamMessage {
    pub payload: Option<String>,
    pub end: Option<Option<String>>,
}

/// Shared registry of active in-process stream subscriptions.
#[derive(Default)]
pub struct LocalStreamRegistry {
    inner: Mutex<HashMap<Uuid, tokio::task::JoinHandle<()>>>,
}

impl LocalStreamRegistry {
    pub fn new() -> Self {
        Self::default()
    }
}

pub type SharedLocalStreamRegistry = Arc<LocalStreamRegistry>;

/// In-process version of `backend_ipc_request`. Runs synchronously against
/// the router built from the current `AppState`; no socket hop.
#[tauri::command]
pub async fn backend_local_api(
    state: tauri::State<'_, AppState>,
    arg: LocalApiRequestArg,
) -> Result<LocalApiResponse, String> {
    let router = crate::server::build_app(state.inner().clone());
    let req = ApiRequest {
        method: arg.method,
        uri: arg.uri,
        headers: arg
            .headers
            .into_iter()
            .map(|(k, v)| (k, v.into_bytes()))
            .collect(),
        body: arg.body.map(|s| s.into_bytes()).unwrap_or_default(),
    };
    let resp = dispatch_api_request(router, req)
        .await
        .map_err(|e| e.to_string())?;
    let headers = resp
        .headers
        .into_iter()
        .map(|(k, v)| (k, String::from_utf8_lossy(&v).into_owned()))
        .collect();
    Ok(LocalApiResponse {
        status: resp.status,
        headers,
        body: String::from_utf8_lossy(&resp.body).into_owned(),
    })
}

/// Subscribe to board-change events and forward as `StreamMessage`s on a
/// Tauri channel. Mirrors `ipc_stream::forward_events` but writes directly
/// to the channel instead of an IPC stream.
#[tauri::command]
pub async fn backend_local_subscribe_events(
    state: tauri::State<'_, AppState>,
    registry: tauri::State<'_, SharedLocalStreamRegistry>,
    channel: Channel<LocalStreamMessage>,
) -> Result<String, String> {
    let id = Uuid::new_v4();
    let mut rx = state.event_tx.subscribe();
    let registry_arc: SharedLocalStreamRegistry = registry.inner().clone();
    let registry_for_task = registry_arc.clone();

    let task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let payload = serde_json::to_string(&event).unwrap_or_default();
                    if channel
                        .send(LocalStreamMessage {
                            payload: Some(payload),
                            end: None,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    let resync = format!(r#"{{"type":"Resync","lagged":{}}}"#, n);
                    let _ = channel.send(LocalStreamMessage {
                        payload: Some(resync),
                        end: None,
                    });
                }
                Err(RecvError::Closed) => break,
            }
        }
        let _ = channel.send(LocalStreamMessage {
            payload: None,
            end: Some(None),
        });
        registry_for_task.inner.lock().await.remove(&id);
    });

    registry_arc.inner.lock().await.insert(id, task);
    Ok(id.to_string())
}

/// Subscribe to the log-bridge stream and forward as `StreamMessage`s on a
/// Tauri channel. Mirrors `ipc_stream::forward_logs`.
#[tauri::command]
pub async fn backend_local_subscribe_logs(
    registry: tauri::State<'_, SharedLocalStreamRegistry>,
    channel: Channel<LocalStreamMessage>,
) -> Result<String, String> {
    let id = Uuid::new_v4();
    let mut rx = crate::log_bridge::subscribe();
    let registry_arc: SharedLocalStreamRegistry = registry.inner().clone();
    let registry_for_task = registry_arc.clone();

    // Emit a greeting identical in shape to the HTTP /logs/stream path.
    let greeting = crate::log_bridge::BackendLogEntry {
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        level: "info".into(),
        target: "lexera.api.logs".into(),
        message: "Connected to /logs/stream (local)".into(),
    };
    let _ = channel.send(LocalStreamMessage {
        payload: Some(serde_json::to_string(&greeting).unwrap_or_default()),
        end: None,
    });

    let task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(entry) => {
                    let payload = serde_json::to_string(&entry).unwrap_or_default();
                    if channel
                        .send(LocalStreamMessage {
                            payload: Some(payload),
                            end: None,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(RecvError::Lagged(_)) => {} // silent
                Err(RecvError::Closed) => break,
            }
        }
        let _ = channel.send(LocalStreamMessage {
            payload: None,
            end: Some(None),
        });
        registry_for_task.inner.lock().await.remove(&id);
    });

    registry_arc.inner.lock().await.insert(id, task);
    Ok(id.to_string())
}

/// Cancel an active local subscription by id.
#[tauri::command]
pub async fn backend_local_unsubscribe(
    registry: tauri::State<'_, SharedLocalStreamRegistry>,
    subscription_id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&subscription_id).map_err(|e| e.to_string())?;
    if let Some(handle) = registry.inner.lock().await.remove(&id) {
        handle.abort();
    }
    Ok(())
}
