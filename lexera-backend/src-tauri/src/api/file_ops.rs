use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use lexera_core::media::{content_type_for_ext, is_previewable, media_category};
use serde::Deserialize;

use super::{
    err_bad_request, err_internal, err_not_found, insert_header_safe, resolve_board_file,
    ErrorResponse,
};
use crate::state::AppState;

/// Maximum directory depth for recursive file search.
const FILE_SEARCH_MAX_DEPTH: usize = 5;
/// Maximum number of matching files returned by find-file.
const FILE_SEARCH_MAX_RESULTS: usize = 20;
/// Maximum number of boards searched in parallel for global file search.
const FILE_SEARCH_BOARD_CONCURRENCY: usize = 8;
/// Maximum number of concurrent file metadata lookups for batch requests.
const FILE_INFO_BATCH_MAX_CONCURRENCY: usize = 16;
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

#[derive(Clone)]
struct BoardSearchScope {
    board_id: String,
    board_name: String,
    board_dir: std::path::PathBuf,
}

struct MatchedRelativeFile {
    relative_path: String,
    extension: String,
}

struct ResolvedBoardFileMetadata {
    exists: bool,
    filename: String,
    extension: String,
    size: u64,
    last_modified: u64,
    last_modified_ms: u64,
    media_category: &'static str,
    previewable: bool,
}

fn filename_string(path: &std::path::Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

fn external_board_path_exists(board_dir: &std::path::Path, path_str: &str) -> bool {
    let resolved = board_dir.join(path_str);
    resolved
        .canonicalize()
        .ok()
        .map(|p| p.exists())
        .unwrap_or(false)
        || resolved
            .with_extension("md")
            .canonicalize()
            .ok()
            .map(|_| true)
            .unwrap_or(false)
        || resolved.is_dir()
}

async fn inspect_resolved_board_file(file_path: &std::path::Path) -> ResolvedBoardFileMetadata {
    let extension = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let ext_ref = if extension.is_empty() {
        None
    } else {
        Some(extension.as_str())
    };
    let category = media_category(ext_ref);
    let previewable = is_previewable(ext_ref);
    let meta = tokio::fs::metadata(file_path).await.ok();
    let exists = meta.is_some();
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
    ResolvedBoardFileMetadata {
        exists,
        filename: filename_string(file_path),
        extension,
        size,
        last_modified,
        last_modified_ms,
        media_category: category,
        previewable,
    }
}

fn build_external_file_info_json(
    board_dir: &std::path::Path,
    path_str: &str,
    include_filename: bool,
) -> serde_json::Value {
    let exists = external_board_path_exists(board_dir, path_str);
    let mut payload = serde_json::Map::new();
    payload.insert("exists".to_string(), serde_json::json!(exists));
    payload.insert("external".to_string(), serde_json::json!(true));
    payload.insert("path".to_string(), serde_json::json!(path_str));
    if include_filename {
        payload.insert(
            "filename".to_string(),
            serde_json::json!(filename_string(std::path::Path::new(path_str))),
        );
    }
    serde_json::Value::Object(payload)
}

async fn build_batch_file_info_entry(
    state: AppState,
    board_id: String,
    board_dir: std::path::PathBuf,
    path_str: String,
) -> (String, serde_json::Value) {
    let resolved = resolve_board_file(&state, &board_id, &path_str);
    match resolved {
        Ok(fp) => {
            let metadata = inspect_resolved_board_file(&fp).await;
            (
                path_str.clone(),
                serde_json::json!({
                    "exists": metadata.exists,
                    "path": path_str,
                    "filename": metadata.filename,
                    "extension": metadata.extension,
                    "size": metadata.size,
                    "mediaCategory": metadata.media_category,
                }),
            )
        }
        Err(_) => (
            path_str.clone(),
            build_external_file_info_json(&board_dir, &path_str, false),
        ),
    }
}

fn collect_board_file_search_matches(
    board_dir: &std::path::Path,
    target: &str,
    category_filter: &Option<String>,
    max_results: usize,
) -> Vec<MatchedRelativeFile> {
    let mut results: Vec<MatchedRelativeFile> = Vec::new();

    fn walk_search(
        dir: &std::path::Path,
        base: &std::path::Path,
        target: &str,
        category_filter: &Option<String>,
        results: &mut Vec<MatchedRelativeFile>,
        depth: usize,
        max_results: usize,
    ) {
        if depth > FILE_SEARCH_MAX_DEPTH || results.len() >= max_results {
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
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if let Some(ref cat) = category_filter {
                    if media_category(Some(ext)) != cat.as_str() {
                        continue;
                    }
                }
                let rel = path
                    .strip_prefix(base)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| path.to_string_lossy().to_string());
                results.push(MatchedRelativeFile {
                    relative_path: rel,
                    extension: ext.to_string(),
                });
                if results.len() >= max_results {
                    return;
                }
            }
        }
    }

    walk_search(
        board_dir,
        board_dir,
        target,
        category_filter,
        &mut results,
        0,
        max_results,
    );
    results
}

