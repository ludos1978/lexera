/// Backend-to-backend WebSocket sync client.
///
/// Manages outgoing WS connections to remote backends. Each connection
/// syncs a single remote board's CRDT data into local storage as a
/// "remote board".
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use lexera_core::storage::local::LocalStorage;
pub use lexera_core::sync::RemoteConnectionInfo;
use lexera_core::sync::{ClientMessage, ServerMessage};
use lexera_core::watcher::types::BoardChangeEvent;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

struct RemoteConnection {
    server_url: String,
    remote_board_id: String,
    local_board_id: String,
    ws_task: JoinHandle<()>,
}

pub struct SyncClientManager {
    connections: HashMap<String, RemoteConnection>,
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
    /// 1. Register user on remote server
    /// 2. Accept the invite token
    /// 3. Fetch initial board data via REST
    /// 4. Connect WS and exchange CRDT data
    pub async fn connect(
        &mut self,
        server_url: String,
        token: String,
        user_id: String,
        user_name: String,
        storage: Arc<LocalStorage>,
        event_tx: broadcast::Sender<BoardChangeEvent>,
    ) -> Result<String, String> {
        let server_url = server_url.trim_end_matches('/').to_string();
        let client = reqwest::Client::new();

        // 1. Register user on remote (ignore 409 conflict)
        let register_body = serde_json::json!({
            "id": user_id,
            "name": user_name,
        });
        let _ = client
            .post(format!("{}/collab/users/register", server_url))
            .json(&register_body)
            .send()
            .await
            .map_err(|e| format!("Register failed: {}", e))?;

        // 2. Accept invite token
        let accept_resp = client
            .post(format!(
                "{}/collab/invites/{}/accept?user={}",
                server_url, token, user_id
            ))
            .send()
            .await
            .map_err(|e| format!("Accept invite failed: {}", e))?;

        if !accept_resp.status().is_success() {
            let text = accept_resp.text().await.unwrap_or_default();
            return Err(format!("Accept invite failed: {}", text));
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

        // Generate a local board ID for the remote board
        let local_board_id = format!("remote-{}", &remote_board_id);

        // Check if already connected
        if self.connections.contains_key(&local_board_id) {
            return Err(format!(
                "Already connected to board {} on {}",
                remote_board_id, server_url
            ));
        }

        // 3. Add as remote board with placeholder data
        let placeholder_board = lexera_core::types::KanbanBoard {
            valid: true,
            title: room_title,
            columns: vec![],
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
        };
        storage.add_remote_board(&local_board_id, placeholder_board);

        // 4. Spawn WS sync task
        let ws_url = format!(
            "{}/sync/{}?user={}",
            server_url.replace("http://", "ws://").replace("https://", "wss://"),
            remote_board_id,
            user_id
        );

        let local_bid = local_board_id.clone();
        let storage_ws = storage.clone();
        let event_tx_ws = event_tx.clone();

        let ws_task = tokio::spawn(async move {
            if let Err(e) =
                run_sync_client(ws_url, user_id, local_bid.clone(), storage_ws, event_tx_ws).await
            {
                log::error!(
                    "[sync_client] WS connection to {} failed: {}",
                    local_bid,
                    e
                );
            }
        });

        self.connections.insert(
            local_board_id.clone(),
            RemoteConnection {
                server_url,
                remote_board_id,
                local_board_id: local_board_id.clone(),
                ws_task,
            },
        );

        Ok(local_board_id)
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

async fn run_sync_client(
    ws_url: String,
    user_id: String,
    local_board_id: String,
    storage: Arc<LocalStorage>,
    event_tx: broadcast::Sender<BoardChangeEvent>,
) -> Result<(), String> {
    use tokio_tungstenite::tungstenite::Message;

    let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| format!("WS connect failed: {}", e))?;

    log::info!("[sync_client] Connected to {}", ws_url);

    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // Send ClientHello with empty VV (we want all data)
    let hello = serde_json::to_string(&ClientMessage::ClientHello {
        user_id,
        vv: String::new(),
    })
    .unwrap();
    ws_tx
        .send(Message::Text(hello.into()))
        .await
        .map_err(|e| format!("Send ClientHello failed: {}", e))?;

    // Process messages
    while let Some(msg) = ws_rx.next().await {
        let msg = msg.map_err(|e| format!("WS read error: {}", e))?;
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => {
                log::info!("[sync_client] WS closed for {}", local_board_id);
                break;
            }
            Message::Ping(data) => {
                let _ = ws_tx.send(Message::Pong(data)).await;
                continue;
            }
            _ => continue,
        };

        let parsed: ServerMessage =
            serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))?;

        match parsed {
            ServerMessage::ServerHello {
                peer_id: _,
                vv: _,
                updates,
            } => {
                let bytes = b64().decode(&updates).unwrap_or_default();
                if !bytes.is_empty() {
                    if let Err(e) = storage.import_crdt_updates(&local_board_id, &bytes) {
                        log::warn!(
                            "[sync_client] Failed to import ServerHello updates: {}",
                            e
                        );
                    }
                }
                // Fire SSE event so frontend reloads
                let _ = event_tx.send(BoardChangeEvent::MainFileChanged {
                    board_id: local_board_id.clone(),
                });
            }
            ServerMessage::ServerUpdate { updates } => {
                let bytes = b64().decode(&updates).unwrap_or_default();
                if !bytes.is_empty() {
                    if let Err(e) = storage.import_crdt_updates(&local_board_id, &bytes) {
                        log::warn!(
                            "[sync_client] Failed to import ServerUpdate: {}",
                            e
                        );
                    }
                }
                let _ = event_tx.send(BoardChangeEvent::MainFileChanged {
                    board_id: local_board_id.clone(),
                });
            }
            ServerMessage::ServerError { message } => {
                log::error!(
                    "[sync_client] Server error for {}: {}",
                    local_board_id,
                    message
                );
                break;
            }
        }
    }

    Ok(())
}
