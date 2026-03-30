/// Backend-to-backend WebSocket sync client.
///
/// Manages outgoing WS connections to remote backends. Each connection
/// syncs a single remote board's CRDT data into local storage as a
/// "remote board". Also syncs media files via HTTP manifest diffing.
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use lexera_core::media::{
    compute_media_manifest, diff_media_manifests, media_folder_for_board, MediaManifestEntry,
};
use lexera_core::storage::local::LocalStorage;
pub use lexera_core::sync::RemoteConnectionInfo;
use lexera_core::sync::{ClientMessage, ServerMessage};
use lexera_core::types::KanbanBoard;
use lexera_core::watcher::types::BoardChangeEvent;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

const REMOTE_SYNC_WRITER_ID: &str = "sync-client-remote";
const SYNC_RECONNECT_MAX_DELAY_SECS: u64 = 30;
/// How often to poll for media manifest changes (seconds).
const MEDIA_SYNC_INTERVAL_SECS: u64 = 30;

struct RemoteConnection {
    server_url: String,
    remote_board_id: String,
    local_board_id: String,
    ws_task: JoinHandle<()>,
}

pub(crate) struct PendingRemoteConnection {
    pub(crate) server_url: String,
    pub(crate) remote_board_id: String,
    pub(crate) local_board_id: String,
    pub(crate) user_id: String,
    pub(crate) auth_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteBoardColumnsResponse {
    full_board: KanbanBoard,
}

fn friendly_error(context: &str, err: reqwest::Error) -> String {
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
async fn register_remote_user(
    client: &reqwest::Client,
    server_url: &str,
    user_id: &str,
    user_name: &str,
) -> Result<Option<String>, String> {
    let register_body = serde_json::json!({
        "id": user_id,
        "name": user_name,
    });
    let register_resp = client
        .post(format!("{}/collab/users/register", server_url))
        .json(&register_body)
        .send()
        .await
        .map_err(|e| friendly_error("User registration", e))?;

    let status = register_resp.status();
    if status.is_success() {
        // Extract auth token from successful registration
        let body: serde_json::Value = register_resp
            .json()
            .await
            .unwrap_or(serde_json::Value::Null);
        let token = body["token"].as_str().map(String::from);
        if token.is_some() {
            log::info!(
                "[sync_client] Registered on remote server {} and received auth token",
                server_url
            );
        }
        return Ok(token);
    }

    if status.as_u16() == 409 {
        // Already registered — no token available from register
        log::info!(
            "[sync_client] User {} already registered on {}, will get token from accept_invite",
            user_id,
            server_url
        );
        return Ok(None);
    }

    let body = register_resp.text().await.unwrap_or_default();
    log::warn!(
        "[sync_client] User registration returned unexpected status {} from {}: {}",
        status,
        server_url,
        body
    );
    Ok(None)
}

async fn fetch_remote_board_snapshot(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
) -> Result<KanbanBoard, String> {
    log::info!(
        "[sync_client] Fetching initial board snapshot remote_board_id={} server={}",
        remote_board_id,
        server_url
    );
    let mut req = client.get(format!("{}/boards/{}/columns", server_url, remote_board_id));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let board_resp = req
        .send()
        .await
        .map_err(|e| friendly_error("Initial board fetch", e))?;

    if !board_resp.status().is_success() {
        let status = board_resp.status();
        let text = board_resp.text().await.unwrap_or_default();
        return Err(format!(
            "Initial board fetch failed (HTTP {}): {}",
            status, text
        ));
    }

    let initial_board = board_resp
        .json::<RemoteBoardColumnsResponse>()
        .await
        .map_err(|e| format!("Parse initial board response: {}", e))?
        .full_board;
    log::info!(
        "[sync_client] Initial snapshot loaded remote_board_id={} title={} cards={}",
        remote_board_id,
        initial_board.title,
        initial_board
            .all_columns()
            .iter()
            .map(|col| col.cards.len())
            .sum::<usize>()
    );
    Ok(initial_board)
}

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
    ) -> Result<PendingRemoteConnection, String> {
        let server_url = server_url.trim_end_matches('/').to_string();
        let client = reqwest::Client::new();

        // 1. Register user — may return an auth token on first registration
        let register_token =
            register_remote_user(&client, &server_url, &user_id, &user_name).await?;

        // 2. Accept invite token — use register token for bearer auth.
        let mut accept_req = client.post(format!(
            "{}/collab/invites/{}/accept",
            server_url, token
        ));
        if let Some(ref t) = register_token {
            accept_req = accept_req.header("authorization", format!("Bearer {}", t));
        }
        let accept_resp = accept_req
            .send()
            .await
            .map_err(|e| friendly_error("Accept invite", e))?;

        if !accept_resp.status().is_success() {
            let status = accept_resp.status();
            let text = accept_resp.text().await.unwrap_or_default();
            let detail = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v["error"].as_str().map(String::from))
                .unwrap_or(text);
            let msg = match status.as_u16() {
                404 => format!("Invite not found or already used: {}", detail),
                400 => format!("Invite invalid: {}", detail),
                _ => format!("Accept invite failed (HTTP {}): {}", status, detail),
            };
            return Err(msg);
        }