fn build_file_search_result_json(
    board_id: &str,
    board_name: &str,
    matched: MatchedRelativeFile,
) -> serde_json::Value {
    let filename = filename_string(std::path::Path::new(&matched.relative_path));
    serde_json::json!({
        "boardId": board_id,
        "boardName": board_name,
        "path": matched.relative_path,
        "filename": filename,
        "category": media_category(Some(matched.extension.as_str())),
        "previewable": is_previewable(Some(matched.extension.as_str())),
    })
}

async fn search_board_file_results(
    board_index: usize,
    board_id: String,
    board_name: String,
    board_dir: std::path::PathBuf,
    target: String,
    category_filter: Option<String>,
    max_results: usize,
) -> (usize, Vec<serde_json::Value>) {
    let matches = tokio::task::spawn_blocking(move || {
        collect_board_file_search_matches(&board_dir, &target, &category_filter, max_results)
    })
    .await
    .unwrap_or_default();

    let mut results = Vec::with_capacity(matches.len());
    for matched in matches {
        results.push(build_file_search_result_json(
            &board_id,
            &board_name,
            matched,
        ));
    }

    (board_index, results)
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
            // resolve_board_file fails for paths outside the board dir (path
            // traversal) or truly missing files.  For file-info we still want
            // to report existence so the UI doesn't mark valid external links
            // as broken — do a direct existence check without serving content.
            let board_path = state.storage.get_board_path(&board_id);
            let board_dir = board_path
                .as_ref()
                .and_then(|p| p.parent())
                .unwrap_or_else(|| std::path::Path::new("."));
            return Json(build_external_file_info_json(board_dir, &params.path, true));
        }
    };
    let metadata = inspect_resolved_board_file(&fp).await;

    Json(serde_json::json!({
        "exists": metadata.exists,
        "path": params.path,
        "resolvedPath": fp.to_string_lossy().to_string(),
        "filename": metadata.filename,
        "extension": metadata.extension,
        "size": metadata.size,
        "lastModified": metadata.last_modified,
        "lastModifiedMs": metadata.last_modified_ms,
        "mediaCategory": metadata.media_category,
        "previewable": metadata.previewable,
    }))
}

/// POST /boards/{board_id}/file-info-batch -- check existence of multiple files in one request.
/// Body: { "paths": ["file1.png", "include.md", ...] }
/// Returns: { "results": { "file1.png": { "exists": true, ... }, "include.md": { "exists": false }, ... } }
pub async fn file_info_batch(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<FileInfoBatchBody>,
) -> Json<serde_json::Value> {
    let board_path = state.storage.get_board_path(&board_id);
    let board_dir = board_path
        .as_ref()
        .and_then(|p| p.parent())
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();

    let mut results = serde_json::Map::new();
    let mut join_set = tokio::task::JoinSet::new();
    for path_str in body.paths {
        join_set.spawn(build_batch_file_info_entry(
            state.clone(),
            board_id.clone(),
            board_dir.clone(),
            path_str,
        ));
        while join_set.len() >= FILE_INFO_BATCH_MAX_CONCURRENCY {
            if let Some(joined) = join_set.join_next().await {
                match joined {
                    Ok((path, value)) => {
                        results.insert(path, value);
                    }
                    Err(err) => {
                        log::warn!("file_info_batch task failed: {}", err);
                    }
                }
            }
        }
    }
    while let Some(joined) = join_set.join_next().await {
        match joined {
            Ok((path, value)) => {
                results.insert(path, value);
            }
            Err(err) => {
                log::warn!("file_info_batch task failed: {}", err);
            }
        }
    }
    Json(serde_json::json!({ "results": results }))
}

