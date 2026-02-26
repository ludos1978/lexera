use axum::{
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{sse::Event, Json, Sse},
    routing::get,
    Router,
};
use lexera_core::search::SearchOptions;
use lexera_core::storage::BoardStorage;
use lexera_core::types::is_archived_or_deleted;
use serde::{Deserialize, Serialize};
/// Axum REST API routes.
///
///   GET  /boards                              -> list all boards
///   POST /boards                              -> add board by file path
///   DELETE /boards/:boardId                   -> remove board from tracking
///   GET  /boards/:boardId/columns             -> full column data with cards (+ ETag)
///   POST /boards/:boardId/columns/:colIndex/cards -> add card
///   POST /boards/:boardId/media               -> upload media file
///   GET  /boards/:boardId/media/:filename     -> serve media file
///   GET  /boards/:boardId/file?path=...       -> serve any file relative to board dir
///   GET  /boards/:boardId/file-info?path=...  -> file metadata (size, type, etc.)
///   POST /boards/:boardId/find-file            -> search for files by name in board dir
///   POST /boards/:boardId/convert-path        -> convert relative↔absolute path in card
///   GET  /search?q=term                       -> search cards
///   GET  /events                              -> SSE stream of board changes
///   GET  /status                              -> health check (+ incoming config)
use std::convert::Infallible;
use std::path::PathBuf;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::state::AppState;

fn insert_header_safe(headers: &mut HeaderMap, name: &'static str, value: &str) {
    match value.parse() {
        Ok(parsed) => {
            headers.insert(name, parsed);
        }
        Err(e) => {
            log::warn!("Failed to set header {}={} ({})", name, value, e);
        }
    }
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: Option<String>,
    #[serde(default, alias = "caseSensitive")]
    case_sensitive: Option<bool>,
    #[serde(default, alias = "useRegex")]
    regex: Option<bool>,
}

#[derive(Deserialize)]
pub struct FileQuery {
    path: String,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    error: String,
}

#[derive(Deserialize)]
pub struct AddCardBody {
    content: String,
}

#[derive(Deserialize)]
pub struct AddBoardBody {
    file: String,
}

#[derive(Deserialize)]
pub struct FindFileBody {
    filename: String,
}

#[derive(Deserialize)]
pub struct ConvertPathBody {
    #[serde(rename = "cardId")]
    #[allow(dead_code)]
    card_id: String,
    path: String,
    to: String, // "relative" or "absolute"
}

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/boards", get(list_boards).post(add_board_endpoint))
        .route("/boards/{board_id}/columns", get(get_board_columns))
        .route(
            "/boards/{board_id}/columns/{col_index}/cards",
            axum::routing::post(add_card),
        )
        .route(
            "/boards/{board_id}",
            axum::routing::put(write_board).delete(remove_board_endpoint),
        )
        .route(
            "/boards/{board_id}/media",
            axum::routing::post(upload_media),
        )
        .route("/boards/{board_id}/media/{filename}", get(serve_media))
        .route("/boards/{board_id}/file", get(serve_file))
        .route("/boards/{board_id}/file-info", get(file_info))
        .route(
            "/boards/{board_id}/find-file",
            axum::routing::post(find_file),
        )
        .route(
            "/boards/{board_id}/convert-path",
            axum::routing::post(convert_path),
        )
        .route("/search", get(search))
        .route("/events", get(sse_events))
        .route("/status", get(status))
}

async fn list_boards(State(state): State<AppState>) -> Json<serde_json::Value> {
    let boards = state.storage.list_boards();
    Json(serde_json::json!({ "boards": boards }))
}

async fn get_board_columns(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    headers: HeaderMap,
) -> Result<(StatusCode, HeaderMap, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    let version = state.storage.get_board_version(&board_id).unwrap_or(0);
    let etag = format!("\"{}\"", version);

    // Check If-None-Match for conditional response
    if let Some(if_none_match) = headers.get("if-none-match") {
        if let Ok(value) = if_none_match.to_str() {
            if value == etag {
                let mut resp_headers = HeaderMap::new();
                insert_header_safe(&mut resp_headers, "etag", &etag);
                return Ok((
                    StatusCode::NOT_MODIFIED,
                    resp_headers,
                    Json(serde_json::json!({})),
                ));
            }
        }
    }

    let columns: Vec<serde_json::Value> = board
        .all_columns()
        .iter()
        .enumerate()
        .filter(|(_, col)| !is_archived_or_deleted(&col.title))
        .map(|(index, col)| {
            let cards: Vec<serde_json::Value> = col
                .cards
                .iter()
                .filter(|c| !is_archived_or_deleted(&c.content))
                .map(|c| {
                    serde_json::json!({
                        "id": c.id,
                        "content": c.content,
                        "checked": c.checked,
                    })
                })
                .collect();
            serde_json::json!({
                "index": index,
                "title": col.title,
                "cards": cards,
            })
        })
        .collect();

    let mut resp_headers = HeaderMap::new();
    insert_header_safe(&mut resp_headers, "etag", &etag);

    Ok((
        StatusCode::OK,
        resp_headers,
        Json(serde_json::json!({
            "boardId": board_id,
            "title": board.title,
            "columns": columns,
            "version": version,
            "fullBoard": board,
        })),
    ))
}

