/// Backend-to-backend WebSocket sync client.
///
/// Manages outgoing WS connections to remote backends. Each connection
/// syncs a single remote board's CRDT data into local storage as a
/// "remote board". Also syncs media files via HTTP manifest diffing.
use lexera_core::storage::local::LocalStorage;
pub use lexera_core::sync::RemoteConnectionInfo;
use lexera_core::watcher::types::BoardChangeEvent;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

mod media;
mod remote_api;
mod replication;
use remote_api::{fetch_remote_board_snapshot, register_remote_user};
use replication::run_sync_client_with_reconnect;

struct RemoteConnection {
    server_url: String,
    remote_board_id: String,
    local_board_id: String,
    ws_task: JoinHandle<()>,
}

/// Typed error for sync-client connection preparation helpers
/// (`prepare_invite_connection`, `prepare_existing_connection`).
/// Display impls preserve the prior stringified shapes so callers
/// that format via `{}` (log lines, API error responses) read unchanged.
#[derive(Debug, thiserror::Error)]
pub(crate) enum SyncConnectionError {
    /// HTTP transport error from reqwest, pre-stringified via `friendly_error`.
    #[error("{0}")]
    Request(String),
    /// HTTP response had a non-success status. Carries context, status, body.
    #[error("{context} (HTTP {status}): {detail}")]
    Http {
        context: String,
        status: u16,
        detail: String,
    },
    /// JSON body could not be parsed.
    #[error("{context}: {source}")]
    JsonParse {
        context: String,
        source: reqwest::Error,
    },
    /// Logical validation failure (missing field, invalid state).
    #[error("{0}")]
    Validation(String),
    /// Error propagated from `remote_api` helpers.
    #[error("{0}")]
    RemoteApi(#[from] remote_api::RemoteApiError),
}

impl From<SyncConnectionError> for String {
    fn from(err: SyncConnectionError) -> String {
        err.to_string()
    }
}

pub(crate) struct PendingRemoteConnection {
    pub(crate) server_url: String,
    pub(crate) remote_board_id: String,
    pub(crate) local_board_id: String,
    pub(crate) user_id: String,
    pub(crate) auth_token: Option<String>,
}

pub(super) fn friendly_error(context: &str, err: reqwest::Error) -> String {
    if err.is_connect() {
        format!(
            "{}: Could not connect to server (is it running and accessible on the network?)",
            context
        )
    } else if err.is_timeout() {
        format!("{}: Connection timed out (check network)", context)
    } else if let Some(status) = err.status() {
        match status.as_u16() {
            401 => format!("{}: Not authorized", context),
            403 => format!("{}: Permission denied", context),
            404 => format!("{}: Not found on remote server", context),
            409 => format!("{}: Already exists (conflict)", context),
            500..=599 => format!("{}: Remote server error ({})", context, status),
            _ => format!("{}: HTTP {}", context, status),
        }
    } else if err.is_decode() {
        format!("{}: Invalid response from server", context)
    } else {
        format!("{}: {}", context, err)
    }
}

fn local_board_id_from_remote(remote_board_id: &str) -> String {
    format!("remote-{}", remote_board_id)
}

/// Register the local user on the remote server.
/// Returns the auth token on successful registration, or `None` if the user
/// already exists (409). The caller should fall back to the token returned
/// by `accept_invite` in that case.
pub struct SyncClientManager {
    connections: HashMap<String, RemoteConnection>,
}

impl Default for SyncClientManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SyncClientManager {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    /// Connect to a remote backend and sync a board.
    ///
    /// Steps:
    /// 1. Register user on remote server (captures auth token)
    /// 2. Accept the invite token (captures auth token if not from register)
    /// 3. Fetch initial board data via REST (with bearer token)
    /// 4. Connect WS and exchange CRDT data (with bearer token)
    ///
    /// Returns `(local_board_id, auth_token)` on success.
    pub fn is_connected(&self, local_board_id: &str) -> bool {
        self.connections.contains_key(local_board_id)
    }

