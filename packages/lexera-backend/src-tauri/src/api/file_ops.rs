use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use lexera_core::media::{content_type_for_ext, is_previewable, media_category};
use serde::Deserialize;

use super::{insert_header_safe, resolve_board_file, ErrorResponse};
use crate::state::AppState;

/// Maximum directory depth for recursive file search.
const FILE_SEARCH_MAX_DEPTH: usize = 5;
/// Maximum number of matching files returned by find-file.
const FILE_SEARCH_MAX_RESULTS: usize = 20;
/// Cache-Control header value for served static files (1 hour).
const STATIC_FILE_CACHE_CONTROL: &str = "public, max-age=3600";

#[derive(Deserialize)]
pub struct FileQuery {
    path: String,
}

#[derive(Deserialize)]
pub struct FindFileBody {
    filename: String,
}

#[derive(Deserialize)]
pub struct ConvertPathBody {
    path: String,
    to: String, // "relative" or "absolute"
}

/// GET /boards/{board_id}/file?path=... -- serve any file relative to the board directory.
pub async fn serve_file(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(params): Query<FileQuery>,
) -> Result<(HeaderMap, Vec<u8>), (StatusCode, Json<ErrorResponse>)> {
    let file_path = resolve_board_file(&state, &board_id, &params.path)?;
    let data = tokio::fs::read(&file_path).await.map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "File not found".to_string(),
            }),
        )
    })?;
    let ext = file_path.extension().and_then(|e| e.to_str());
    let ct = content_type_for_ext(ext);
    let mut headers = HeaderMap::new();
    insert_header_safe(&mut headers, "content-type", ct);
    insert_header_safe(&mut headers, "cache-control", STATIC_FILE_CACHE_CONTROL);
    if let Ok(meta) = tokio::fs::metadata(&file_path).await {
        if let Ok(modified) = meta.modified() {
            if let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) {
                let modified_value = dur.as_secs().to_string();
                insert_header_safe(&mut headers, "last-modified", &modified_value);
            }
        }
        let len_value = meta.len().to_string();
        insert_header_safe(&mut headers, "content-length", &len_value);
    }
    Ok((headers, data))
}

/// GET /boards/{board_id}/file-info?path=... -- return metadata about a file.
pub async fn file_info(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(params): Query<FileQuery>,
) -> Json<serde_json::Value> {
    let fp = match resolve_board_file(&state, &board_id, &params.path) {
        Ok(p) => p,
        Err(_) => {
            return Json(serde_json::json!({
                "exists": false,
                "path": params.path,
                "filename": std::path::Path::new(&params.path).file_name().and_then(|s| s.to_str()).unwrap_or(""),
            }));
        }
    };
    let ext = fp
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    let ext_ref = ext.as_deref();
    let meta = tokio::fs::metadata(&fp).await.ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let last_modified = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let last_modified_ms = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Json(serde_json::json!({
        "exists": true,
        "path": params.path,
        "filename": fp.file_name().and_then(|s| s.to_str()).unwrap_or(""),
        "extension": ext.as_deref().unwrap_or(""),
        "size": size,
        "lastModified": last_modified,
        "lastModifiedMs": last_modified_ms,
        "mediaCategory": media_category(ext_ref),
        "previewable": is_previewable(ext_ref),
    }))
}

/// POST /boards/{board_id}/find-file -- search for files matching a filename in the board dir tree.
pub async fn find_file(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<FindFileBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board_path = state.storage.get_board_path(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();
    let target = body.filename.to_lowercase();

    let matches = tokio::task::spawn_blocking(move || {
        let mut matches = Vec::new();

        fn walk(
            dir: &std::path::Path,
            target: &str,
            matches: &mut Vec<String>,
            depth: usize,
            max_depth: usize,
            max_results: usize,
        ) {
            if depth > max_depth {
                return;
            }
            let entries = match std::fs::read_dir(dir) {
                Ok(e) => e,
                Err(_) => return,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, target, matches, depth + 1, max_depth, max_results);
                } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.to_lowercase().contains(target) {
                        matches.push(path.to_string_lossy().to_string());
                        if matches.len() >= max_results {
                            return;
                        }
                    }
                }
            }
        }

        walk(
            &board_dir,
            &target,
            &mut matches,
            0,
            FILE_SEARCH_MAX_DEPTH,
            FILE_SEARCH_MAX_RESULTS,
        );
        matches
    })
    .await
    .unwrap_or_default();

    Ok(Json(serde_json::json!({
        "query": body.filename,
        "matches": matches,
    })))
}