        let join: serde_json::Value = accept_resp
            .json()
            .await
            .map_err(|e| format!("Parse join response: {}", e))?;

        let remote_board_id = join["room_id"]
            .as_str()
            .ok_or("Missing room_id in join response")?
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
    ) -> Result<PendingRemoteConnection, String> {
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
            log::warn!("[sync_client] No auth token for remote board {} — WebSocket may fail", remote_board_id);
            format!("{}/sync/{}", ws_base, remote_board_id)
        };

        let local_bid = local_board_id.clone();
        let srv_url = server_url.clone();
        let rem_bid = remote_board_id.clone();
        let at = auth_token.clone();
        let ws_task = tokio::spawn(async move {
            run_sync_client_with_reconnect(
                ws_url, user_id, local_bid, storage, event_tx, sync_hub,
                srv_url, rem_bid, at,
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

async fn run_sync_client_with_reconnect(
    ws_url: String,
    user_id: String,
    local_board_id: String,
    storage: Arc<LocalStorage>,
    event_tx: broadcast::Sender<BoardChangeEvent>,
    sync_hub: Arc<tokio::sync::Mutex<crate::sync_ws::BoardSyncHub>>,
    server_url: String,
    remote_board_id: String,
    auth_token: Option<String>,
) {
    let mut attempt: u32 = 0;
    loop {
        attempt = attempt.saturating_add(1);
        log::info!(
            "[sync_client] Starting WS sync loop board={} attempt={} url={}",
            local_board_id,
            attempt,
            ws_url
        );
        let run_result = run_sync_client(
            ws_url.clone(),
            user_id.clone(),
            local_board_id.clone(),
            storage.clone(),
            event_tx.clone(),
            sync_hub.clone(),
            server_url.clone(),
            remote_board_id.clone(),
            auth_token.clone(),
        )
        .await;
        match run_result {
            Ok(()) => {
                log::warn!(
                    "[sync_client] WS sync loop ended for board={} (attempt={}), reconnecting",
                    local_board_id,
                    attempt
                );
            }
            Err(error) => {
                log::error!(
                    "[sync_client] WS sync loop failed for board={} (attempt={}): {}",
                    local_board_id,
                    attempt,
                    error
                );
            }
        }
        let _ = event_tx.send(BoardChangeEvent::CollabConnectionChanged);

        let exp = std::cmp::min(attempt.saturating_sub(1), 5);
        let backoff_secs = std::cmp::min(1u64 << exp, SYNC_RECONNECT_MAX_DELAY_SECS);
        log::info!(
            "[sync_client] Reconnect scheduled board={} in {}s",
            local_board_id,
            backoff_secs
        );
        tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
    }
}

async fn run_sync_client(
    ws_url: String,
    user_id: String,
    local_board_id: String,
    storage: Arc<LocalStorage>,
    event_tx: broadcast::Sender<BoardChangeEvent>,
    sync_hub: Arc<tokio::sync::Mutex<crate::sync_ws::BoardSyncHub>>,
    server_url: String,
    remote_board_id: String,
    auth_token: Option<String>,
) -> Result<(), String> {
    use tokio_tungstenite::tungstenite::Message;

    let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| {
            format!(
                "WebSocket connection failed: {} (check that the remote server is running and accessible)",
                e
            )
        })?;

    log::info!("[sync_client] Connected to {}", ws_url);
    let _ = event_tx.send(BoardChangeEvent::CollabConnectionChanged);

    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // Register as a virtual peer in the local sync_hub so the frontend can
    // connect via WS and receive CRDT + presence updates for this remote board.
    let (hub_peer_id, mut hub_rx) = {
        let mut hub = sync_hub.lock().await;
        hub.register(&local_board_id, &format!("sync-client:{}", user_id))
    };
    log::info!(
        "[sync_client] Registered as hub peer {} for board {}",
        hub_peer_id,
        local_board_id
    );

    // Send ClientHello with empty VV (we want all data)
    let hello = serde_json::to_string(&ClientMessage::ClientHello {
        user_id,
        vv: String::new(),
    })
    .map_err(|e| format!("Failed to serialize ClientHello: {}", e))?;
    ws_tx
        .send(Message::Text(hello))
        .await
        .map_err(|e| format!("Send ClientHello failed: {}", e))?;

    let mut event_rx = event_tx.subscribe();
    let mut last_sent_vv = match storage.get_crdt_vv(&local_board_id) {
        Some(vv) => vv,
        None => {
            log::warn!(
                "[sync_client] Missing initial local VV for {}; starting with empty baseline",
                local_board_id
            );
            Vec::new()
        }
    };
    log::info!(
        "[sync_client] Initialized local VV baseline for {} vv_bytes={}",
        local_board_id,
        last_sent_vv.len()
    );

    // ── Initial media sync ─────────────────────────────────────────────
    let http_client = reqwest::Client::new();
    if let Some(board_path) = storage.get_board_path(&local_board_id) {
        match sync_media(
            &http_client,
            &server_url,
            &remote_board_id,
            auth_token.as_deref(),
            &board_path,
        )
        .await
        {
            Ok((dl, ul)) => {
                if dl > 0 || ul > 0 {
                    log::info!(
                        "[sync_client] Initial media sync board={}: downloaded={} uploaded={}",
                        local_board_id, dl, ul
                    );
                }
            }
            Err(e) => {
                log::warn!(
                    "[sync_client] Initial media sync failed for {}: {}",
                    local_board_id, e
                );
            }
        }
    }

    // Periodic media sync timer
    let mut media_sync_interval =
        tokio::time::interval(std::time::Duration::from_secs(MEDIA_SYNC_INTERVAL_SECS));
    media_sync_interval.tick().await; // consume the immediate first tick

    // Process remote WS messages + local hub messages + board change events + media sync.
    loop {
        tokio::select! {
            // ── Downstream: messages from remote backend ─────────────────
            maybe_msg = ws_rx.next() => {
                let msg: Message = match maybe_msg {
                    Some(msg) => msg.map_err(|e| format!("WS read error: {}", e))?,
                    None => {
                        log::info!("[sync_client] WS stream ended for {}", local_board_id);
                        break;
                    }
                };

                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => {
                        log::info!("[sync_client] WS closed for {}", local_board_id);
                        break;
                    }
                    Message::Ping(data) => {
                        if let Err(error) = ws_tx.send(Message::Pong(data)).await {
                            log::warn!(
                                "[sync_client] Failed to send Pong for {}: {}",
                                local_board_id,
                                error
                            );
                            break;
                        }
                        continue;
                    }
                    _ => continue,
                };

                let parsed: ServerMessage =
                    serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))?;

                match parsed {
                    ServerMessage::ServerHello {
                        peer_id,
                        vv,
                        updates,
                    } => {
                        let server_vv = match b64().decode(vv.as_bytes()) {
                            Ok(decoded) => decoded,
                            Err(error) => {
                                log::warn!(
                                    "[sync_client] Invalid ServerHello VV for {} (peer_id={}): {}",
                                    local_board_id,
                                    peer_id,
                                    error
                                );
                                Vec::new()
                            }
                        };
                        let bytes = match b64().decode(&updates) {
                            Ok(decoded) => decoded,
                            Err(error) => {
                                log::warn!(
                                    "[sync_client] Invalid ServerHello updates payload for {} (peer_id={}): {}",
                                    local_board_id,
                                    peer_id,
                                    error
                                );
                                Vec::new()
                            }
                        };
                        if !bytes.is_empty() {
                            if let Err(e) = storage.import_crdt_updates(&local_board_id, &bytes) {
                                log::error!(
                                    "[sync_client] Failed to import ServerHello updates for {}: {}",
                                    local_board_id,
                                    e
                                );
                                let _ = event_tx.send(BoardChangeEvent::CollabConnectionChanged);
                            } else {
                                log::info!(
                                    "[sync_client] Imported ServerHello updates for {} bytes={}",
                                    local_board_id,
                                    bytes.len()
                                );
                                if let Some(vv_after_import) = storage.get_crdt_vv(&local_board_id) {
                                    last_sent_vv = vv_after_import;
                                }
                                // Forward CRDT updates to local frontend peers via hub
                                if let Ok(fwd) = serde_json::to_string(&ServerMessage::ServerUpdate {
                                    updates: updates.clone(),
                                }) {
                                    let hub = sync_hub.lock().await;
                                    hub.broadcast(&local_board_id, hub_peer_id, &fwd);
                                }
                            }
                        }
                        log::info!(
                            "[sync_client] ServerHello processed board={} peer_id={} server_vv_bytes={} local_vv_bytes={}",
                            local_board_id,
                            peer_id,
                            server_vv.len(),
                            last_sent_vv.len()
                        );
                        // Fire SSE event so non-WS clients also know about the change.
                        if let Err(error) = event_tx.send(BoardChangeEvent::MainFileChanged {
                            board_id: local_board_id.clone(),
                            revision: storage.get_board_revision_token(&local_board_id),
                            generation: storage.get_board_generation(&local_board_id),
                            writer_id: Some(REMOTE_SYNC_WRITER_ID.to_string()),
                        }) {
                            log::warn!(
                                "[sync_client] Failed to publish ServerHello SSE event for {}: {}",
                                local_board_id,
                                error
                            );
                        }
                    }
                    ServerMessage::ServerUpdate { updates } => {
                        let bytes = match b64().decode(&updates) {
                            Ok(decoded) => decoded,
                            Err(error) => {
                                log::warn!(
                                    "[sync_client] Invalid ServerUpdate payload for {}: {}",
                                    local_board_id,
                                    error
                                );
                                Vec::new()
                            }
                        };
                        if !bytes.is_empty() {
                            if let Err(e) = storage.import_crdt_updates(&local_board_id, &bytes) {
                                log::error!(
                                    "[sync_client] Failed to import ServerUpdate for {}: {}",
                                    local_board_id,
                                    e
                                );
                                let _ = event_tx.send(BoardChangeEvent::CollabConnectionChanged);
                            } else {
                                log::info!(
                                    "[sync_client] Imported ServerUpdate for {} bytes={}",
                                    local_board_id,
                                    bytes.len()
                                );
                                if let Some(vv_after_import) = storage.get_crdt_vv(&local_board_id) {
                                    last_sent_vv = vv_after_import;
                                }
                                // Forward CRDT updates to local frontend peers via hub
                                if let Ok(fwd) = serde_json::to_string(&ServerMessage::ServerUpdate {
                                    updates: updates.clone(),
                                }) {
                                    let hub = sync_hub.lock().await;
                                    hub.broadcast(&local_board_id, hub_peer_id, &fwd);
                                }
                            }
                        }
                        if let Err(error) = event_tx.send(BoardChangeEvent::MainFileChanged {
                            board_id: local_board_id.clone(),
                            revision: storage.get_board_revision_token(&local_board_id),
                            generation: storage.get_board_generation(&local_board_id),
                            writer_id: Some(REMOTE_SYNC_WRITER_ID.to_string()),
                        }) {
                            log::warn!(
                                "[sync_client] Failed to publish ServerUpdate SSE event for {}: {}",
                                local_board_id,
                                error
                            );
                        }
                    }
                    ServerMessage::ServerError { message } => {
                        log::error!(
                            "[sync_client] Server error for {}: {}",
                            local_board_id,
                            message
                        );
                        break;
                    }
                    ServerMessage::ServerPresence { .. }
                    | ServerMessage::ServerEditingPresence { .. } => {
                        let hub = sync_hub.lock().await;
                        hub.broadcast(&local_board_id, hub_peer_id, &text);
                    }
                    ServerMessage::ServerMediaManifest { entries, .. } => {
                        // A peer sent their media manifest — diff and download missing files
                        if let Some(board_path) = storage.get_board_path(&local_board_id) {
                            let local_manifest = {
                                let p = board_path.clone();
                                tokio::task::spawn_blocking(move || compute_media_manifest(&p))
                                    .await
                                    .unwrap_or_default()
                            };
                            let to_download = diff_media_manifests(&local_manifest, &entries);
                            if !to_download.is_empty() {
                                let media_dir = media_folder_for_board(&board_path);
                                for filename in &to_download {
                                    if let Err(e) = download_media_file(
                                        &http_client, &server_url, &remote_board_id,
                                        auth_token.as_deref(), filename, &media_dir,
                                    ).await {
                                        log::warn!("[sync_client] Media download from manifest failed {}: {}", filename, e);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ── Upstream: messages from local frontend via sync_hub ──────
            maybe_hub_msg = hub_rx.recv() => {
                let maybe_hub_msg: Option<String> = maybe_hub_msg;
                match maybe_hub_msg {
                    Some(hub_msg) => {
                        // Parse the hub message to decide what to forward upstream.
                        if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&hub_msg) {
                            match server_msg {
                                ServerMessage::ServerUpdate { updates } => {
                                    // Local frontend sent a CRDT update via sync_ws → hub.
                                    // Forward upstream as ClientUpdate.
                                    let client_msg = serde_json::to_string(&ClientMessage::ClientUpdate {
                                        updates,
                                    });
                                    if let Ok(msg) = client_msg {
                                        if let Err(e) = ws_tx.send(Message::Text(msg)).await {
                                            log::warn!(
                                                "[sync_client] Failed to forward local update upstream for {}: {}",
                                                local_board_id,
                                                e
                                            );
                                            break;
                                        }
                                        if let Some(vv) = storage.get_crdt_vv(&local_board_id) {
                                            last_sent_vv = vv;
                                        }
                                        log::info!(
                                            "[sync_client] Forwarded local hub update upstream for board={}",
                                            local_board_id
                                        );
                                    }
                                }
                                ServerMessage::ServerEditingPresence {
                                    user_id: _edit_user_id,
                                    user_name,
                                    card_kid,
                                    cursor_pos,
                                    is_typing,
                                } => {
                                    // Forward local editing presence upstream.
                                    let client_msg = serde_json::to_string(&ClientMessage::ClientEditingPresence {
                                        card_kid,
                                        user_name,
                                        cursor_pos,
                                        is_typing,
                                    });
                                    if let Ok(msg) = client_msg {
                                        if let Err(e) = ws_tx.send(Message::Text(msg)).await {
                                            log::warn!(
                                                "[sync_client] Failed to forward editing presence upstream for {}: {}",
                                                local_board_id,
                                                e
                                            );
                                        }
                                    }
                                }
                                _ => {} // Ignore other server messages from hub
                            }
                        }
                    }
                    None => {
                        log::info!("[sync_client] Hub channel closed for {}", local_board_id);
                        break;
                    }
                }
            }

            // ── Upstream fallback: board change events (non-hub path) ────
            // This handles changes that don't go through sync_ws (e.g. REST
            // writes to the remote board that bypass the WS hub).
            event = event_rx.recv() => {
                match event {
                    Ok(BoardChangeEvent::MainFileChanged { board_id, writer_id, revision, generation }) => {
                        if board_id != local_board_id {
                            continue;
                        }
                        if writer_id.as_deref() == Some(REMOTE_SYNC_WRITER_ID) {
                            continue;
                        }
                        // If the event came from sync_ws (a WS peer), the hub
                        // path already forwarded the update. Only send here if
                        // the VV actually changed (covers REST-only writes).
                        let current_vv = match storage.get_crdt_vv(&local_board_id) {
                            Some(vv) => vv,
                            None => {
                                log::warn!(
                                    "[sync_client] Missing local VV for {} on MainFileChanged (writer_id={:?}, revision={:?}, generation={:?})",
                                    local_board_id,
                                    writer_id,
                                    revision,
                                    generation
                                );
                                continue;
                            }
                        };
                        if current_vv == last_sent_vv {
                            continue;
                        }

                        let mut used_full_resync = false;
                        let mut updates = match storage
                            .export_crdt_updates_since(&local_board_id, &last_sent_vv)
                        {
                            Some(bytes) => bytes,
                            None => {
                                log::warn!(
                                    "[sync_client] Failed to export incremental updates for {} (last_vv_bytes={}, current_vv_bytes={})",
                                    local_board_id,
                                    last_sent_vv.len(),
                                    current_vv.len()
                                );
                                Vec::new()
                            }
                        };
                        if updates.is_empty() {
                            used_full_resync = true;
                            log::warn!(
                                "[sync_client] Empty delta with changed VV for {}; falling back to full delta export",
                                local_board_id
                            );
                            updates = storage.export_crdt_updates_since(&local_board_id, &[]).unwrap_or_default();
                        }
                        if updates.is_empty() {
                            last_sent_vv = current_vv;
                            continue;
                        }
                        let msg = serde_json::to_string(&ClientMessage::ClientUpdate {
                            updates: b64().encode(&updates),
                        })
                        .map_err(|e| format!("Failed to serialize ClientUpdate: {}", e))?;
                        ws_tx
                            .send(Message::Text(msg))
                        .await
                        .map_err(|e| format!("Failed to send ClientUpdate: {}", e))?;
                        if let Some(vv_after_send) = storage.get_crdt_vv(&local_board_id) {
                            last_sent_vv = vv_after_send;
                        } else {
                            last_sent_vv = current_vv;
                        }
                        log::info!(
                            "[sync_client] Sent local update upstream board={} delta_bytes={} next_vv_bytes={} full_resync={}",
                            local_board_id,
                            updates.len(),
                            last_sent_vv.len(),
                            used_full_resync
                        );
                    }
                    Ok(BoardChangeEvent::MediaChanged { board_id }) => {
                        if board_id != local_board_id {
                            continue;
                        }
                        // Local media changed — sync to remote
                        if let Some(board_path) = storage.get_board_path(&local_board_id) {
                            if let Err(e) = sync_media(
                                &http_client, &server_url, &remote_board_id,
                                auth_token.as_deref(), &board_path,
                            ).await {
                                log::warn!(
                                    "[sync_client] Media sync on MediaChanged failed for {}: {}",
                                    local_board_id, e
                                );
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!(
                            "[sync_client] Event stream lagged for {} by {} events",
                            local_board_id,
                            skipped
                        );
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        log::warn!(
                            "[sync_client] Event stream closed for {}, stopping WS sync",
                            local_board_id
                        );
                        break;
                    }
                }
            }

            // ── Periodic media sync ────────────────────────────────────────
            _ = media_sync_interval.tick() => {
                if let Some(board_path) = storage.get_board_path(&local_board_id) {
                    if let Err(e) = sync_media(
                        &http_client, &server_url, &remote_board_id,
                        auth_token.as_deref(), &board_path,
                    ).await {
                        log::warn!(
                            "[sync_client] Periodic media sync failed for {}: {}",
                            local_board_id, e
                        );
                    }
                }
            }
        }
    }

    // Unregister from local hub on disconnect
    {
        let mut hub = sync_hub.lock().await;
        hub.unregister(&local_board_id, hub_peer_id);
    }
    log::info!(
        "[sync_client] Unregistered hub peer {} for board {}",
        hub_peer_id,
        local_board_id
    );

    Ok(())
}

// ── Media sync helpers ─────────────────────────────────────────────────────

/// Fetch the remote board's media manifest via HTTP.
async fn fetch_remote_media_manifest(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
) -> Result<Vec<MediaManifestEntry>, String> {
    let mut req = client.get(format!(
        "{}/boards/{}/media-manifest",
        server_url, remote_board_id
    ));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| friendly_error("Fetch media manifest", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Media manifest fetch failed (HTTP {}): {}", status, text));
    }
    resp.json()
        .await
        .map_err(|e| format!("Parse media manifest: {}", e))
}

/// Download a single media file from the remote server and save it locally.
async fn download_media_file(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
    filename: &str,
    local_media_dir: &std::path::Path,
) -> Result<(), String> {
    let mut req = client.get(format!(
        "{}/boards/{}/media/{}",
        server_url, remote_board_id, filename
    ));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| friendly_error(&format!("Download media {}", filename), e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Download media {} failed (HTTP {})",
            filename,
            resp.status()
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Read media {} body: {}", filename, e))?;
    tokio::fs::create_dir_all(local_media_dir)
        .await
        .map_err(|e| format!("Create media dir: {}", e))?;
    let file_path = local_media_dir.join(filename);
    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|e| format!("Write media {}: {}", filename, e))?;
    log::info!(
        "[sync_client] Downloaded media file {} ({} bytes)",
        filename,
        bytes.len()
    );
    Ok(())
}

/// Upload a local media file to the remote server via multipart POST.
async fn upload_media_file(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
    filename: &str,
    local_media_dir: &std::path::Path,
) -> Result<(), String> {
    let file_path = local_media_dir.join(filename);
    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("Read local media {}: {}", filename, e))?;

    let part = reqwest::multipart::Part::bytes(data)
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| format!("MIME error: {}", e))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let mut req = client.post(format!(
        "{}/boards/{}/media",
        server_url, remote_board_id
    ));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let resp = req
        .multipart(form)
        .send()
        .await
        .map_err(|e| friendly_error(&format!("Upload media {}", filename), e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Upload media {} failed (HTTP {})",
            filename,
            resp.status()
        ));
    }
    log::info!("[sync_client] Uploaded media file {} to remote", filename);
    Ok(())
}

/// Perform a full media sync: diff local vs remote manifests and transfer missing files.
async fn sync_media(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
    local_board_path: &std::path::Path,
) -> Result<(usize, usize), String> {
    let local_manifest = {
        let path = local_board_path.to_path_buf();
        tokio::task::spawn_blocking(move || compute_media_manifest(&path))
            .await
            .map_err(|e| format!("Compute local manifest: {}", e))?
    };
    let remote_manifest =
        fetch_remote_media_manifest(client, server_url, remote_board_id, auth_token).await?;

    let local_media_dir = media_folder_for_board(local_board_path);

    // Download files that remote has but we don't
    let to_download = diff_media_manifests(&local_manifest, &remote_manifest);
    let mut downloaded = 0;
    for filename in &to_download {
        match download_media_file(
            client,
            server_url,
            remote_board_id,
            auth_token,
            filename,
            &local_media_dir,
        )
        .await
        {
            Ok(()) => downloaded += 1,
            Err(e) => log::warn!("[sync_client] Failed to download media {}: {}", filename, e),
        }
    }

    // Upload files that we have but remote doesn't
    let to_upload = diff_media_manifests(&remote_manifest, &local_manifest);
    let mut uploaded = 0;
    for filename in &to_upload {
        match upload_media_file(
            client,
            server_url,
            remote_board_id,
            auth_token,
            filename,
            &local_media_dir,
        )
        .await
        {
            Ok(()) => uploaded += 1,
            Err(e) => log::warn!("[sync_client] Failed to upload media {}: {}", filename, e),
        }
    }

    if downloaded > 0 || uploaded > 0 {
        log::info!(
            "[sync_client] Media sync complete for {}: downloaded={}/{} uploaded={}/{}",
            remote_board_id,
            downloaded,
            to_download.len(),
            uploaded,
            to_upload.len()
        );
    }

    Ok((downloaded, uploaded))
}
