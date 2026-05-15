//! WebSocket replication loop between this backend and a remote backend.
//!
//! `run_sync_client` is the long-running message loop that:
//!   - opens a WS connection to the remote backend
//!   - registers as a virtual hub peer for the local board so the
//!     frontend can receive the same CRDT/presence stream
//!   - imports incoming `ServerHello` / `ServerUpdate` payloads into
//!     local CRDT storage and re-broadcasts them to the local hub
//!   - forwards local hub messages (`ClientUpdate`, editing presence)
//!     upstream to the remote
//!   - emits `MainFileChanged` / `MediaChanged` events to the
//!     SSE/IPC bus so non-WS subscribers see the change
//!   - runs HTTP media sync on first connect, on `MediaChanged`, on
//!     received `ServerMediaManifest`, and on a 30 s timer
//!
//! `run_sync_client_with_reconnect` wraps the loop with exponential
//! backoff (1s → 2s → 4s → … capped at `SYNC_RECONNECT_MAX_DELAY_SECS`)
//! and is the entry point spawned by `SyncClientManager`.

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use lexera_core::media::{compute_media_manifest, diff_media_manifests, media_folder_for_board};
use lexera_core::storage::local::LocalStorage;
use lexera_core::storage::{CrdtSyncStorage, CRDT_SYNC_DISABLED_MESSAGE};
use lexera_core::sync::{ClientMessage, ServerMessage};
use lexera_core::watcher::types::BoardChangeEvent;
use std::sync::Arc;
use tokio::sync::broadcast;

use super::media::{download_media_file, sync_media};

const REMOTE_SYNC_WRITER_ID: &str = "sync-client-remote";
pub(super) const SYNC_RECONNECT_MAX_DELAY_SECS: u64 = 30;
/// How often to poll for media manifest changes (seconds).
const MEDIA_SYNC_INTERVAL_SECS: u64 = 30;

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// Typed error for the WS replication loop (`run_sync_client`).
/// Display impls preserve the prior stringified shapes so callers
/// that format via `{}` (log lines) read unchanged.
#[derive(Debug, thiserror::Error)]
pub(super) enum ReplicationError {
    #[error("{}", _0)]
    CrdtDisabled(String),
    #[error("WebSocket connection failed: {} (check that the remote server is running and accessible)", _0)]
    WsConnect(String),
    #[error("Failed to serialize {}: {}", _0, _1)]
    Serialize(String, String),
    #[error("Send {} failed: {}", _0, _1)]
    SendFailed(String, String),
    #[error("WS read error: {}", _0)]
    WsRead(String),
    #[error("Parse error: {}", _0)]
    Parse(String),
}

