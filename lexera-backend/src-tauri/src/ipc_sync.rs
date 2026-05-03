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
use lexera_core::sync::{ClientMessage, ServerMessage};
use lexera_core::watcher::types::BoardChangeEvent;
use lexera_local_ipc::frame::{read_frame, write_frame, ClientFrame, ServerFrame};
use lexera_local_ipc::transport::Stream;
use lexera_local_ipc::IpcError;
use uuid::Uuid;

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// Drive one sync subscription to completion. Reads a `ClientHello`,
/// registers in the sync hub, then loops `StreamSend` ↔ hub broadcasts
/// until the client cancels or the connection drops.
pub async fn forward_sync(
    stream: &mut Stream,
    state: &AppState,
    correlation_id: Uuid,
    board_id: String,
) -> Result<(), IpcError> {
    // 1. Wait for ClientHello, carried inside a StreamSend.
    let hello_payload = loop {
        match read_frame::<_, ClientFrame>(stream).await? {
            Some(ClientFrame::StreamSend {
                correlation_id: cid,
                payload,
            }) if cid == correlation_id => break payload,
            Some(ClientFrame::Cancel {
                correlation_id: cid,
            }) if cid == correlation_id => {
                return write_frame(
                    stream,
                    &ServerFrame::StreamEnd {
                        correlation_id,
                        error: None,
                    },
                )
                .await;
            }
            Some(_) => continue,
            None => return Ok(()),
        }
    };

    let hello: ClientMessage = match serde_json::from_slice(&hello_payload) {
        Ok(m) => m,
        Err(e) => {
            return send_error_end(
                stream,
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
                stream,
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
            stream,
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
    let server_updates = state
        .storage
        .export_crdt_updates_since(&board_id, &client_vv_bytes)
        .unwrap_or_default();
    let server_vv = state.storage.get_crdt_vv(&board_id).unwrap_or_default();

    let server_hello = ServerMessage::ServerHello {
        peer_id,
        vv: b64().encode(&server_vv),
        updates: b64().encode(&server_updates),
    };
    let hello_bytes = serde_json::to_vec(&server_hello).unwrap_or_default();
    write_frame(
        stream,
        &ServerFrame::StreamMessage {
            correlation_id,
            payload: hello_bytes,
        },
    )
    .await?;

    // 6. Bidirectional loop. One task owns the stream; `tokio::select!`
    // interleaves reads from the client with broadcasts from the hub.
    let end_err: Option<String> = loop {
        tokio::select! {
            client = read_frame::<_, ClientFrame>(stream) => match client? {
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
                Some(_) => {
                    // Ignore frames unrelated to this subscription.
                }
                None => break Some("connection closed".into()),
            },
            msg = hub_rx.recv() => match msg {
                Some(text) => {
                    write_frame(
                        stream,
                        &ServerFrame::StreamMessage {
                            correlation_id,
                            payload: text.into_bytes(),
                        },
                    )
                    .await?;
                }
                None => break None,
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
        stream,
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
            if let Err(e) = state.storage.import_crdt_updates(board_id, &bytes) {
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
    stream: &mut Stream,
    correlation_id: Uuid,
    message: String,
) -> Result<(), IpcError> {
    let err = ServerMessage::ServerError {
        message: message.clone(),
    };
    if let Ok(payload) = serde_json::to_vec(&err) {
        write_frame(
            stream,
            &ServerFrame::StreamMessage {
                correlation_id,
                payload,
            },
        )
        .await?;
    }
    write_frame(
        stream,
        &ServerFrame::StreamEnd {
            correlation_id,
            error: Some(message),
        },
    )
    .await
}
