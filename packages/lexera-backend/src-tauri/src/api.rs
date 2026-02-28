use axum::{
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{sse::Event, Json, Sse},
    routing::get,
    Router,
};
mod live_sync;
use lexera_core::media::{content_type_for_ext, dedup_filename, is_previewable, media_category};
use lexera_core::search::SearchOptions;
use lexera_core::storage::BoardStorage;
use lexera_core::types::is_archived_or_deleted;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
///   GET  /templates                           -> list available templates
///   GET  /templates/:id                       -> full template content + extra files
///   POST /templates/:id/copy                  -> copy template files with variable substitution
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
    pub error: String,
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
pub struct SyncSaveBoardBody {
    #[serde(rename = "baseBoard")]
    base_board: lexera_core::types::KanbanBoard,
    board: lexera_core::types::KanbanBoard,
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

#[derive(Deserialize)]
pub struct LiveSyncApplyBody {
    board: lexera_core::types::KanbanBoard,
}

#[derive(Deserialize)]
pub struct LiveSyncImportBody {
    updates: String,
}

#[derive(Serialize)]
struct TemplateSummary {
    id: String,
    name: String,
    #[serde(rename = "templateType")]
    template_type: String,
    description: String,
    icon: String,
    #[serde(rename = "hasVariables")]
    has_variables: bool,
}

#[derive(Deserialize)]
struct CopyTemplateBody {
    board_id: String,
    variables: HashMap<String, serde_json::Value>,
}

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/boards", get(list_boards).post(add_board_endpoint))
        .route("/remote-boards", get(list_remote_boards))
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
            "/boards/{board_id}/sync-save",
            axum::routing::post(write_board_with_base),
        )
        .route(
            "/boards/{board_id}/live-sync/open",
            axum::routing::post(open_live_sync_session),
        )
        .route(
            "/live-sync/{session_id}/apply",
            axum::routing::post(apply_live_sync_board),
        )
        .route(
            "/live-sync/{session_id}/import",
            axum::routing::post(import_live_sync_updates),
        )
        .route(
            "/live-sync/{session_id}",
            axum::routing::delete(close_live_sync_session),
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
        .route(
            "/open-connection-window",
            axum::routing::post(open_connection_window),
        )
        .route("/templates", get(list_templates))
        .route("/templates/{template_id}", get(get_template))
        .route(
            "/templates/{template_id}/copy",
            axum::routing::post(copy_template_files),
        )
}

async fn list_boards(State(state): State<AppState>) -> Json<serde_json::Value> {
    let boards = state.storage.list_boards();
    Json(serde_json::json!({ "boards": boards }))
}

async fn list_remote_boards(State(state): State<AppState>) -> Json<serde_json::Value> {
    let remote = state.storage.list_remote_boards();
    let boards: Vec<serde_json::Value> = remote
        .into_iter()
        .map(|(id, title, card_count)| {
            serde_json::json!({
                "id": id,
                "title": title,
                "card_count": card_count,
            })
        })
        .collect();
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
    let result = state
        .storage
        .write_board(&board_id, &board)
        .map_err(map_storage_error)?;
    broadcast_crdt_to_sync_hub(&state, &board_id).await;
    Ok(Json(build_write_board_response(
        &state, &board_id, result, &board,
    )))
}

/// POST /boards/{board_id}/sync-save — write a board relative to a client base snapshot.
async fn write_board_with_base(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<SyncSaveBoardBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let result = state
        .storage
        .write_board_from_base(&board_id, &body.base_board, &body.board)
        .map_err(map_storage_error)?;
    broadcast_crdt_to_sync_hub(&state, &board_id).await;
    Ok(Json(build_write_board_response(
        &state,
        &board_id,
        result,
        &body.board,
    )))
}

async fn open_live_sync_session(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    let board_dir = state
        .storage
        .get_board_path(&board_id)
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let snapshot = live_sync::open_session(&board_id, board, board_dir).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
    })?;

    Ok(Json(serde_json::json!({
        "sessionId": snapshot.session_id,
        "board": snapshot.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &snapshot.vv),
    })))
}

async fn apply_live_sync_board(
    Path(session_id): Path<String>,
    Json(body): Json<LiveSyncApplyBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let result = live_sync::apply_board(&session_id, body.board).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error }),
        )
    })?;

    Ok(Json(serde_json::json!({
        "board": result.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.vv),
        "changed": result.changed,
        "updates": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.updates),
    })))
}

