use axum::{extract::State, response::Json, http::StatusCode};
use lexera_core::storage::BoardStorage;

use crate::{
    api::ErrorResponse,
    calendar_tasks::{resolve_calendar_tasks, CalendarTaskBoardSource},
    state::AppState,
};

pub async fn list_calendar_tasks(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board_infos = state.storage.list_boards();
    let mut boards = Vec::with_capacity(board_infos.len());

    for info in board_infos {
        let Some(board) = state.storage.read_board(&info.id) else {
            continue;
        };
        boards.push(CalendarTaskBoardSource {
            board_id: info.id,
            board_title: info.title,
            file_path: info.file_path,
            board,
        });
    }

    let results = resolve_calendar_tasks(boards).await.map_err(|e| {
        log::error!(target: "lexera.api.calendar", "Failed to resolve calendar tasks: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
    })?;

    Ok(Json(serde_json::json!({ "results": results })))
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
            ludos_sync: Arc::new(tokio::sync::Mutex::new(
                crate::ludos_sync::LudosSyncManager::new(tmp.join("ludos-sync.generated.json")),
            )),
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

    #[tokio::test]
    async fn calendar_tasks_returns_shared_temporal_results() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(
            tmp.path(),
            "calendar-dashboard.md",
            "\
---
kanban-plugin: board
---

## Todo
- [ ] Planning parent !2026-03-20
  - Prepare slides !09:00-10:00
- [ ] Review release !2000-01-01
",
        );
        let state = test_state(tmp.path());
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/calendar/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let results = json["results"].as_array().expect("results array");
        assert_eq!(results.len(), 3);

        let summaries: Vec<&str> = results
            .iter()
            .map(|item| item["summary"].as_str().unwrap_or(""))
            .collect();
        assert!(summaries.contains(&"Prepare slides"));
        assert!(summaries.contains(&"Review release"));
    }
}