#[derive(serde::Deserialize)]
pub struct FileInfoBatchBody {
    #[serde(default)]
    pub paths: Vec<String>,
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
        let category_filter = None;
        collect_board_file_search_matches(
            &board_dir,
            &target,
            &category_filter,
            FILE_SEARCH_MAX_RESULTS,
        )
        .into_iter()
        .map(|matched| matched.relative_path)
        .collect::<Vec<String>>()
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
/// Results are cached for 5 seconds to avoid repeated directory walks during rapid board loads.
pub async fn search_files(
    State(state): State<AppState>,
    Json(body): Json<SearchFilesBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let query = body.query.trim().to_string();
    if query.is_empty() {
        return Err(err_bad_request("Search query must not be empty"));
    }

    // Check the time-based cache for a recent identical request.
    let cache_key: crate::state::FileSearchCacheKey = (
        query.clone(),
        body.workspace_id.clone(),
        body.category.clone(),
    );
    {
        let cache = state
            .file_search_cache
            .lock()
            .map_err(|_| err_internal("Failed to lock search cache"))?;
        if let Some(entry) = cache.get(&cache_key) {
            if entry.created_at.elapsed() < crate::state::FILE_SEARCH_CACHE_TTL {
                return Ok(Json(serde_json::json!({
                    "query": body.query,
                    "results": entry.results,
                })));
            }
        }
    }

    // Collect board IDs and their paths, filtered by workspace if specified.
    let board_dirs: Vec<BoardSearchScope> = {
        let cfg = state
            .config
            .lock()
            .map_err(|_| err_internal("Failed to lock config"))?;

        let boards_in_scope: Vec<&crate::config::BoardEntry> =
            if let Some(ref ws_id) = body.workspace_id {
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
                Some(BoardSearchScope {
                    board_id: lexera_core::storage::local::LocalStorage::board_id_from_path(
                        &file_path,
                    ),
                    board_name,
                    board_dir: board_dir.to_path_buf(),
                })
            })
            .collect()
    };

    let category_filter = body.category.clone();
    let target = query.to_lowercase();
    let max_total = 50usize;
    let mut results: Vec<serde_json::Value> = Vec::new();

