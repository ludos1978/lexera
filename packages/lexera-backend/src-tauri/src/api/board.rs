use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use lexera_core::storage::BoardStorage;
use lexera_core::types::is_archived_or_deleted;
use serde::Deserialize;
use std::path::PathBuf;

use super::live_sync;
use super::{insert_header_safe, log_api_issue, ErrorResponse};
use crate::state::AppState;

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
pub struct LiveSyncApplyBody {
    board: lexera_core::types::KanbanBoard,
}

#[derive(Deserialize)]
pub struct LiveSyncImportBody {
    updates: String,
}

pub async fn list_boards(State(state): State<AppState>) -> Json<serde_json::Value> {
    let boards = state.storage.list_boards();
    Json(serde_json::json!({ "boards": boards }))
}

pub async fn list_remote_boards(State(state): State<AppState>) -> Json<serde_json::Value> {
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

pub async fn get_board_columns(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    headers: HeaderMap,
) -> Result<(StatusCode, HeaderMap, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        let status = StatusCode::NOT_FOUND;
        let error = format!("Board not found: {}", board_id);
        log_api_issue(status, "lexera.api.get_board", &error);
        (status, Json(ErrorResponse { error }))
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

pub async fn add_card(
    State(state): State<AppState>,
    Path((board_id, col_index)): Path<(String, usize)>,
    Json(body): Json<AddCardBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    if body.content.trim().is_empty() {
        let status = StatusCode::BAD_REQUEST;
        let error = format!(
            "Missing or empty content for add_card on board {} column {}",
            board_id, col_index
        );
        log_api_issue(status, "lexera.api.add_card", &error);
        return Err((
            status,
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
            log_api_issue(
                status,
                "lexera.api.add_card",
                format!(
                    "Failed to add card to board {} column {}: {}",
                    board_id, col_index, e
                ),
            );
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

/// PUT /boards/{board_id} -- write a full board, with card-level merge on conflict.
pub async fn write_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(board): Json<lexera_core::types::KanbanBoard>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let result = state
        .storage
        .write_board(&board_id, &board)
        .map_err(|e| {
            let status = match &e {
                lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            log_api_issue(
                status,
                "lexera.api.write_board",
                format!("Failed to write board {}: {}", board_id, e),
            );
            (
                status,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    broadcast_crdt_to_sync_hub(&state, &board_id).await;
    Ok(Json(build_write_board_response(
        &state, &board_id, result, &board,
    )))
}

/// POST /boards/{board_id}/sync-save -- write a board relative to a client base snapshot.
pub async fn write_board_with_base(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<SyncSaveBoardBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let result = state
        .storage
        .write_board_from_base(&board_id, &body.base_board, &body.board)
        .map_err(|e| {
            let status = match &e {
                lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            log_api_issue(
                status,
                "lexera.api.write_board_with_base",
                format!("Failed to write board {} from base snapshot: {}", board_id, e),
            );
            (
                status,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    broadcast_crdt_to_sync_hub(&state, &board_id).await;
    Ok(Json(build_write_board_response(
        &state,
        &board_id,
        result,
        &body.board,
    )))
}

pub async fn open_live_sync_session(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        let status = StatusCode::NOT_FOUND;
        let error = format!("Board not found for live sync open: {}", board_id);
        log_api_issue(status, "lexera.api.live_sync.open", &error);
        (status, Json(ErrorResponse { error }))
    })?;

    let board_dir = state
        .storage
        .get_board_path(&board_id)
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let snapshot = state.storage.export_crdt_snapshot(&board_id);

    let snapshot = live_sync::open_session(&board_id, board, board_dir, snapshot).map_err(|error| {
        let status = StatusCode::INTERNAL_SERVER_ERROR;
        log_api_issue(
            status,
            "lexera.api.live_sync.open",
            format!("Failed to open live sync session for board {}: {}", board_id, error),
        );
        (status, Json(ErrorResponse { error }))
    })?;

    Ok(Json(serde_json::json!({
        "sessionId": snapshot.session_id,
        "board": snapshot.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &snapshot.vv),
    })))
}

pub async fn apply_live_sync_board(
    Path(session_id): Path<String>,
    Json(body): Json<LiveSyncApplyBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let result = live_sync::apply_board(&session_id, body.board).map_err(|error| {
        let status = StatusCode::BAD_REQUEST;
        log_api_issue(
            status,
            "lexera.api.live_sync.apply",
            format!("Failed to apply live sync board for session {}: {}", session_id, error),
        );
        (status, Json(ErrorResponse { error }))
    })?;

    Ok(Json(serde_json::json!({
        "board": result.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.vv),
        "changed": result.changed,
        "updates": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.updates),
    })))
}

pub async fn import_live_sync_updates(
    Path(session_id): Path<String>,
    Json(body): Json<LiveSyncImportBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        body.updates.as_bytes(),
    )
    .map_err(|error| {
        let status = StatusCode::BAD_REQUEST;
        let message = format!(
            "Failed to decode live sync update payload for session {}: {}",
            session_id, error
        );
        log_api_issue(status, "lexera.api.live_sync.import", &message);
        (
            status,
            Json(ErrorResponse {
                error: error.to_string(),
            }),
        )
    })?;

    let result = live_sync::import_updates(&session_id, &bytes).map_err(|error| {
        let status = StatusCode::BAD_REQUEST;
        log_api_issue(
            status,
            "lexera.api.live_sync.import",
            format!(
                "Failed to import live sync update for session {} ({} bytes): {}",
                session_id,
                bytes.len(),
                error
            ),
        );
        (status, Json(ErrorResponse { error }))
    })?;

    Ok(Json(serde_json::json!({
        "board": result.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.vv),
        "changed": result.changed,
    })))
}

pub async fn close_live_sync_session(
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let closed = live_sync::close_session(&session_id).map_err(|error| {
        let status = StatusCode::INTERNAL_SERVER_ERROR;
        log_api_issue(
            status,
            "lexera.api.live_sync.close",
            format!("Failed to close session {}: {}", session_id, error),
        );
        (status, Json(ErrorResponse { error }))
    })?;
    Ok(Json(serde_json::json!({ "closed": closed })))
}

/// POST /boards -- add a new board by file path.
pub async fn add_board_endpoint(
    State(state): State<AppState>,
    Json(body): Json<AddBoardBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    let path = PathBuf::from(&body.file);
    if !path.exists() {
        let status = StatusCode::NOT_FOUND;
        let error = format!("File not found: {}", body.file);
        log_api_issue(status, "lexera.api.add_board", &error);
        return Err((status, Json(ErrorResponse { error })));
    }
    if path.extension().and_then(|e| e.to_str()) != Some("md") {
        let status = StatusCode::BAD_REQUEST;
        let error = "Only .md files are supported".to_string();
        log_api_issue(
            status,
            "lexera.api.add_board",
            format!("Rejected board add for {}: {}", body.file, error),
        );
        return Err((status, Json(ErrorResponse { error })));
    }

    let board_id = state.storage.add_board(&path).map_err(|e| {
        let status = StatusCode::INTERNAL_SERVER_ERROR;
        log_api_issue(
            status,
            "lexera.api.add_board",
            format!("Failed to add board {}: {}", body.file, e),
        );
        (
            status,
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

/// DELETE /boards/{board_id} -- remove a board from tracking (does not delete file).
pub async fn remove_board_endpoint(
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

/// GET /boards/{board_id}/settings -- read board settings without loading full board data.
pub async fn get_board_settings(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Board not found: {}", board_id),
            }),
        )
    })?;

    let settings = board
        .board_settings
        .unwrap_or_default();

    Ok(Json(serde_json::json!({
        "boardId": board_id,
        "boardSettings": settings,
    })))
}

/// PUT /boards/{board_id}/settings -- update board settings only (merges with existing).
pub async fn update_board_settings(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(incoming): Json<lexera_core::types::BoardSettings>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let mut board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Board not found: {}", board_id),
            }),
        )
    })?;

    // Merge incoming settings into existing (only overwrite non-None fields)
    let mut current = board.board_settings.unwrap_or_default();
    if incoming.column_width.is_some() { current.column_width = incoming.column_width; }
    if incoming.layout_rows.is_some() { current.layout_rows = incoming.layout_rows; }
    if incoming.max_row_height.is_some() { current.max_row_height = incoming.max_row_height; }
    if incoming.row_height.is_some() { current.row_height = incoming.row_height; }
    if incoming.layout_preset.is_some() { current.layout_preset = incoming.layout_preset; }
    if incoming.sticky_stack_mode.is_some() { current.sticky_stack_mode = incoming.sticky_stack_mode; }
    if incoming.tag_visibility.is_some() { current.tag_visibility = incoming.tag_visibility; }
    if incoming.card_min_height.is_some() { current.card_min_height = incoming.card_min_height; }
    if incoming.font_size.is_some() { current.font_size = incoming.font_size; }
    if incoming.font_family.is_some() { current.font_family = incoming.font_family; }
    if incoming.whitespace.is_some() { current.whitespace = incoming.whitespace; }
    if incoming.html_comment_render_mode.is_some() { current.html_comment_render_mode = incoming.html_comment_render_mode; }
    if incoming.html_content_render_mode.is_some() { current.html_content_render_mode = incoming.html_content_render_mode; }
    if incoming.arrow_key_focus_scroll.is_some() { current.arrow_key_focus_scroll = incoming.arrow_key_focus_scroll; }
    if incoming.board_color.is_some() { current.board_color = incoming.board_color; }
    if incoming.board_color_dark.is_some() { current.board_color_dark = incoming.board_color_dark; }
    if incoming.board_color_light.is_some() { current.board_color_light = incoming.board_color_light; }
    board.board_settings = Some(current.clone());

    state.storage.write_board(&board_id, &board).map_err(|e| {
        log_api_issue(
            StatusCode::INTERNAL_SERVER_ERROR,
            "lexera.api.update_board_settings",
            format!("Failed to write board settings for {}: {}", board_id, e),
        );
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    // Broadcast change so SSE clients can react
    let _ = state.event_tx.send(
        lexera_core::watcher::types::BoardChangeEvent::MainFileChanged {
            board_id: board_id.clone(),
        },
    );
    broadcast_crdt_to_sync_hub(&state, &board_id).await;

    Ok(Json(serde_json::json!({
        "boardId": board_id,
        "boardSettings": current,
    })))
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
    // Quick check (racy but fine -- worst case we export then find no clients)
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