    pub(crate) async fn prepare_invite_connection(
        server_url: String,
        token: String,
        user_id: String,
        user_name: String,
        storage: Arc<LocalStorage>,
    ) -> Result<PendingRemoteConnection, SyncConnectionError> {
        let server_url = server_url.trim_end_matches('/').to_string();
        let client = reqwest::Client::new();

        // 1. Register user — may return an auth token on first registration
        let register_token =
            register_remote_user(&client, &server_url, &user_id, &user_name).await?;

        // 2. Accept invite token — use register token for bearer auth.
        let mut accept_req =
            client.post(format!("{}/collab/invites/{}/accept", server_url, token));
        if let Some(ref t) = register_token {
            accept_req = accept_req.header("authorization", format!("Bearer {}", t));
        }
        let accept_resp = accept_req
            .send()
            .await
            .map_err(|e| SyncConnectionError::Request(friendly_error("Accept invite", e)))?;

        if !accept_resp.status().is_success() {
            let status = accept_resp.status();
            let text = accept_resp.text().await.unwrap_or_default();
            let detail = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v["error"].as_str().map(String::from))
                .unwrap_or(text);
            return Err(match status.as_u16() {
                404 => SyncConnectionError::Http {
                    context: "Accept invite".into(),
                    status: 404,
                    detail: format!("Invite not found or already used: {}", detail),
                },
                400 => SyncConnectionError::Http {
                    context: "Accept invite".into(),
                    status: 400,
                    detail: format!("Invite invalid: {}", detail),
                },
                code => SyncConnectionError::Http {
                    context: "Accept invite".into(),
                    status: code,
                    detail,
                },
            });
        }

        let join: serde_json::Value = accept_resp.json().await.map_err(|e| {
            SyncConnectionError::JsonParse {
                context: "Parse join response".into(),
                source: e,
            }
        })?;

        let remote_board_id = join["room_id"]
            .as_str()
            .ok_or_else(|| SyncConnectionError::Validation(
                "Missing room_id in join response".into(),
            ))?
            .to_string();
        let room_title = join["room_title"]
            .as_str()
            .unwrap_or("Remote Board")
            .to_string();

        // Prefer token from accept_invite (always fresh), fall back to register token
        let auth_token = join["auth_token"]
            .as_str()
            .map(String::from)
            .or(register_token);

        // Generate a local board ID for the remote board
        let local_board_id = local_board_id_from_remote(&remote_board_id);

        // 3. Fetch the initial remote board snapshot before registering the local mirror.
        let mut initial_board = fetch_remote_board_snapshot(
            &client,
            &server_url,
            &remote_board_id,
            auth_token.as_deref(),
        )
        .await?;
        if initial_board.title.trim().is_empty() {
            initial_board.title = room_title;
        }
        storage.add_remote_board(&local_board_id, initial_board);

        Ok(PendingRemoteConnection {
            server_url,
            remote_board_id,
            local_board_id,
            user_id,
            auth_token: auth_token.clone(),
        })
    }

    /// Reconnect to an already-known remote room without consuming an invite token again.
    pub(crate) async fn prepare_existing_connection(
        server_url: String,
        remote_board_id: String,
        user_id: String,
        user_name: String,
        auth_token: Option<String>,
        storage: Arc<LocalStorage>,
    ) -> Result<PendingRemoteConnection, SyncConnectionError> {
        let server_url = server_url.trim_end_matches('/').to_string();
        let local_board_id = local_board_id_from_remote(&remote_board_id);

        let client = reqwest::Client::new();
        // Re-register may yield a fresh token if the old one was lost
        let register_token =
            register_remote_user(&client, &server_url, &user_id, &user_name).await?;
        // Prefer stored auth_token, fall back to newly obtained register token
        let effective_token = auth_token.or(register_token);

        let mut initial_board = fetch_remote_board_snapshot(
            &client,
            &server_url,
            &remote_board_id,
            effective_token.as_deref(),
        )
        .await?;
        if initial_board.title.trim().is_empty() {
            initial_board.title = format!("Remote Board {}", remote_board_id);
        }
        storage.add_remote_board(&local_board_id, initial_board);

        Ok(PendingRemoteConnection {
            server_url,
            remote_board_id,
            local_board_id: local_board_id.clone(),
            user_id,
            auth_token: effective_token,
        })
    }

    /// Disconnect from a remote board.
    pub fn disconnect(&mut self, local_board_id: &str, storage: &LocalStorage) {
        if let Some(conn) = self.connections.remove(local_board_id) {
            conn.ws_task.abort();
            storage.remove_remote_board(local_board_id);
            log::info!(
                "[sync_client] Disconnected from {} (remote: {})",
                local_board_id,
                conn.remote_board_id
            );
        }
    }

