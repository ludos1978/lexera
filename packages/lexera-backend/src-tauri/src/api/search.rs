use axum::{
    extract::{Query, State},
    response::Json,
};
use lexera_core::search::SearchOptions;
use serde::Deserialize;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    q: Option<String>,
    #[serde(default, alias = "caseSensitive")]
    case_sensitive: Option<bool>,
    #[serde(default, alias = "useRegex")]
    regex: Option<bool>,
}

pub async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> Json<serde_json::Value> {
    let query = params.q.unwrap_or_default();
    let options = SearchOptions {
        case_sensitive: params.case_sensitive.unwrap_or(false),
        use_regex: params.regex.unwrap_or(false),
    };
    let results = state.storage.search_with_options(&query, options);
    Json(serde_json::json!({ "query": query, "results": results }))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use http_body_util::BodyExt;
    use lexera_core::storage::local::LocalStorage;
    use std::sync::Arc;
    use tower::ServiceExt;

    use crate::state::AppState;

    fn test_state(tmp: &std::path::Path) -> AppState {
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
            shutdown_tx,
        }
    }

    fn test_router(state: AppState) -> Router {
        crate::api::api_router().with_state(state)
    }

    async fn body_json(body: Body) -> serde_json::Value {
        let bytes = body.collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    fn write_board_file(dir: &std::path::Path, name: &str, content: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    const BOARD_WITH_CARDS: &str = "\
---
kanban-plugin: board
---

## Backlog
- [ ] Fix login bug
- [ ] Implement search feature

## Done
- [x] Write unit tests
";

    #[tokio::test]
    async fn search_returns_matching_cards() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "search.md", BOARD_WITH_CARDS);
        let state = test_state(tmp.path());
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/search?q=login")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["query"], "login");
        let results = json["results"].as_array().unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0]["cardContent"]
            .as_str()
            .unwrap()
            .contains("login"));
    }

    #[tokio::test]
    async fn search_nonexistent_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "search2.md", BOARD_WITH_CARDS);
        let state = test_state(tmp.path());
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/search?q=zzzznonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["query"], "zzzznonexistent");
        let results = json["results"].as_array().unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn search_without_q_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "search3.md", BOARD_WITH_CARDS);
        let state = test_state(tmp.path());
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/search")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["query"], "");
        let results = json["results"].as_array().unwrap();
        assert!(results.is_empty());
    }
}
