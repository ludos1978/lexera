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
use std::sync::Arc;
use tokio::sync::broadcast;

/// Resolved incoming config with board ID instead of file path.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ResolvedIncoming {
    pub board_id: String,
    pub column: usize,
}

/// Shared application state passed to all axum handlers and Tauri commands.
///
/// # Mutex fields and lock ordering
///
/// **std::sync::Mutex** — used for fields that only need short, synchronous access
/// (read/write a value, no `.await` while held):
///
/// | Field              | Contents                        |
/// |--------------------|---------------------------------|
/// | `live_port`        | Actual server port (u16)        |
/// | `server_shutdown`  | HTTP server shutdown handle      |
/// | `config`           | Persisted sync configuration     |
/// | `watcher`          | File-system watcher instance     |
/// | `invite_service`   | Invite link management           |
/// | `public_service`   | Public room management           |
/// | `auth_service`     | User/board authorization         |
/// | `discovery`        | UDP LAN peer discovery           |
///
/// **tokio::sync::Mutex** — used for fields that perform async I/O while locked
/// (WebSocket send/receive, network operations):
///
/// | Field         | Contents                                  |
/// |---------------|-------------------------------------------|
/// | `sync_hub`    | Server-side CRDT sync (incoming WS conns) |
/// | `sync_client` | Client-side CRDT sync (outgoing WS conns) |
///
/// # Lock ordering rules
///
/// **Never hold two locks simultaneously.** All current call sites acquire one
/// lock at a time and drop the guard before acquiring the next. When multiple
/// locks are needed in the same function, use scoping blocks or explicit
/// `drop()` to ensure the previous guard is released first.
///
/// Observed acquisition sequences (always sequential, never overlapping):
/// - `config` → (drop) → `auth_service`   (collab_api: update_server_config)
/// - `config` → (drop) → `live_port`      (collab_api: connection_settings)
/// - `auth_service` → (drop) → `sync_hub` (sync_ws: ws_handler)
/// - `watcher` → (drop) → `config`        (api/board: add/remove board)
/// - `server_shutdown` → (drop) → `live_port` (server: restart, lib: startup)
/// - `auth_service` → `invite_service` → `public_service` (lib: periodic save, each dropped before next)
///
/// If future code must hold two locks at once, define and document a strict
/// total order here and update all call sites to follow it.
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
    /// Global shutdown signal — send `true` to cancel all background tasks.
    pub shutdown_tx: tokio::sync::watch::Sender<bool>,
}
