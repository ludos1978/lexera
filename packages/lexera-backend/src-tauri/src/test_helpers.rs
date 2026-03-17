#![cfg(test)]

use crate::state::AppState;
use axum::Router;
use lexera_core::storage::local::LocalStorage;
use std::sync::Arc;

pub fn test_state(tmp: &std::path::Path) -> AppState {
    let storage = Arc::new(LocalStorage::new());
    let (event_tx, _) = tokio::sync::broadcast::channel(16);
    let (shutdown_tx, _) = tokio::sync::watch::channel(false);
    AppState {
        storage,
        event_tx,
        port: 0,
        bind_address: "127.0.0.1".into(),
        live_port: Arc::new(std::sync::Mutex::new(0)),
        server_shutdown: Arc::new(std::sync::Mutex::new(None)),
        incoming: None,
        local_user_id: "test-user".into(),
        config_path: tmp.join("config.json"),
        identity_path: tmp.join("identity.json"),
        config: Arc::new(std::sync::Mutex::new(crate::config::SyncConfig::default())),
        watcher: Arc::new(std::sync::Mutex::new(None)),
        invite_service: Arc::new(std::sync::Mutex::new(crate::invite::InviteService::new())),
        public_service: Arc::new(std::sync::Mutex::new(
            crate::public::PublicRoomService::new(),
        )),
        auth_service: Arc::new(std::sync::Mutex::new(crate::auth::AuthService::new())),
        sync_hub: Arc::new(tokio::sync::Mutex::new(crate::sync_ws::BoardSyncHub::new())),
        sync_client: Arc::new(tokio::sync::Mutex::new(
            crate::sync_client::SyncClientManager::new(),
        )),
        discovery: Arc::new(std::sync::Mutex::new(
            crate::discovery::DiscoveryService::new(),
        )),
        app_handle: None,
        collab_dir: tmp.join("collab"),
        ludos_sync: Arc::new(tokio::sync::Mutex::new(
            crate::ludos_sync::LudosSyncManager::new(tmp.join("ludos-sync.generated.json")),
        )),
        shutdown_tx,
    }
}

pub fn test_router(state: AppState) -> Router {
    crate::api::api_router().with_state(state)
}

pub async fn body_json(body: axum::body::Body) -> serde_json::Value {
    use http_body_util::BodyExt;
    let bytes = body.collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}