    fn spawn_sync_connection(
        &mut self,
        server_url: String,
        remote_board_id: String,
        local_board_id: String,
        user_id: String,
        auth_token: Option<String>,
        storage: Arc<LocalStorage>,
        event_tx: broadcast::Sender<BoardChangeEvent>,
        sync_hub: Arc<tokio::sync::Mutex<crate::sync_ws::BoardSyncHub>>,
    ) {
        // Build WS URL with bearer token auth
        let ws_base = server_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        let ws_url = if let Some(ref token) = auth_token {
            format!("{}/sync/{}?token={}", ws_base, remote_board_id, token)
        } else {
            log::warn!(
                "[sync_client] No auth token for remote board {} — WebSocket may fail",
                remote_board_id
            );
            format!("{}/sync/{}", ws_base, remote_board_id)
        };

        let local_bid = local_board_id.clone();
        let srv_url = server_url.clone();
        let rem_bid = remote_board_id.clone();
        let at = auth_token.clone();
        let ws_task = tokio::spawn(async move {
            run_sync_client_with_reconnect(
                ws_url, user_id, local_bid, storage, event_tx, sync_hub, srv_url, rem_bid, at,
            )
            .await;
        });

        self.connections.insert(
            local_board_id.clone(),
            RemoteConnection {
                server_url,
                remote_board_id,
                local_board_id,
                ws_task,
            },
        );
    }

    pub(crate) fn register_prepared_connection(
        &mut self,
        pending: PendingRemoteConnection,
        storage: Arc<LocalStorage>,
        event_tx: broadcast::Sender<BoardChangeEvent>,
        sync_hub: Arc<tokio::sync::Mutex<crate::sync_ws::BoardSyncHub>>,
    ) -> String {
        let local_board_id = pending.local_board_id.clone();
        if self.connections.contains_key(&local_board_id) {
            return local_board_id;
        }
        self.spawn_sync_connection(
            pending.server_url,
            pending.remote_board_id,
            pending.local_board_id.clone(),
            pending.user_id,
            pending.auth_token,
            storage,
            event_tx,
            sync_hub,
        );
        local_board_id
    }

    /// List all active remote connections.
    pub fn list_connections(&self) -> Vec<RemoteConnectionInfo> {
        self.connections
            .values()
            .map(|c| RemoteConnectionInfo {
                server_url: c.server_url.clone(),
                remote_board_id: c.remote_board_id.clone(),
                local_board_id: c.local_board_id.clone(),
                status: if c.ws_task.is_finished() {
                    "disconnected".to_string()
                } else {
                    "connected".to_string()
                },
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_connection_error_validation_preserves_string_format() {
        let err = SyncConnectionError::Validation("Missing room_id in join response".into());
        assert_eq!(err.to_string(), "Missing room_id in join response");
        let s: String = err.into();
        assert_eq!(s, "Missing room_id in join response");
    }

    #[test]
    fn sync_connection_error_request_preserves_string_format() {
        let err = SyncConnectionError::Request(
            "Accept invite: Could not connect to server".into(),
        );
        let s: String = err.into();
        assert_eq!(s, "Accept invite: Could not connect to server");
    }

    #[test]
    fn sync_connection_error_http_formats_with_context_status_detail() {
        let err = SyncConnectionError::Http {
            context: "Accept invite".into(),
            status: 404,
            detail: "Invite not found or already used: expired".into(),
        };
        let s = err.to_string();
        assert!(s.contains("Accept invite"), "missing context");
        assert!(s.contains("404"), "missing status");
        assert!(s.contains("Invite not found"), "missing detail");
    }

    #[test]
    fn sync_connection_error_distinct_variants() {
        // Pin that variants stay matchable — no collapsing into string bags.
        fn _shape_check(e: SyncConnectionError) {
            match e {
                SyncConnectionError::Request(_) => {}
                SyncConnectionError::Http { .. } => {}
                SyncConnectionError::JsonParse { .. } => {}
                SyncConnectionError::Validation(_) => {}
                SyncConnectionError::RemoteApi(_) => {}
            }
        }
    }
}
