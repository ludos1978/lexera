/// Sync protocol message types shared between server (backend) and client (iOS/other backends).
///
/// Protocol:
///   Client sends ClientHello { user_id, vv } on connect.
///   Server replies ServerHello { peer_id, vv, updates }.
///   Bidirectional ClientUpdate / ServerUpdate exchange follows.
///
/// The `vv` and `updates` fields are base64-encoded binary (Loro CRDT version vectors and deltas).
use serde::{Deserialize, Serialize};

/// Messages sent from client to server.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    ClientHello { user_id: String, vv: String },
    ClientUpdate { updates: String },
    /// Ephemeral editing presence: which card this user is editing, cursor position, typing state.
    /// Send with `card_kid: None` to signal "stopped editing".
    ClientEditingPresence {
        card_kid: Option<String>,
        user_name: String,
        cursor_pos: Option<u32>,
        is_typing: bool,
    },
}

/// Messages sent from server to client.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    ServerHello {
        peer_id: u64,
        vv: String,
        updates: String,
    },
    ServerUpdate {
        updates: String,
    },
    ServerError {
        message: String,
    },
    ServerPresence {
        online_users: Vec<String>,
    },
    /// Ephemeral per-card editing presence relayed from another peer.
    ServerEditingPresence {
        user_id: String,
        user_name: String,
        card_kid: Option<String>,
        cursor_pos: Option<u32>,
        is_typing: bool,
    },
}

/// Info about a remote sync connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConnectionInfo {
    pub server_url: String,
    pub remote_board_id: String,
    pub local_board_id: String,
    pub status: String,
}
