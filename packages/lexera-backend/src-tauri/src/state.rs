/// Shared application state passed to axum handlers.

use std::sync::Arc;
use lexera_core::storage::local::LocalStorage;
use lexera_core::watcher::types::BoardChangeEvent;
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
    pub incoming: Option<ResolvedIncoming>,
}