/// POST /boards/{board_id}/convert-path -- convert a path between relative and absolute in a card.
pub async fn convert_path(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<ConvertPathBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board_path = state.storage.get_board_path(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));

    let new_path = if body.to == "absolute" {
        let p = std::path::Path::new(&body.path);
        if p.is_absolute() {
            return Ok(Json(
                serde_json::json!({ "path": body.path, "changed": false }),
            ));
        }
        let abs = tokio::fs::canonicalize(board_dir.join(&body.path))
            .await
            .map_err(|_| {
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Cannot resolve path".to_string(),
                    }),
                )
            })?;
        abs.to_string_lossy().to_string()
    } else {
        // to relative
        let p = std::path::Path::new(&body.path);
        if !p.is_absolute() {
            return Ok(Json(
                serde_json::json!({ "path": body.path, "changed": false }),
            ));
        }
        let canonical_board_dir = tokio::fs::canonicalize(&board_dir)
            .await
            .unwrap_or_else(|_| board_dir.to_path_buf());
        let canonical_file = tokio::fs::canonicalize(p).await.map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Cannot resolve path".to_string(),
                }),
            )
        })?;
        match canonical_file.strip_prefix(&canonical_board_dir) {
            Ok(rel) => rel.to_string_lossy().to_string(),
            Err(_) => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: "File is outside board directory".to_string(),
                    }),
                ));
            }
        }
    };

    Ok(Json(serde_json::json!({
        "path": new_path,
        "changed": true,
    })))
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

    const MINIMAL_BOARD: &str = "\
---
kanban-plugin: board
---

## Col
- [ ] card
";

    #[tokio::test]
    async fn serve_file_returns_content() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = tmp.path().join("board.md");
        std::fs::write(&board_path, MINIMAL_BOARD).unwrap();
        std::fs::write(tmp.path().join("hello.txt"), "hello world").unwrap();

        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(&format!("/boards/{}/file?path=hello.txt", board_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&bytes[..], b"hello world");
    }

    #[tokio::test]
    async fn file_info_returns_metadata() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = tmp.path().join("board.md");
        std::fs::write(&board_path, MINIMAL_BOARD).unwrap();
        std::fs::write(tmp.path().join("data.txt"), "12345").unwrap();

        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(&format!("/boards/{}/file-info?path=data.txt", board_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["exists"], true);
        assert_eq!(json["size"], 5);
        assert_eq!(json["filename"], "data.txt");
    }

    #[tokio::test]
    async fn serve_file_blocks_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = tmp.path().join("board.md");
        std::fs::write(&board_path, MINIMAL_BOARD).unwrap();

        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(&format!(
                        "/boards/{}/file?path=../../../etc/passwd",
                        board_id
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Relative traversal outside the board dir: FORBIDDEN if the target exists, NOT_FOUND otherwise
        assert!(
            resp.status() == StatusCode::FORBIDDEN || resp.status() == StatusCode::NOT_FOUND,
            "Expected FORBIDDEN or NOT_FOUND for traversal, got {}",
            resp.status()
        );
    }

    #[tokio::test]
    async fn serve_file_blocks_absolute_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = tmp.path().join("board.md");
        std::fs::write(&board_path, MINIMAL_BOARD).unwrap();

        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(&format!(
                        "/boards/{}/file?path=/etc/passwd",
                        board_id
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Absolute path outside the board directory must be rejected
        assert!(
            resp.status() == StatusCode::FORBIDDEN || resp.status() == StatusCode::NOT_FOUND,
            "Expected FORBIDDEN or NOT_FOUND for /etc/passwd, got {}",
            resp.status()
        );
    }
}