async fn add_card(
    State(state): State<AppState>,
    Path((board_id, col_index)): Path<(String, usize)>,
    Json(body): Json<AddCardBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    if body.content.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Missing or empty content".to_string(),
            }),
        ));
    }

    state
        .storage
        .add_card(&board_id, col_index, &body.content)
        .map_err(|e| {
            let status = match &e {
                lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
                lexera_core::storage::StorageError::ColumnOutOfRange { .. } => {
                    StatusCode::BAD_REQUEST
                }
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (
                status,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "success": true })),
    ))
}

/// PUT /boards/{board_id} — write a full board, with card-level merge on conflict.
async fn write_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(board): Json<lexera_core::types::KanbanBoard>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    match state.storage.write_board(&board_id, &board) {
        Ok(None) => {
            broadcast_crdt_to_sync_hub(&state, &board_id).await;
            Ok(Json(
                serde_json::json!({ "success": true, "merged": false }),
            ))
        }
        Ok(Some(merge_result)) => {
            broadcast_crdt_to_sync_hub(&state, &board_id).await;
            let has_conflicts = !merge_result.conflicts.is_empty();
            Ok(Json(serde_json::json!({
                "success": true,
                "merged": true,
                "autoMerged": merge_result.auto_merged,
                "conflicts": merge_result.conflicts.len(),
                "hasConflicts": has_conflicts,
            })))
        }
        Err(e) => {
            let status = match &e {
                lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            Err((
                status,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            ))
        }
    }
}

/// After a REST write, broadcast CRDT updates to sync-connected WebSocket clients.
async fn broadcast_crdt_to_sync_hub(state: &AppState, board_id: &str) {
    let hub = state.sync_hub.lock().await;
    if !hub.has_clients(board_id) {
        return;
    }
    // Export full updates (from empty VV) so all connected peers get the latest state
    if let Some(updates) = state.storage.export_crdt_updates_since(board_id, &[]) {
        let msg = serde_json::json!({
            "type": "ServerUpdate",
            "updates": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &updates),
        });
        hub.broadcast(board_id, 0, &msg.to_string());
    }
}

/// POST /boards — add a new board by file path.
async fn add_board_endpoint(
    State(state): State<AppState>,
    Json(body): Json<AddBoardBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    let path = PathBuf::from(&body.file);
    if !path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("File not found: {}", body.file),
            }),
        ));
    }
    if path.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Only .md files are supported".to_string(),
            }),
        ));
    }

    let board_id = state.storage.add_board(&path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    // Watch the new board file
    let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    if let Ok(mut watcher_guard) = state.watcher.lock() {
        if let Some(ref mut watcher) = *watcher_guard {
            if let Err(e) = watcher.watch_board(&board_id, &canonical) {
                log::warn!(
                    "[lexera.api.add_board] Failed to watch board {}: {}",
                    board_id,
                    e
                );
            }
        }
    }

    // Update config and persist
    if let Ok(mut cfg) = state.config.lock() {
        let file_str = path.to_string_lossy().to_string();
        if !cfg.boards.iter().any(|b| b.file == file_str) {
            cfg.boards.push(crate::config::BoardEntry {
                file: file_str,
                name: None,
            });
            if let Err(e) = crate::config::save_config(&state.config_path, &cfg) {
                log::warn!("[lexera.api.add_board] Failed to save config: {}", e);
            }
        }
    }

    // Broadcast board list change via SSE
    let _ = state.event_tx.send(
        lexera_core::watcher::types::BoardChangeEvent::MainFileChanged {
            board_id: board_id.clone(),
        },
    );

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "boardId": board_id })),
    ))
}

