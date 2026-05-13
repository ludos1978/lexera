//! Bidirectional CRDT sync over IPC.
//!
//! Ports `sync_ws::handle_sync_session` from WebSocket to IPC frames:
//!
//! - `ClientMessage` JSON arrives as `ClientFrame::StreamSend { payload }`.
//! - `ServerMessage` JSON departs as `ServerFrame::StreamMessage { payload }`.
//! - The WebSocket ping keepalive is dropped; IPC is local and connection
//!   loss is immediate.
//! - The WebSocket bearer-token auth is dropped; the IPC channel is already
//!   authenticated by the descriptor-secret handshake. `auth_user` comes
//!   from the `ClientHello`'s `user_id` field (or `state.local_user_id` as
//!   fallback).

use crate::state::AppState;
use base64::Engine;
use lexera_core::storage::{CrdtSyncStorage, CRDT_SYNC_DISABLED_MESSAGE};
use lexera_core::sync::{ClientMessage, ServerMessage};
use lexera_core::watcher::types::BoardChangeEvent;
use lexera_local_ipc::frame::{write_frame, ClientFrame, ServerFrame};
use lexera_local_ipc::transport::Stream;
use lexera_local_ipc::IpcError;
use tokio::io::WriteHalf;
use tokio::sync::mpsc;
use uuid::Uuid;

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// Drive one sync subscription to completion. Reads a `ClientHello`,
/// registers in the sync hub, then loops `StreamSend` ↔ hub broadcasts
/// until the client cancels or the connection drops.
pub async fn forward_sync(
    write_half: &mut WriteHalf<Stream>,
    control_rx: &mut mpsc::Receiver<ClientFrame>,
    state: &AppState,
    correlation_id: Uuid,
    board_id: String,
) -> Result<(), IpcError> {
    if !CrdtSyncStorage::crdt_sync_available(state.storage.as_ref()) {
        return send_error_end(
            write_half,
            correlation_id,
            CRDT_SYNC_DISABLED_MESSAGE.to_string(),
        )
        .await;
    }

    // 1. Wait for ClientHello, carried inside a StreamSend.
    let hello_payload = loop {
        match control_rx.recv().await {
            Some(ClientFrame::StreamSend {
                correlation_id: cid,
                payload,
            }) if cid == correlation_id => break payload,
            Some(ClientFrame::Cancel {
                correlation_id: cid,
            }) if cid == correlation_id => {
                return write_frame(
                    write_half,
                    &ServerFrame::StreamEnd {
                        correlation_id,
                        error: None,
                    },
                )
                .await;
            }
            Some(ClientFrame::Ping) => {
                let _ = write_frame(write_half, &ServerFrame::Pong).await;
            }
            Some(_) => continue,
            None => return Ok(()),
        }
    };

    let hello: ClientMessage = match serde_json::from_slice(&hello_payload) {
        Ok(m) => m,
        Err(e) => {
            return send_error_end(
                write_half,
                correlation_id,
                format!("Invalid ClientHello JSON: {}", e),
            )
            .await;
        }
    };

    let (hello_user_id, client_vv_b64) = match hello {
        ClientMessage::ClientHello { user_id, vv } => (user_id, vv),
        _ => {
            return send_error_end(
                write_half,
                correlation_id,
                "Expected ClientHello as first sync message".into(),
            )
            .await;
        }
    };

    // 2. Resolve auth user. IPC is already channel-authed, so skip the token
    // validation path; use the hello's user id or the local user as fallback.
    let auth_user = if hello_user_id.is_empty() {
        state.local_user_id.clone()
    } else {
        hello_user_id.clone()
    };

    // 3. Board authorization (identical to the WS path).
    let is_remote = state.storage.is_remote_board(&board_id);
    let authorized = if auth_user.is_empty() {
        false
    } else if is_remote {
        true
    } else {
        match state.auth_service.read() {
            Ok(auth) => auth.is_member(&board_id, &auth_user),
            Err(_) => false,
        }
    };
    if !authorized {
        return send_error_end(
            write_half,
            correlation_id,
            "Not authorized for this board".into(),
        )
        .await;
    }

    // 4. Register in hub and broadcast presence.
    let (peer_id, mut hub_rx) = {
        let mut hub = state.sync_hub.lock().await;
        let result = hub.register(&board_id, &auth_user);
        if let Ok(presence_msg) = serde_json::to_string(&ServerMessage::ServerPresence {
            online_users: hub.online_users(&board_id),
        }) {
            hub.broadcast_all(&board_id, &presence_msg);
        }
        result
    };

    log::info!(
        target: "lexera.ipc.sync",
        "peer {} connected to board {} user={}",
        peer_id, board_id, auth_user
    );

    // 5. Compute delta + send ServerHello.
    let client_vv_bytes = b64().decode(&client_vv_b64).unwrap_or_default();
    let server_updates = CrdtSyncStorage::export_crdt_updates_since(
        state.storage.as_ref(),
        &board_id,
        &client_vv_bytes,
    )
    .unwrap_or_default();
    let server_vv =
        CrdtSyncStorage::get_crdt_vv(state.storage.as_ref(), &board_id).unwrap_or_default();

    let server_hello = ServerMessage::ServerHello {
        peer_id,
        vv: b64().encode(&server_vv),
        updates: b64().encode(&server_updates),
    };
    let hello_bytes = serde_json::to_vec(&server_hello).unwrap_or_default();
    write_frame(
        write_half,
        &ServerFrame::StreamMessage {
            correlation_id,
            payload: hello_bytes,
        },
    )
    .await?;

    // 6. Bidirectional loop.

    // Heartbeat every 30s when idle.
    let mut heartbeat_interval = tokio::time::interval(std::time::Duration::from_secs(30));
    heartbeat_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let end_err: Option<String> = loop {
        tokio::select! {
            client_msg = control_rx.recv() => match client_msg {
                Some(ClientFrame::Cancel { correlation_id: cid }) if cid == correlation_id => {
                    break None;
                }
                Some(ClientFrame::StreamSend { correlation_id: cid, payload })
                    if cid == correlation_id =>
                {
                    handle_client_message(
                        state,
                        &board_id,
                        peer_id,
                        &auth_user,
                        &payload,
                    )
                    .await;
                }
                Some(ClientFrame::Ping) => {
                    let _ = write_frame(write_half, &ServerFrame::Pong).await;
                }
                Some(_) => {}
                None => break Some("connection closed".into()),
            },
            msg = hub_rx.recv() => match msg {
                Some(text) => {
                    if let Err(e) = write_frame(
                        write_half,
                        &ServerFrame::StreamMessage {
                            correlation_id,
                            payload: text.into_bytes(),
                        },
                    ).await {
                        break Some(format!("write failed: {}", e));
                    }
                }
                None => break None,
            },
            _ = heartbeat_interval.tick() => {
                if let Err(e) = write_frame(write_half, &ServerFrame::Heartbeat).await {
                    break Some(format!("heartbeat write failed: {}", e));
                }
            }
        }
    };

    // 7. Unregister and broadcast updated presence.
    {
        let mut hub = state.sync_hub.lock().await;
        hub.unregister(&board_id, peer_id);
        if let Ok(presence_msg) = serde_json::to_string(&ServerMessage::ServerPresence {
            online_users: hub.online_users(&board_id),
        }) {
            hub.broadcast_all(&board_id, &presence_msg);
        }
    }

    write_frame(
        write_half,
        &ServerFrame::StreamEnd {
            correlation_id,
            error: end_err,
        },
    )
    .await
}

