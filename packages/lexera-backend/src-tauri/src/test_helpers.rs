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
        clipboard_history: None,
        collab_dir: tmp.join("collab"),
        shutdown_tx,
        file_search_cache: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
    }
}

pub fn test_router(state: AppState) -> Router {
    crate::api::api_router(&state).with_state(state)
}

pub async fn body_json(body: axum::body::Body) -> serde_json::Value {
    use http_body_util::BodyExt;
    let bytes = body.collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

pub const MINIMAL_BOARD: &str = "\
---
kanban-plugin: board
---

## Col
- [ ] card
";

pub fn setup_board(tmp: &std::path::Path) -> (AppState, String) {
    let board_path = tmp.join("board.md");
    std::fs::write(&board_path, MINIMAL_BOARD).unwrap();
    let state = test_state(tmp);
    let board_id = state.storage.add_board(&board_path).unwrap();
    (state, board_id)
}

pub fn get_request(uri: &str) -> axum::http::Request<axum::body::Body> {
    axum::http::Request::builder()
        .uri(uri)
        .body(axum::body::Body::empty())
        .unwrap()
}

/// Register a test user in the auth service and return the bearer token.
pub fn register_test_user(state: &AppState) -> String {
    let mut auth = state.auth_service.lock().unwrap();
    match auth.register_user(crate::auth::User {
        id: "test-user".into(),
        name: "Test User".into(),
        email: None,
    }) {
        Ok(token) => token,
        Err(_) => {
            // Already registered — get existing token or generate new one
            auth.get_token_for_user("test-user")
                .map(|t| t.to_string())
                .unwrap_or_else(|| auth.generate_token_for_user("test-user").unwrap())
        }
    }
}

/// Create a GET request with bearer token authentication.
pub fn authed_get(uri: &str, token: &str) -> axum::http::Request<axum::body::Body> {
    axum::http::Request::builder()
        .uri(uri)
        .header("authorization", format!("Bearer {}", token))
        .body(axum::body::Body::empty())
        .unwrap()
}