async fn import_live_sync_updates(
    Path(session_id): Path<String>,
    Json(body): Json<LiveSyncImportBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        body.updates.as_bytes(),
    )
    .map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: error.to_string(),
            }),
        )
    })?;

    let result = live_sync::import_updates(&session_id, &bytes).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error }),
        )
    })?;

    Ok(Json(serde_json::json!({
        "board": result.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.vv),
        "changed": result.changed,
    })))
}

async fn close_live_sync_session(
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let closed = live_sync::close_session(&session_id).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error }),
        )
    })?;
    Ok(Json(serde_json::json!({ "closed": closed })))
}

fn map_storage_error(e: lexera_core::storage::StorageError) -> (StatusCode, Json<ErrorResponse>) {
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
}

fn build_write_board_response(
    state: &AppState,
    board_id: &str,
    result: Option<lexera_core::merge::merge::MergeResult>,
    fallback_board: &lexera_core::types::KanbanBoard,
) -> serde_json::Value {
    let saved_board = state
        .storage
        .read_board(board_id)
        .unwrap_or_else(|| fallback_board.clone());
    let version = state.storage.get_board_version(board_id).unwrap_or(0);
    if let Some(merge_result) = result {
        let has_conflicts = !merge_result.conflicts.is_empty();
        serde_json::json!({
            "success": true,
            "merged": true,
            "autoMerged": merge_result.auto_merged,
            "conflicts": merge_result.conflicts.len(),
            "hasConflicts": has_conflicts,
            "board": saved_board,
            "version": version,
        })
    } else {
        serde_json::json!({
            "success": true,
            "merged": false,
            "autoMerged": 0,
            "conflicts": 0,
            "hasConflicts": false,
            "board": saved_board,
            "version": version,
        })
    }
}

/// After a REST write, broadcast CRDT updates to sync-connected WebSocket clients.
/// Exports CRDT data BEFORE acquiring the hub lock to avoid lock ordering issues.
async fn broadcast_crdt_to_sync_hub(state: &AppState, board_id: &str) {
    // Quick check (racy but fine — worst case we export then find no clients)
    {
        let hub = state.sync_hub.lock().await;
        if !hub.has_clients(board_id) {
            return;
        }
    }
    // Export outside the hub lock to prevent lock ordering inversion
    let updates = match state.storage.export_crdt_updates_since(board_id, &[]) {
        Some(u) => u,
        None => return,
    };
    let msg = serde_json::json!({
        "type": "ServerUpdate",
        "updates": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &updates),
    });
    let msg_str = msg.to_string();
    let hub = state.sync_hub.lock().await;
    hub.broadcast(board_id, 0, &msg_str);
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
    let actual_port = state.live_port.lock().map(|p| *p).unwrap_or(state.port);
    Json(serde_json::json!({
        "status": "running",
        "port": actual_port,
        "bind_address": state.bind_address,
        "incoming": state.incoming,
    }))
}

async fn open_connection_window(State(state): State<AppState>) -> Json<serde_json::Value> {
    crate::connection_window::open_connection_window(&state.app_handle);
    Json(serde_json::json!({ "success": true }))
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

// ── Template endpoints ──────────────────────────────────────────────────

/// Resolve templates dir from the current config.
fn get_templates_dir(state: &AppState) -> PathBuf {
    let templates_path = state
        .config
        .lock()
        .ok()
        .and_then(|cfg| cfg.templates_path.clone());
    crate::config::resolve_templates_path(&templates_path)
}

/// Parse simple YAML frontmatter from template.md content (line-by-line, no YAML crate).
fn parse_template_frontmatter(content: &str) -> (String, String, String, String, bool) {
    let mut name = String::new();
    let mut template_type = String::from("card");
    let mut description = String::new();
    let mut icon = String::new();
    let mut has_variables = false;

    // Extract frontmatter between --- delimiters
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (name, template_type, description, icon, has_variables);
    }
    let after_first = &trimmed[3..];
    let end = after_first.find("\n---");
    let yaml = match end {
        Some(pos) => &after_first[..pos],
        None => return (name, template_type, description, icon, has_variables),
    };

    for line in yaml.lines() {
        let line = line.trim();
        if line.starts_with("name:") {
            name = unquote_yaml(line[5..].trim());
        } else if line.starts_with("type:") {
            template_type = unquote_yaml(line[5..].trim());
        } else if line.starts_with("description:") {
            description = unquote_yaml(line[12..].trim());
        } else if line.starts_with("icon:") {
            icon = unquote_yaml(line[5..].trim());
        } else if line.starts_with("variables:") {
            has_variables = true;
        }
    }

    (name, template_type, description, icon, has_variables)
}

