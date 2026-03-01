use crate::auth::AuthService;
use crate::config::SyncConfig;
use crate::discovery::DiscoveryService;
use crate::invite::InviteService;
use crate::public::PublicRoomService;
use crate::sync_client::SyncClientManager;
use crate::sync_ws::BoardSyncHub;
use lexera_core::storage::local::LocalStorage;
use lexera_core::watcher::file_watcher::FileWatcher;
use lexera_core::watcher::types::BoardChangeEvent;
use std::path::PathBuf;
/// Shared application state passed to axum handlers.
use std::sync::Arc;
use tokio::sync::broadcast;

/// Resolved incoming config with board ID instead of file path.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ResolvedIncoming {
    pub board_id: String,
    pub column: usize,
}

#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<LocalStorage>,
    pub event_tx: broadcast::Sender<BoardChangeEvent>,
    pub port: u16,
    pub bind_address: String,
    /// The actual port the server is listening on (may differ from config if fallback was used).
    pub live_port: Arc<std::sync::Mutex<u16>>,
    /// Shutdown handle for the running HTTP server (send `true` to stop it).
    pub server_shutdown: Arc<std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
    pub incoming: Option<ResolvedIncoming>,
    pub local_user_id: String,
    pub config_path: PathBuf,
    pub identity_path: PathBuf,
    pub config: Arc<std::sync::Mutex<SyncConfig>>,
    pub watcher: Arc<std::sync::Mutex<Option<FileWatcher>>>,
    // Collaboration services wrapped in Arc<Mutex<...>> for thread safety and concurrent access
    pub invite_service: Arc<std::sync::Mutex<InviteService>>,
    pub public_service: Arc<std::sync::Mutex<PublicRoomService>>,
    pub auth_service: Arc<std::sync::Mutex<AuthService>>,
    // WebSocket CRDT sync hub (server-side, for incoming connections)
    pub sync_hub: Arc<tokio::sync::Mutex<BoardSyncHub>>,
    // WebSocket CRDT sync client (client-side, for outgoing connections to remote backends)
    pub sync_client: Arc<tokio::sync::Mutex<SyncClientManager>>,
    // UDP LAN discovery service
    pub discovery: Arc<std::sync::Mutex<DiscoveryService>>,
    // Tauri app handle for opening windows from REST handlers
    pub app_handle: tauri::AppHandle,
    // Directory for collaboration service persistence files
    pub collab_dir: PathBuf,
}