    for (chunk_index, board_chunk) in board_dirs.chunks(FILE_SEARCH_BOARD_CONCURRENCY).enumerate() {
        if results.len() >= max_total {
            break;
        }
        let remaining = max_total - results.len();
        let mut join_set = tokio::task::JoinSet::new();

        for (offset, scope) in board_chunk.iter().cloned().enumerate() {
            let board_index = chunk_index * FILE_SEARCH_BOARD_CONCURRENCY + offset;
            join_set.spawn(search_board_file_results(
                board_index,
                scope.board_id,
                scope.board_name,
                scope.board_dir,
                target.clone(),
                category_filter.clone(),
                remaining,
            ));
        }

        let mut chunk_results: Vec<(usize, Vec<serde_json::Value>)> = Vec::new();
        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok(entry) => chunk_results.push(entry),
                Err(err) => log::warn!("search_files task failed: {}", err),
            }
        }
        chunk_results.sort_by_key(|(board_index, _)| *board_index);

        for (_, board_results) in chunk_results {
            for item in board_results {
                results.push(item);
                if results.len() >= max_total {
                    break;
                }
            }
            if results.len() >= max_total {
                break;
            }
        }
    }

    // Store results in the cache and evict stale entries.
    {
        if let Ok(mut cache) = state.file_search_cache.lock() {
            cache.retain(|_, entry| {
                entry.created_at.elapsed() < crate::state::FILE_SEARCH_CACHE_TTL
            });
            cache.insert(
                cache_key,
                crate::state::FileSearchCacheEntry {
                    results: results.clone(),
                    created_at: std::time::Instant::now(),
                },
            );
        }
    }

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
    use axum::http::StatusCode;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::config::BoardEntry;
    use crate::test_helpers::{
        authed_get, body_json, register_test_user, setup_board, test_router, test_state,
        MINIMAL_BOARD,
    };

    #[tokio::test]
    async fn serve_file_returns_content() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("hello.txt"), "hello world").unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get(
                &format!("/boards/{}/file?path=hello.txt", board_id),
                &token,
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&bytes[..], b"hello world");
    }

    #[tokio::test]
    async fn file_info_returns_metadata() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("data.txt"), "12345").unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get(
                &format!("/boards/{}/file-info?path=data.txt", board_id),
                &token,
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["exists"], true);
        assert_eq!(json["size"], 5);
        assert_eq!(json["filename"], "data.txt");
        assert!(json["resolvedPath"].as_str().unwrap().ends_with("data.txt"));
    }

    #[tokio::test]
    async fn file_info_batch_returns_metadata_for_multiple_paths() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("data.txt"), "12345").unwrap();
        std::fs::write(tmp.path().join("image.png"), "png").unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri(format!("/boards/{}/file-info-batch", board_id))
                    .header("authorization", format!("Bearer {}", token))
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(
                        serde_json::json!({
                            "paths": ["data.txt", "image.png", "missing.file"]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["results"]["data.txt"]["exists"], true);
        assert_eq!(json["results"]["data.txt"]["size"], 5);
        assert_eq!(json["results"]["data.txt"]["filename"], "data.txt");
        assert_eq!(json["results"]["image.png"]["exists"], true);
        assert_eq!(json["results"]["image.png"]["mediaCategory"], "image");
        assert_eq!(json["results"]["missing.file"]["exists"], false);
    }

    #[tokio::test]
    async fn search_files_returns_filtered_results_with_board_context() {
        let tmp = tempfile::tempdir().unwrap();
        let board_a_dir = tmp.path().join("board-a");
        let board_b_dir = tmp.path().join("board-b");
        std::fs::create_dir_all(board_a_dir.join("assets")).unwrap();
        std::fs::create_dir_all(board_b_dir.join("docs")).unwrap();
        let board_a_file = board_a_dir.join("board.md");
        let board_b_file = board_b_dir.join("board.md");
        std::fs::write(&board_a_file, MINIMAL_BOARD).unwrap();
        std::fs::write(&board_b_file, MINIMAL_BOARD).unwrap();
        std::fs::write(board_a_dir.join("assets").join("match-image.png"), "png").unwrap();
        std::fs::write(board_a_dir.join("assets").join("match-note.txt"), "note").unwrap();
        std::fs::write(board_b_dir.join("docs").join("match-image.png"), "png").unwrap();

        let state = test_state(tmp.path());
        {
            let mut cfg = state.config.lock().unwrap();
            cfg.boards = vec![
                BoardEntry {
                    file: board_a_file.to_string_lossy().to_string(),
                    name: Some("Board A".to_string()),
                    ..BoardEntry::default()
                },
                BoardEntry {
                    file: board_b_file.to_string_lossy().to_string(),
                    name: Some("Board B".to_string()),
                    ..BoardEntry::default()
                },
            ];
        }
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/search/files")
                    .header("authorization", format!("Bearer {}", token))
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(
                        serde_json::json!({
                            "query": "match",
                            "category": "image",
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let results = json["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["boardName"], "Board A");
        assert_eq!(results[0]["path"], "assets/match-image.png");
        assert_eq!(results[1]["boardName"], "Board B");
        assert_eq!(results[1]["path"], "docs/match-image.png");
        assert!(results.iter().all(|item| item["category"] == "image"));
    }

    #[tokio::test]
    async fn serve_file_blocks_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get(
                &format!("/boards/{}/file?path=../../../etc/passwd", board_id),
                &token,
            ))
            .await
            .unwrap();

        assert!(
            resp.status() == StatusCode::FORBIDDEN || resp.status() == StatusCode::NOT_FOUND,
            "Expected FORBIDDEN or NOT_FOUND for traversal, got {}",
            resp.status()
        );
    }

    #[tokio::test]
    async fn serve_file_blocks_absolute_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get(
                &format!("/boards/{}/file?path=/etc/passwd", board_id),
                &token,
            ))
            .await
            .unwrap();

        assert!(
            resp.status() == StatusCode::FORBIDDEN || resp.status() == StatusCode::NOT_FOUND,
            "Expected FORBIDDEN or NOT_FOUND for /etc/passwd, got {}",
            resp.status()
        );
    }
}