fn unquote_yaml(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// GET /templates — list all available templates.
async fn list_templates(State(state): State<AppState>) -> Json<serde_json::Value> {
    let templates_dir = get_templates_dir(&state);
    let mut templates: Vec<TemplateSummary> = Vec::new();

    let entries = match std::fs::read_dir(&templates_dir) {
        Ok(e) => e,
        Err(_) => return Json(serde_json::json!(templates)),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let template_md = path.join("template.md");
        if !template_md.exists() {
            continue;
        }
        let content = match std::fs::read_to_string(&template_md) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let (parsed_name, template_type, description, icon, has_variables) =
            parse_template_frontmatter(&content);

        templates.push(TemplateSummary {
            name: if parsed_name.is_empty() {
                id.clone()
            } else {
                parsed_name
            },
            id,
            template_type,
            description,
            icon,
            has_variables,
        });
    }

    Json(serde_json::json!(templates))
}

/// GET /templates/{template_id} — return full template content + list of extra files.
async fn get_template(
    State(state): State<AppState>,
    Path(template_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Prevent path traversal
    if template_id.contains("..") || template_id.contains('/') || template_id.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid template ID".to_string(),
            }),
        ));
    }

    let templates_dir = get_templates_dir(&state);
    let template_dir = templates_dir.join(&template_id);
    let template_md = template_dir.join("template.md");

    let content = std::fs::read_to_string(&template_md).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Template not found".to_string(),
            }),
        )
    })?;

    // List extra files (everything except template.md)
    let mut files: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&template_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name != "template.md" {
                files.push(name);
            }
        }
    }

    Ok(Json(serde_json::json!({
        "content": content,
        "files": files,
    })))
}

/// Text file extensions for variable substitution during template file copy.
const TEXT_EXTENSIONS: &[&str] = &[
    "md", "txt", "json", "yaml", "yml", "toml", "html", "htm", "css", "js", "ts", "xml", "svg",
    "sh", "py", "rb", "rs", "go", "java", "c", "h", "cpp", "hpp",
];

fn is_text_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| TEXT_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Apply {varname} substitution to a string.
fn substitute_variables(content: &str, variables: &HashMap<String, serde_json::Value>) -> String {
    let mut result = content.to_string();
    for (key, value) in variables {
        let placeholder = format!("{{{}}}", key);
        let replacement = match value {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            _ => value.to_string(),
        };
        result = result.replace(&placeholder, &replacement);
    }
    result
}

/// Sanitize a filename by replacing filesystem-invalid characters.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect()
}

/// POST /templates/{template_id}/copy — copy template files to board folder with variable substitution.
async fn copy_template_files(
    State(state): State<AppState>,
    Path(template_id): Path<String>,
    Json(body): Json<CopyTemplateBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Prevent path traversal
    if template_id.contains("..") || template_id.contains('/') || template_id.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid template ID".to_string(),
            }),
        ));
    }

    let templates_dir = get_templates_dir(&state);
    let template_dir = templates_dir.join(&template_id);
    if !template_dir.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Template not found".to_string(),
            }),
        ));
    }

    // Resolve board directory
    let board_path = state
        .storage
        .get_board_path(&body.board_id)
        .ok_or_else(|| {
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

    // Copy all files except template.md
    let mut copied: Vec<String> = Vec::new();
    let entries = std::fs::read_dir(&template_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to read template dir: {}", e),
            }),
        )
    })?;

    for entry in entries.flatten() {
        let src_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == "template.md" || src_path.is_dir() {
            continue;
        }

        // Apply variable substitution to filename
        let dest_name = sanitize_filename(&substitute_variables(&file_name, &body.variables));
        let dest_path = board_dir.join(&dest_name);

        // For text files, substitute variables in content; for binary, just copy
        if is_text_file(&src_path) {
            match std::fs::read_to_string(&src_path) {
                Ok(content) => {
                    let substituted = substitute_variables(&content, &body.variables);
                    if let Err(e) = std::fs::write(&dest_path, &substituted) {
                        log::warn!(
                            "[templates.copy] Failed to write {}: {}",
                            dest_path.display(),
                            e
                        );
                        continue;
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[templates.copy] Failed to read text file {}: {}",
                        src_path.display(),
                        e
                    );
                    continue;
                }
            }
        } else if let Err(e) = std::fs::copy(&src_path, &dest_path) {
            log::warn!(
                "[templates.copy] Failed to copy {}: {}",
                src_path.display(),
                e
            );
            continue;
        }

        copied.push(dest_name);
    }

    Ok(Json(serde_json::json!({
        "copied": copied,
    })))
}
