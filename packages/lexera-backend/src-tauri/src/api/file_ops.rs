use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use lexera_core::media::{content_type_for_ext, is_previewable, media_category};
use serde::Deserialize;

use super::{err_bad_request, err_internal, err_not_found, insert_header_safe, resolve_board_file, ErrorResponse};
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

#[derive(Deserialize)]
pub struct SearchFilesBody {
    query: String,
    #[serde(default)]
    workspace_id: Option<String>,
    #[serde(default)]
    category: Option<String>, // "image", "video", "audio", "document", or empty for all
}

/// GET /boards/{board_id}/file?path=... -- serve any file relative to the board directory.
pub async fn serve_file(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(params): Query<FileQuery>,
) -> Result<(HeaderMap, Vec<u8>), (StatusCode, Json<ErrorResponse>)> {
    let file_path = resolve_board_file(&state, &board_id, &params.path)?;
    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|_| err_not_found("File not found"))?;
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
    let board_path = state
        .storage
        .get_board_path(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();
    let target = body.filename.to_lowercase();

    let matches = tokio::task::spawn_blocking(move || {
        let mut matches = Vec::new();

        fn walk(
            dir: &std::path::Path,
            base: &std::path::Path,
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
                    walk(&path, base, target, matches, depth + 1, max_depth, max_results);
                } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.to_lowercase().contains(target) {
                        // Return path relative to the board directory
                        let rel = path.strip_prefix(base)
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|_| path.to_string_lossy().to_string());
                        matches.push(rel);
                        if matches.len() >= max_results {
                            return;
                        }
                    }
                }
            }
        }

        walk(
            &board_dir,
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

/// POST /search/files -- search for files across all boards (optionally filtered by workspace).
/// Returns results with board context, media category, and relative paths suitable for embedding.
pub async fn search_files(
    State(state): State<AppState>,
    Json(body): Json<SearchFilesBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let query = body.query.trim().to_string();
    if query.is_empty() {
        return Err(err_bad_request("Search query must not be empty"));
    }

    // Collect board IDs and their paths, filtered by workspace if specified.
    let board_dirs: Vec<(String, String, std::path::PathBuf)> = {
        let cfg = state
            .config
            .lock()
            .map_err(|_| err_internal("Failed to lock config"))?;

        let boards_in_scope: Vec<&crate::config::BoardEntry> = if let Some(ref ws_id) = body.workspace_id {
            cfg.boards
                .iter()
                .filter(|b| b.workspace_ids.iter().any(|id| id == ws_id))
                .collect()
        } else {
            cfg.boards.iter().collect()
        };

        boards_in_scope
            .iter()
            .filter_map(|b| {
                let file_path = std::path::PathBuf::from(&b.file);
                let board_dir = file_path.parent()?;
                let board_name = b
                    .name
                    .clone()
                    .or_else(|| {
                        file_path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| "Untitled".to_string());
                let board_id =
                    lexera_core::storage::local::LocalStorage::board_id_from_path(&file_path);
                Some((board_id, board_name, board_dir.to_path_buf()))
            })
            .collect()
    };

    let category_filter = body.category.clone();
    let target = query.to_lowercase();

    let results = tokio::task::spawn_blocking(move || {
        let mut results: Vec<serde_json::Value> = Vec::new();
        let max_total = 50usize;

        for (board_id, board_name, board_dir) in &board_dirs {
            if results.len() >= max_total {
                break;
            }

            fn walk_search(
                dir: &std::path::Path,
                base: &std::path::Path,
                target: &str,
                category_filter: &Option<String>,
                results: &mut Vec<(String, String)>,
                depth: usize,
                max_results: usize,
            ) {
                if depth > 5 || results.len() >= max_results {
                    return;
                }
                let entries = match std::fs::read_dir(dir) {
                    Ok(e) => e,
                    Err(_) => return,
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        walk_search(
                            &path,
                            base,
                            target,
                            category_filter,
                            results,
                            depth + 1,
                            max_results,
                        );
                    } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if !name.to_lowercase().contains(target) {
                            continue;
                        }
                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("");
                        if let Some(ref cat) = category_filter {
                            if media_category(Some(ext)) != cat.as_str() {
                                continue;
                            }
                        }
                        let rel = path
                            .strip_prefix(base)
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|_| path.to_string_lossy().to_string());
                        results.push((rel, ext.to_string()));
                        if results.len() >= max_results {
                            return;
                        }
                    }
                }
            }

            let remaining = max_total - results.len();
            let mut board_matches: Vec<(String, String)> = Vec::new();
            walk_search(
                board_dir,
                board_dir,
                &target,
                &category_filter,
                &mut board_matches,
                0,
                remaining,
            );

            for (rel_path, ext) in board_matches {
                let cat = media_category(Some(&ext));
                let filename = std::path::Path::new(&rel_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&rel_path)
                    .to_string();
                results.push(serde_json::json!({
                    "boardId": board_id,
                    "boardName": board_name,
                    "path": rel_path,
                    "filename": filename,
                    "category": cat,
                    "previewable": is_previewable(Some(&ext)),
                }));
            }
        }
        results
    })
    .await
    .unwrap_or_default();

    Ok(Json(serde_json::json!({
        "query": body.query,
        "results": results,
    })))
}

/// POST /boards/{board_id}/convert-path -- convert a path between relative and absolute in a card.
pub async fn convert_path(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<ConvertPathBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board_path = state
        .storage
        .get_board_path(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;
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
            .map_err(|_| err_not_found("Cannot resolve path"))?;
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
        let canonical_file = tokio::fs::canonicalize(p)
            .await
            .map_err(|_| err_not_found("Cannot resolve path"))?;
        match canonical_file.strip_prefix(&canonical_board_dir) {
            Ok(rel) => rel.to_string_lossy().to_string(),
            Err(_) => {
                return Err(err_bad_request("File is outside board directory"));
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
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::test_helpers::{body_json, test_router, test_state};

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