/// DELETE /boards/{board_id} — remove a board from tracking (does not delete file).
async fn remove_board_endpoint(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Get file path before removing
    let file_path = state.storage.get_board_path(&board_id);

    state.storage.remove_board(&board_id).map_err(|e| {
        let status = match &e {
            lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    // Unwatch the board file
    if let Some(ref path) = file_path {
        if let Ok(mut watcher_guard) = state.watcher.lock() {
            if let Some(ref mut watcher) = *watcher_guard {
                if let Err(e) = watcher.unwatch(path) {
                    log::warn!(
                        "[lexera.api.remove_board] Failed to unwatch board {}: {}",
                        board_id,
                        e
                    );
                }
            }
        }
    }

    // Update config and persist
    if let Some(ref path) = file_path {
        let path_str = path.to_string_lossy().to_string();
        if let Ok(mut cfg) = state.config.lock() {
            cfg.boards.retain(|b| {
                let entry_canonical =
                    std::fs::canonicalize(&b.file).unwrap_or_else(|_| PathBuf::from(&b.file));
                entry_canonical != *path && b.file != path_str
            });
            if let Err(e) = crate::config::save_config(&state.config_path, &cfg) {
                log::warn!("[lexera.api.remove_board] Failed to save config: {}", e);
            }
        }
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

async fn search(
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

/// SSE endpoint: streams BoardChangeEvent as JSON to connected clients.
async fn sse_events(
    State(state): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = state.event_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| match result {
        Ok(event) => {
            let json = serde_json::to_string(&event).unwrap_or_default();
            Some(Ok(Event::default().data(json)))
        }
        Err(_) => None,
    });

    // Keep-alive every 30 seconds
    let stream = stream.merge(tokio_stream::StreamExt::map(
        tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
            std::time::Duration::from_secs(30),
        )),
        |_| Ok(Event::default().comment("keep-alive")),
    ));

    Sse::new(stream)
}

async fn status(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "running",
        "port": state.port,
        "incoming": state.incoming,
    }))
}

/// POST /boards/{board_id}/media — upload a file to the board's media folder.
/// The media folder is `{board_basename}-Media/` next to the board .md file.
/// Returns the relative path suitable for markdown embedding.
async fn upload_media(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    // Get board file path
    let board_path = state.storage.get_board_path(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    // Compute media folder: {basename}-Media/ next to the board file
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let board_stem = board_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("board");
    let media_dir = board_dir.join(format!("{}-Media", board_stem));

    // Process the first file field from multipart
    let field = multipart.next_field().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("Failed to read multipart: {}", e),
            }),
        )
    })?;

    let field = field.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "No file provided".to_string(),
            }),
        )
    })?;

    let filename = field.file_name().unwrap_or("capture").to_string();
    let data = field.bytes().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("Failed to read file data: {}", e),
            }),
        )
    })?;

    if data.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Empty file".to_string(),
            }),
        ));
    }

    // Create media directory if needed
    std::fs::create_dir_all(&media_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to create media dir: {}", e),
            }),
        )
    })?;

    // Deduplicate filename if it already exists
    let final_path = dedup_filename(&media_dir, &filename);
    let final_name = final_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&filename)
        .to_string();

    // Write file
    std::fs::write(&final_path, &data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to write file: {}", e),
            }),
        )
    })?;

    // Return relative path from board directory
    let media_folder_name = format!("{}-Media", board_stem);
    let relative_path = format!("{}/{}", media_folder_name, final_name);

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "path": relative_path,
            "filename": final_name,
        })),
    ))
}

/// GET /boards/{board_id}/media/{filename} — serve a media file from the board's media folder.
async fn serve_media(
    State(state): State<AppState>,
    Path((board_id, filename)): Path<(String, String)>,
) -> Result<(HeaderMap, Vec<u8>), (StatusCode, Json<ErrorResponse>)> {
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
    let board_stem = board_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("board");
    let media_dir = board_dir.join(format!("{}-Media", board_stem));
    let file_path = media_dir.join(&filename);

    // Prevent path traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid filename".to_string(),
            }),
        ));
    }

    let data = std::fs::read(&file_path).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "File not found".to_string(),
            }),
        )
    })?;

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    let content_type = content_type_for_ext(ext.as_deref());

    let mut headers = HeaderMap::new();
    insert_header_safe(&mut headers, "content-type", content_type);
    insert_header_safe(&mut headers, "cache-control", "public, max-age=3600");

    Ok((headers, data))
}

/// Resolve a file path relative to the board's directory, or as absolute if starts with /.
fn resolve_board_file(
    state: &AppState,
    board_id: &str,
    file_path: &str,
) -> Result<PathBuf, (StatusCode, Json<ErrorResponse>)> {
    let path = std::path::Path::new(file_path);
    if path.is_absolute() {
        let canonical = path.canonicalize().map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "File not found".to_string(),
                }),
            )
        })?;
        return Ok(canonical);
    }
    let board_path = state.storage.get_board_path(board_id).ok_or_else(|| {
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
    let resolved = board_dir.join(file_path);
    resolved.canonicalize().map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "File not found".to_string(),
            }),
        )
    })
}

fn content_type_for_ext(ext: Option<&str>) -> &'static str {
    match ext {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        Some("csv") => "text/csv",
        Some("txt") | Some("md") | Some("log") => "text/plain",
        _ => "application/octet-stream",
    }
}

