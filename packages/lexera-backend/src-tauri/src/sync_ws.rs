/// WebSocket CRDT sync handler.
///
/// Protocol:
///   Client sends ClientHello { user_id, vv } on connect.
///   Server replies ServerHello { peer_id, vv, updates }.
///   Bidirectional ClientUpdate / ServerUpdate exchange follows.
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use lexera_core::sync::{ClientMessage, ServerMessage};
use std::collections::HashMap;
use tokio::sync::mpsc;

use crate::state::AppState;

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

// ── BoardSyncHub ────────────────────────────────────────────────────────────

struct BoardRoom {
    clients: HashMap<u64, mpsc::UnboundedSender<String>>,
    next_peer_id: u64,
}

impl BoardRoom {
    fn new() -> Self {
        Self {
            clients: HashMap::new(),
            next_peer_id: 1,
        }
    }
}

pub struct BoardSyncHub {
    rooms: HashMap<String, BoardRoom>,
}

impl BoardSyncHub {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
        }
    }

    /// Register a new client for a board room. Returns (peer_id, receiver).
    fn register(&mut self, board_id: &str) -> (u64, mpsc::UnboundedReceiver<String>) {
        let room = self
            .rooms
            .entry(board_id.to_string())
            .or_insert_with(BoardRoom::new);
        let peer_id = room.next_peer_id;
        room.next_peer_id += 1;
        let (tx, rx) = mpsc::unbounded_channel();
        room.clients.insert(peer_id, tx);
        (peer_id, rx)
    }

    /// Unregister a client from a board room.
    fn unregister(&mut self, board_id: &str, peer_id: u64) {
        if let Some(room) = self.rooms.get_mut(board_id) {
            room.clients.remove(&peer_id);
            if room.clients.is_empty() {
                self.rooms.remove(board_id);
            }
        }
    }

    /// Broadcast a JSON message to all clients in a board room except the sender.
    pub fn broadcast(&self, board_id: &str, exclude_peer: u64, msg: &str) {
        if let Some(room) = self.rooms.get(board_id) {
            for (&pid, tx) in &room.clients {
                if pid != exclude_peer {
                    let _ = tx.send(msg.to_string());
                }
            }
        }
    }

    /// Check if a board has any connected sync clients.
    pub fn has_clients(&self, board_id: &str) -> bool {
        self.rooms
            .get(board_id)
            .map_or(false, |r| !r.clients.is_empty())
    }
}

// ── Router + Handler ────────────────────────────────────────────────────────

pub fn sync_router() -> Router<AppState> {
    Router::new().route("/sync/{board_id}", get(ws_handler))
}

#[derive(Deserialize)]
struct SyncQuery {
    user: Option<String>,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(board_id): Path<String>,
    Query(params): Query<SyncQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let user_id = params.user.unwrap_or_default();
    ws.on_upgrade(move |socket| handle_sync_session(socket, board_id, user_id, state))
}