impl From<ReplicationError> for String {
    fn from(err: ReplicationError) -> String {
        err.to_string()
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn run_sync_client_with_reconnect(
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
    if !CrdtSyncStorage::crdt_sync_available(storage.as_ref()) {
        log::warn!(
            "[sync_client] {} - remote sync disabled for board={}",
            CRDT_SYNC_DISABLED_MESSAGE,
            local_board_id
        );
        let _ = event_tx.send(BoardChangeEvent::CollabConnectionChanged);
        return;
    }

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

#[allow(clippy::too_many_arguments)]
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
) -> Result<(), ReplicationError> {
    use tokio_tungstenite::tungstenite::Message;

    if !CrdtSyncStorage::crdt_sync_available(storage.as_ref()) {
        return Err(ReplicationError::CrdtDisabled(CRDT_SYNC_DISABLED_MESSAGE.to_string()));
    }

    let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| ReplicationError::WsConnect(e.to_string()))?;

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
    .map_err(|e| ReplicationError::Serialize("ClientHello".into(), e.to_string()))?;
    ws_tx
        .send(Message::Text(hello))
        .await
        .map_err(|e| ReplicationError::SendFailed("ClientHello".into(), e.to_string()))?;

    let mut event_rx = event_tx.subscribe();
    let mut last_sent_vv = match CrdtSyncStorage::get_crdt_vv(storage.as_ref(), &local_board_id) {
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
                        local_board_id,
                        dl,
                        ul
                    );
                }
            }
            Err(e) => {
                log::warn!(
                    "[sync_client] Initial media sync failed for {}: {}",
                    local_board_id,
                    e
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
                    Some(msg) => msg.map_err(|e| ReplicationError::WsRead(e.to_string()))?,
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
                    serde_json::from_str(&text).map_err(|e| ReplicationError::Parse(e.to_string()))?;

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
                            if let Err(e) = CrdtSyncStorage::import_crdt_updates(
                                storage.as_ref(),
                                &local_board_id,
                                &bytes,
                            ) {
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
                                if let Some(vv_after_import) =
                                    CrdtSyncStorage::get_crdt_vv(storage.as_ref(), &local_board_id)
                                {
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
                            if let Err(e) = CrdtSyncStorage::import_crdt_updates(
                                storage.as_ref(),
                                &local_board_id,
                                &bytes,
                            ) {
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
                                if let Some(vv_after_import) =
                                    CrdtSyncStorage::get_crdt_vv(storage.as_ref(), &local_board_id)
                                {
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
                                        if let Some(vv) = CrdtSyncStorage::get_crdt_vv(
                                            storage.as_ref(),
                                            &local_board_id,
                                        ) {
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
                        let current_vv = match CrdtSyncStorage::get_crdt_vv(
                            storage.as_ref(),
                            &local_board_id,
                        ) {
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
                        let mut updates = match CrdtSyncStorage::export_crdt_updates_since(
                            storage.as_ref(),
                            &local_board_id,
                            &last_sent_vv,
                        ) {
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
                            updates = CrdtSyncStorage::export_crdt_updates_since(
                                storage.as_ref(),
                                &local_board_id,
                                &[],
                            )
                            .unwrap_or_default();
                        }
                        if updates.is_empty() {
                            last_sent_vv = current_vv;
                            continue;
                        }
                        let msg = serde_json::to_string(&ClientMessage::ClientUpdate {
                            updates: b64().encode(&updates),
                        })
                        .map_err(|e| ReplicationError::Serialize("ClientUpdate".into(), e.to_string()))?;
                        ws_tx
                            .send(Message::Text(msg))
                        .await
                        .map_err(|e| ReplicationError::SendFailed("ClientUpdate".into(), e.to_string()))?;
                        if let Some(vv_after_send) =
                            CrdtSyncStorage::get_crdt_vv(storage.as_ref(), &local_board_id)
                        {
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
                    Ok(BoardChangeEvent::MediaChanged { board_id, .. }) => {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replication_error_ws_connect_preserves_wire_format() {
        let err = ReplicationError::WsConnect("connection refused".into());
        let s = err.to_string();
        assert!(
            s.contains("WebSocket connection failed"),
            "missing context: {}",
            s
        );
        assert!(s.contains("connection refused"), "missing detail: {}", s);
        assert!(
            s.contains("remote server is running"),
            "missing hint: {}",
            s
        );
    }

    #[test]
    fn replication_error_serialize_preserves_context() {
        let err = ReplicationError::Serialize("ClientHello".into(), "unexpected eof".into());
        let s = err.to_string();
        assert!(s.contains("ClientHello"), "missing context: {}", s);
        assert!(s.contains("unexpected eof"), "missing detail: {}", s);
    }

    #[test]
    fn replication_error_crdt_disabled_carries_message() {
        let err =
            ReplicationError::CrdtDisabled("CRDT sync is disabled in this build".into());
        assert!(err.to_string().contains("CRDT sync is disabled"));
    }

    #[test]
    fn replication_error_from_for_string_uses_display() {
        let err = ReplicationError::Parse("expected bracket".into());
        let s: String = err.into();
        assert!(s.contains("Parse error"));
        assert!(s.contains("expected bracket"));
    }

    #[test]
    fn replication_error_distinct_variants() {
        fn _shape_check(e: ReplicationError) {
            match e {
                ReplicationError::CrdtDisabled(_) => {}
                ReplicationError::WsConnect(_) => {}
                ReplicationError::Serialize(_, _) => {}
                ReplicationError::SendFailed(_, _) => {}
                ReplicationError::WsRead(_) => {}
                ReplicationError::Parse(_) => {}
            }
        }
    }
}