fn media_category(ext: Option<&str>) -> &'static str {
    match ext {
        Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("svg")
        | Some("bmp") | Some("ico") | Some("tiff") | Some("tif") => "image",
        Some("mp4") | Some("webm") | Some("mov") | Some("avi") | Some("mkv") => "video",
        Some("mp3") | Some("wav") | Some("ogg") | Some("flac") | Some("aac") | Some("m4a") => {
            "audio"
        }
        Some("pdf") | Some("doc") | Some("docx") | Some("xls") | Some("xlsx") | Some("ppt")
        | Some("pptx") | Some("txt") | Some("md") | Some("csv") | Some("json") => "document",
        _ => "unknown",
    }
}

fn is_previewable(ext: Option<&str>) -> bool {
    matches!(
        ext,
        Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("webp")
            | Some("svg")
            | Some("bmp")
            | Some("mp4")
            | Some("webm")
            | Some("mov")
            | Some("mp3")
            | Some("wav")
            | Some("ogg")
            | Some("pdf")
    )
}

/// GET /boards/{board_id}/file?path=... — serve any file relative to the board directory.
async fn serve_file(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(params): Query<FileQuery>,
) -> Result<(HeaderMap, Vec<u8>), (StatusCode, Json<ErrorResponse>)> {
    let file_path = resolve_board_file(&state, &board_id, &params.path)?;
    let data = std::fs::read(&file_path).map_err(|_| {
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
    insert_header_safe(&mut headers, "cache-control", "public, max-age=3600");
    if let Ok(meta) = std::fs::metadata(&file_path) {
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

/// GET /boards/{board_id}/file-info?path=... — return metadata about a file.
async fn file_info(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(params): Query<FileQuery>,
) -> Json<serde_json::Value> {
    let path = std::path::Path::new(&params.path);
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        let board_path = state.storage.get_board_path(&board_id);
        let board_dir = board_path
            .as_ref()
            .and_then(|p| p.parent())
            .unwrap_or_else(|| std::path::Path::new("."));
        board_dir.join(&params.path)
    };
    let canonical = resolved.canonicalize();

    let (exists, file_path) = match canonical {
        Ok(p) => (true, Some(p)),
        Err(_) => (false, None),
    };

    if !exists {
        return Json(serde_json::json!({
            "exists": false,
            "path": params.path,
            "filename": std::path::Path::new(&params.path).file_name().and_then(|s| s.to_str()).unwrap_or(""),
        }));
    }

    let Some(fp) = file_path else {
        return Json(serde_json::json!({
            "exists": false,
            "path": params.path,
            "filename": std::path::Path::new(&params.path).file_name().and_then(|s| s.to_str()).unwrap_or(""),
        }));
    };
    let ext = fp
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    let ext_ref = ext.as_deref();
    let meta = std::fs::metadata(&fp).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let last_modified = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Json(serde_json::json!({
        "exists": true,
        "path": params.path,
        "filename": fp.file_name().and_then(|s| s.to_str()).unwrap_or(""),
        "extension": ext.as_deref().unwrap_or(""),
        "size": size,
        "lastModified": last_modified,
        "mediaCategory": media_category(ext_ref),
        "previewable": is_previewable(ext_ref),
    }))
}

/// POST /boards/{board_id}/find-file — search for files matching a filename in the board dir tree.
async fn find_file(
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
        .unwrap_or_else(|| std::path::Path::new("."));
    let target = body.filename.to_lowercase();
    let mut matches = Vec::new();

    fn walk(dir: &std::path::Path, target: &str, matches: &mut Vec<String>, depth: usize) {
        if depth > 5 {
            return;
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, target, matches, depth + 1);
            } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.to_lowercase().contains(target) {
                    matches.push(path.to_string_lossy().to_string());
                    if matches.len() >= 20 {
                        return;
                    }
                }
            }
        }
    }

    walk(board_dir, &target, &mut matches, 0);

    Ok(Json(serde_json::json!({
        "query": body.filename,
        "matches": matches,
    })))
}

/// POST /boards/{board_id}/convert-path — convert a path between relative and absolute in a card.
async fn convert_path(
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
        let abs = board_dir.join(&body.path).canonicalize().map_err(|_| {
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
        let canonical_board_dir = board_dir
            .canonicalize()
            .unwrap_or_else(|_| board_dir.to_path_buf());
        let canonical_file = p.canonicalize().map_err(|_| {
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

/// Generate a unique filename by appending a counter if the file already exists.
fn dedup_filename(dir: &PathBuf, filename: &str) -> PathBuf {
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }

    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|s| s.to_str());

    for i in 1..1000 {
        let new_name = match ext {
            Some(e) => format!("{}-{}.{}", stem, i, e),
            None => format!("{}-{}", stem, i),
        };
        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return new_path;
        }
    }

    // Fallback: timestamp-based
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let new_name = match ext {
        Some(e) => format!("{}-{}.{}", stem, ts, e),
        None => format!("{}-{}", stem, ts),
    };
    dir.join(&new_name)
}