async fn handle_client_message(
    state: &AppState,
    board_id: &str,
    peer_id: u64,
    auth_user: &str,
    payload: &[u8],
) {
    let parsed: ClientMessage = match serde_json::from_slice(payload) {
        Ok(m) => m,
        Err(e) => {
            log::warn!(
                target: "lexera.ipc.sync",
                "peer {} sent unparseable ClientMessage on board {}: {}",
                peer_id, board_id, e
            );
            return;
        }
    };
    match parsed {
        ClientMessage::ClientUpdate { updates } => {
            let bytes = match b64().decode(&updates) {
                Ok(b) => b,
                Err(e) => {
                    log::warn!(
                        target: "lexera.ipc.sync",
                        "peer {} sent invalid ClientUpdate base64: {}",
                        peer_id, e
                    );
                    return;
                }
            };
            if let Err(e) =
                CrdtSyncStorage::import_crdt_updates(state.storage.as_ref(), board_id, &bytes)
            {
                log::warn!(
                    target: "lexera.ipc.sync",
                    "peer {} failed to import updates: {}",
                    peer_id, e
                );
                return;
            }
            let broadcast_msg = match serde_json::to_string(&ServerMessage::ServerUpdate {
                updates: updates.clone(),
            }) {
                Ok(msg) => msg,
                Err(e) => {
                    log::error!(
                        target: "lexera.ipc.sync",
                        "serialize ServerUpdate for board {}: {}",
                        board_id, e
                    );
                    return;
                }
            };
            {
                let hub = state.sync_hub.lock().await;
                hub.broadcast(board_id, peer_id, &broadcast_msg);
            }
            // Fire a board-change event so SSE/IPC event subscribers refresh.
            let _ = state.event_tx.send(BoardChangeEvent::MainFileChanged {
                board_id: board_id.to_string(),
                revision: state.storage.get_board_revision_token(board_id),
                generation: state.storage.get_board_generation(board_id),
                writer_id: Some("sync-ipc-peer".to_string()),
            });
        }
        ClientMessage::ClientEditingPresence {
            card_kid,
            user_name,
            cursor_pos,
            is_typing,
        } => {
            let msg = match serde_json::to_string(&ServerMessage::ServerEditingPresence {
                user_id: auth_user.to_string(),
                user_name,
                card_kid,
                cursor_pos,
                is_typing,
            }) {
                Ok(msg) => msg,
                Err(e) => {
                    log::error!(
                        target: "lexera.ipc.sync",
                        "serialize ServerEditingPresence for board {}: {}",
                        board_id, e
                    );
                    return;
                }
            };
            let hub = state.sync_hub.lock().await;
            hub.broadcast(board_id, peer_id, &msg);
        }
        ClientMessage::ClientMediaManifest { entries } => {
            let msg = match serde_json::to_string(&ServerMessage::ServerMediaManifest {
                peer_id,
                entries,
            }) {
                Ok(msg) => msg,
                Err(e) => {
                    log::error!(
                        target: "lexera.ipc.sync",
                        "serialize ServerMediaManifest for board {}: {}",
                        board_id, e
                    );
                    return;
                }
            };
            let hub = state.sync_hub.lock().await;
            hub.broadcast(board_id, peer_id, &msg);
        }
        ClientMessage::ClientHello { .. } => {
            log::warn!(
                target: "lexera.ipc.sync",
                "peer {} sent a second ClientHello; ignoring",
                peer_id
            );
        }
    }
}

async fn send_error_end(
    write_half: &mut WriteHalf<Stream>,
    correlation_id: Uuid,
    message: String,
) -> Result<(), IpcError> {
    let err = ServerMessage::ServerError {
        message: message.clone(),
    };
    if let Ok(payload) = serde_json::to_vec(&err) {
        write_frame(
            write_half,
            &ServerFrame::StreamMessage {
                correlation_id,
                payload,
            },
        )
        .await?;
    }
    write_frame(
        write_half,
        &ServerFrame::StreamEnd {
            correlation_id,
            error: Some(message),
        },
    )
    .await
}
