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
}

/// Info about a remote sync connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConnectionInfo {
    pub server_url: String,
    pub remote_board_id: String,
    pub local_board_id: String,
    pub status: String,
}