async fn handle_sync_session(
    socket: WebSocket,
    board_id: String,
    user_id: String,
    state: AppState,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // 1. Wait for ClientHello (10s timeout)
    let hello = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Some(Ok(msg)) = ws_rx.next().await {
            if let Message::Text(text) = msg {
                return serde_json::from_str::<ClientMessage>(&text).ok();
            }
        }
        None
    })
    .await;

    let (client_user_id, client_vv_b64) = match hello {
        Ok(Some(ClientMessage::ClientHello { user_id, vv })) => (user_id, vv),
        _ => {
            let err = serde_json::to_string(&ServerMessage::ServerError {
                message: "Expected ClientHello within 10s".to_string(),
            })
            .unwrap_or_default();
            let _ = ws_tx.send(Message::Text(err.into())).await;
            return;
        }
    };

    // 2. Auth check — use ClientHello user_id as the authoritative identity.
    // Fall back to query param only if ClientHello user_id is empty.
    let auth_user = if client_user_id.is_empty() {
        &user_id
    } else {
        &client_user_id
    };
    let authorized = if auth_user.is_empty() {
        false
    } else {
        match state.auth_service.lock() {
            Ok(auth) => auth.is_member(&board_id, auth_user),
            Err(_) => false,
        }
    };

    if !authorized {
        let err = serde_json::to_string(&ServerMessage::ServerError {
            message: "Not authorized for this board".to_string(),
        })
        .unwrap_or_default();
        let _ = ws_tx.send(Message::Text(err.into())).await;
        return;
    }

    // 3. Register in hub
    let (peer_id, mut hub_rx) = {
        let mut hub = state.sync_hub.lock().await;
        hub.register(&board_id)
    };

    log::info!(
        "[sync_ws] Peer {} connected to board {} (user={})",
        peer_id,
        board_id,
        client_user_id
    );

    // 4. Compute delta from server CRDT
    let client_vv_bytes = b64().decode(&client_vv_b64).unwrap_or_default();
    let server_updates = state
        .storage
        .export_crdt_updates_since(&board_id, &client_vv_bytes)
        .unwrap_or_default();
    let server_vv = state
        .storage
        .get_crdt_vv(&board_id)
        .unwrap_or_default();

    // 5. Send ServerHello
    let hello_msg = serde_json::to_string(&ServerMessage::ServerHello {
        peer_id,
        vv: b64().encode(&server_vv),
        updates: b64().encode(&server_updates),
    })
    .unwrap_or_default();
    if ws_tx.send(Message::Text(hello_msg.into())).await.is_err() {
        let mut hub = state.sync_hub.lock().await;
        hub.unregister(&board_id, peer_id);
        return;
    }

    // 6. Split into read and write tasks
    let board_id_read = board_id.clone();
    let state_read = state.clone();

    // Write task: forward hub messages to WebSocket
    let write_task = tokio::spawn(async move {
        while let Some(msg) = hub_rx.recv().await {
            if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Read task: process ClientUpdate messages
    let read_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            let text = match msg {
                Message::Text(t) => t,
                Message::Close(_) => break,
                _ => continue,
            };

            let parsed: ClientMessage = match serde_json::from_str(&text) {
                Ok(m) => m,
                Err(_) => continue,
            };

            match parsed {
                ClientMessage::ClientUpdate { updates } => {
                    let bytes = match b64().decode(&updates) {
                        Ok(b) => b,
                        Err(_) => continue,
                    };

                    // Import into storage CRDT
                    if let Err(e) =
                        state_read.storage.import_crdt_updates(&board_id_read, &bytes)
                    {
                        log::warn!(
                            "[sync_ws] Failed to import updates from peer {}: {}",
                            peer_id,
                            e
                        );
                        continue;
                    }

                    // Broadcast to other peers
                    let broadcast_msg =
                        serde_json::to_string(&ServerMessage::ServerUpdate {
                            updates: updates.clone(),
                        })
                        .unwrap_or_default();
                    let hub = state_read.sync_hub.lock().await;
                    hub.broadcast(&board_id_read, peer_id, &broadcast_msg);

                    // Fire SSE event so non-WS clients know something changed
                    let _ = state_read.event_tx.send(
                        lexera_core::watcher::types::BoardChangeEvent::MainFileChanged {
                            board_id: board_id_read.clone(),
                        },
                    );
                }
                _ => {} // Ignore unexpected messages
            }
        }
    });

    // Wait for either task to finish, abort the other to prevent leaks
    let mut write_task = write_task;
    let mut read_task = read_task;
    tokio::select! {
        _ = &mut write_task => { read_task.abort(); }
        _ = &mut read_task => { write_task.abort(); }
    }

    // 7. Cleanup
    let mut hub = state.sync_hub.lock().await;
    hub.unregister(&board_id, peer_id);
    log::info!(
        "[sync_ws] Peer {} disconnected from board {}",
        peer_id,
        board_id
    );
}
