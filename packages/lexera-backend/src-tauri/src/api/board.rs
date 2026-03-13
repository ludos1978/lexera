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
use super::{insert_header_safe, log_api_issue, validate_board_id, ErrorResponse};
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

#[derive(Deserialize)]
pub struct CrashsaveBoardBody {
    board: lexera_core::types::KanbanBoard,
    reason: Option<String>,
}

pub async fn list_boards(State(state): State<AppState>) -> Json<serde_json::Value> {
    let boards = state.storage.list_boards();

    // Enrich each board with workspace membership and sync overrides from config
    let board_config_map: std::collections::HashMap<String, crate::config::BoardEntry> = state
        .config
        .lock()
        .ok()
        .map(|cfg| {
            cfg.boards
                .iter()
                .map(|b| (b.file.clone(), b.clone()))
                .collect()
        })
        .unwrap_or_default();

    let enriched: Vec<serde_json::Value> = boards
        .into_iter()
        .map(|b| {
            let mut val = serde_json::to_value(&b).unwrap_or_default();
            if let Some(entry) = board_config_map.get(&b.file_path) {
                val["workspaceIds"] = serde_json::json!(entry.workspace_ids);
                val["xbelName"] = serde_json::json!(entry.xbel_name);
                val["bookmarkSync"] = serde_json::json!(entry.bookmark_sync);
                val["calendarSync"] = serde_json::json!(entry.calendar_sync);
                val["calendarSlug"] = serde_json::json!(entry.calendar_slug);
                val["calendarName"] = serde_json::json!(entry.calendar_name);
            }
            val
        })
        .collect();

    Json(serde_json::json!({ "boards": enriched }))
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
                "isRemote": true,
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
    validate_board_id(&board_id)?;
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        let status = StatusCode::NOT_FOUND;
        let error = format!("Board not found: {}", board_id);
        log_api_issue(status, "lexera.api.get_board", &error);
        (status, Json(ErrorResponse { error }))
    })?;

    let version = state.storage.get_board_version(&board_id).unwrap_or(0);
    let is_remote = state.storage.is_remote_board(&board_id);
    let revision = state
        .storage
        .get_board_revision_token(&board_id)
        .unwrap_or_else(|| format!("v{}", version));
    let etag = format!("\"{}\"", revision);

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
            "revision": revision,
            "generation": state.storage.get_board_generation(&board_id).unwrap_or(0),
            "isRemote": is_remote,
            "fullBoard": board,
        })),
    ))
}

pub async fn add_card(
    State(state): State<AppState>,
    Path((board_id, col_index)): Path<(String, usize)>,
    Json(body): Json<AddCardBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
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

    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        let status = StatusCode::NOT_FOUND;
        let error = format!("Board not found: {}", board_id);
        log_api_issue(status, "lexera.api.add_card", &error);
        (status, Json(ErrorResponse { error }))
    })?;
    let num_columns = board.all_columns().len();
    if col_index >= num_columns {
        let status = StatusCode::BAD_REQUEST;
        let error = format!(
            "Column index {} out of range for board {} (has {} columns)",
            col_index, board_id, num_columns
        );
        log_api_issue(status, "lexera.api.add_card", &error);
        return Err((
            status,
            Json(ErrorResponse {
                error: format!(
                    "Column index {} out of range (max {})",
                    col_index,
                    num_columns.saturating_sub(1)
                ),
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

/// POST /boards/{board_id}/cards/{card_id}/append -- append content to an existing card.
pub async fn append_to_card(
    State(state): State<AppState>,
    Path((board_id, card_id)): Path<(String, String)>,
    Json(body): Json<AddCardBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    if body.content.trim().is_empty() {
        let status = StatusCode::BAD_REQUEST;
        let error = "Missing or empty content".to_string();
        log_api_issue(status, "lexera.api.append_to_card", &error);
        return Err((status, Json(ErrorResponse { error })));
    }

    state
        .storage
        .append_to_card(&board_id, &card_id, &body.content)
        .map_err(|e| {
            let status = match &e {
                lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
                lexera_core::storage::StorageError::CardNotFound(_) => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            log_api_issue(
                status,
                "lexera.api.append_to_card",
                format!(
                    "Failed to append to card {} on board {}: {}",
                    card_id, board_id, e
                ),
            );
            (
                status,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "success": true }))))
}

/// PUT /boards/{board_id} -- write a full board, with card-level merge on conflict.
pub async fn write_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(board): Json<lexera_core::types::KanbanBoard>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    let write_result = state.storage.write_board(&board_id, &board).map_err(|e| {
        let status = match &e {
            lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
            lexera_core::storage::StorageError::ConflictDetected { .. } => StatusCode::CONFLICT,
            lexera_core::storage::StorageError::InvalidBoard(_) => StatusCode::BAD_REQUEST,
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
    emit_main_file_changed(&state, &board_id);
    broadcast_crdt_to_sync_hub(&state, &board_id).await;
    let mut response = build_write_board_response(
        &state, &board_id, write_result.merge_result, &board,
    );
    if let Some(ref redirected) = write_result.redirected_path {
        response["redirectedPath"] = serde_json::Value::String(
            redirected.to_string_lossy().to_string(),
        );
    }
    Ok(Json(response))
}

/// POST /boards/{board_id}/crashsave -- persist the current draft as a recovery markdown file.
pub async fn create_board_crashsave(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<CrashsaveBoardBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    let reason = body.reason.unwrap_or_else(|| "manual-recovery".to_string());
    let crashsave = state
        .storage
        .create_crashsave(&board_id, &body.board, &reason)
        .map_err(|e| {
            let status = match &e {
                lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
                lexera_core::storage::StorageError::InvalidBoard(_) => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            log_api_issue(
                status,
                "lexera.api.create_board_crashsave",
                format!(
                    "Failed to create crashsave for board {} (reason={}): {}",
                    board_id, reason, e
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
        Json(serde_json::json!({
            "success": true,
            "path": crashsave.path.to_string_lossy(),
            "filename": crashsave.filename,
            "savedAt": crashsave.timestamp,
            "reason": reason,
        })),
    ))
}

/// POST /boards/{board_id}/sync-save -- write a board relative to a client base snapshot.
pub async fn write_board_with_base(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<SyncSaveBoardBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    let write_result = state
        .storage
        .write_board_from_base(&board_id, &body.base_board, &body.board)
        .map_err(|e| {
            let status = match &e {
                lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
                lexera_core::storage::StorageError::ConflictDetected { .. } => StatusCode::CONFLICT,
                lexera_core::storage::StorageError::InvalidBoard(_) => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            log_api_issue(
                status,
                "lexera.api.write_board_with_base",
                format!(
                    "Failed to write board {} from base snapshot: {}",
                    board_id, e
                ),
            );
            (
                status,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    emit_main_file_changed(&state, &board_id);
    broadcast_crdt_to_sync_hub(&state, &board_id).await;
    let mut response = build_write_board_response(
        &state,
        &board_id,
        write_result.merge_result,
        &body.board,
    );
    if let Some(ref redirected) = write_result.redirected_path {
        response["redirectedPath"] = serde_json::Value::String(
            redirected.to_string_lossy().to_string(),
        );
    }
    Ok(Json(response))
}

/// POST /boards/{board_id}/rebase -- merge a client draft against the latest board without saving.
pub async fn rebase_board_with_base(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<SyncSaveBoardBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    let (current_board, merged_board, result) = state
        .storage
        .rebase_board_from_base(&board_id, &body.base_board, &body.board)
        .map_err(|e| {
            let status = match &e {
                lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
                lexera_core::storage::StorageError::InvalidBoard(_) => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            log_api_issue(
                status,
                "lexera.api.rebase_board_with_base",
                format!(
                    "Failed to rebase board {} from base snapshot: {}",
                    board_id, e
                ),
            );
            (
                status,
                Json(ErrorResponse {
                    error: e.to_string(),
                }),
            )
        })?;
    Ok(Json(build_rebase_board_response(
        &state,
        &board_id,
        current_board,
        merged_board,
        result,
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

    let snapshot =
        live_sync::open_session(&board_id, board, board_dir, snapshot).map_err(|error| {
            let status = StatusCode::INTERNAL_SERVER_ERROR;
            log_api_issue(
                status,
                "lexera.api.live_sync.open",
                format!(
                    "Failed to open live sync session for board {}: {}",
                    board_id, error
                ),
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
            format!(
                "Failed to apply live sync board for session {}: {}",
                session_id, error
            ),
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
    if tokio::fs::metadata(&path).await.is_err() {
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
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .unwrap_or_else(|_| path.clone());
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
        let mut cfg_changed = crate::config::normalize_workspace_setup(&mut cfg);
        let file_str = canonical.to_string_lossy().to_string();
        if !cfg.boards.iter().any(|b| b.file == file_str) {
            let default_ws = cfg
                .default_workspace
                .clone()
                .or_else(|| cfg.workspaces.first().map(|w| w.id.clone()));
            cfg.boards.push(crate::config::BoardEntry {
                file: file_str,
                name: None,
                xbel_name: None,
                bookmark_sync: None,
                calendar_sync: None,
                calendar_slug: None,
                calendar_name: None,
                workspace_ids: default_ws.into_iter().collect(),
            });
            cfg_changed = true;
        }
        if cfg_changed {
            if let Err(e) = crate::config::save_config(&state.config_path, &cfg) {
                log::warn!("[lexera.api.add_board] Failed to save config: {}", e);
            }
            crate::ludos_sync::spawn_ludos_sync_reconcile(state.clone());
        }
    }

    // Broadcast board list change via SSE
    if let Err(error) = state.event_tx.send(
        lexera_core::watcher::types::BoardChangeEvent::MainFileChanged {
            board_id: board_id.clone(),
            revision: state.storage.get_board_revision_token(&board_id),
            generation: state.storage.get_board_generation(&board_id),
            writer_id: None,
        },
    ) {
        log::warn!(
            "[lexera.api.add_board] Failed to publish MainFileChanged for {}: {}",
            board_id,
            error
        );
    }

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
    validate_board_id(&board_id)?;
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
        // Collect board file paths from config (release lock before async work)
        let board_files: Vec<String> = state
            .config
            .lock()
            .ok()
            .map(|cfg| cfg.boards.iter().map(|b| b.file.clone()).collect())
            .unwrap_or_default();
        // Pre-compute canonical paths asynchronously
        let mut canonical_map: Vec<(String, PathBuf)> = Vec::new();
        for file in &board_files {
            let canonical = tokio::fs::canonicalize(file)
                .await
                .unwrap_or_else(|_| PathBuf::from(file));
            canonical_map.push((file.clone(), canonical));
        }
        // Re-acquire lock and filter
        if let Ok(mut cfg) = state.config.lock() {
            cfg.boards.retain(|b| {
                let entry_canonical = canonical_map
                    .iter()
                    .find(|(file, _)| file == &b.file)
                    .map(|(_, c)| c.clone())
                    .unwrap_or_else(|| PathBuf::from(&b.file));
                entry_canonical != *path && b.file != path_str
            });
            if let Err(e) = crate::config::save_config(&state.config_path, &cfg) {
                log::warn!("[lexera.api.remove_board] Failed to save config: {}", e);
            }
            crate::ludos_sync::spawn_ludos_sync_reconcile(state.clone());
        }
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

/// GET /boards/{board_id}/settings -- read board settings without loading full board data.
pub async fn get_board_settings(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("Board not found: {}", board_id),
            }),
        )
    })?;

    let settings = board.board_settings.unwrap_or_default();

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
    validate_board_id(&board_id)?;
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
    current.merge_from(incoming);
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
    if let Err(error) = state.event_tx.send(
        lexera_core::watcher::types::BoardChangeEvent::MainFileChanged {
            board_id: board_id.clone(),
            revision: state.storage.get_board_revision_token(&board_id),
            generation: state.storage.get_board_generation(&board_id),
            writer_id: None,
        },
    ) {
        log::warn!(
            "[lexera.api.update_board_settings] Failed to publish MainFileChanged for {}: {}",
            board_id,
            error
        );
    }
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
    let generation = state.storage.get_board_generation(board_id).unwrap_or(0);
    let revision = state
        .storage
        .get_board_revision_token(board_id)
        .unwrap_or_else(|| format!("v{}", version));
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
            "revision": revision,
            "generation": generation,
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
            "revision": revision,
            "generation": generation,
        })
    }
}

fn build_rebase_board_response(
    state: &AppState,
    board_id: &str,
    current_board: lexera_core::types::KanbanBoard,
    merged_board: lexera_core::types::KanbanBoard,
    result: Option<lexera_core::merge::merge::MergeResult>,
) -> serde_json::Value {
    let version = state.storage.get_board_version(board_id).unwrap_or(0);
    let generation = state.storage.get_board_generation(board_id).unwrap_or(0);
    let revision = state
        .storage
        .get_board_revision_token(board_id)
        .unwrap_or_else(|| format!("v{}", version));
    if let Some(merge_result) = result {
        let has_conflicts = !merge_result.conflicts.is_empty();
        serde_json::json!({
            "success": true,
            "merged": true,
            "autoMerged": merge_result.auto_merged,
            "conflicts": merge_result.conflicts.len(),
            "hasConflicts": has_conflicts,
            "board": merged_board,
            "currentBoard": current_board,
            "version": version,
            "revision": revision,
            "generation": generation,
        })
    } else {
        serde_json::json!({
            "success": true,
            "merged": false,
            "autoMerged": 0,
            "conflicts": 0,
            "hasConflicts": false,
            "board": merged_board,
            "currentBoard": current_board,
            "version": version,
            "revision": revision,
            "generation": generation,
        })
    }
}

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
        None => {
            log::warn!(
                "[lexera.api.broadcast_crdt] Failed to export CRDT updates for board {}",
                board_id
            );
            return;
        }
    };
    let msg = serde_json::json!({
        "type": "ServerUpdate",
        "updates": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &updates),
    });
    let msg_str = msg.to_string();
    let hub = state.sync_hub.lock().await;
    hub.broadcast(board_id, 0, &msg_str);
}

fn emit_main_file_changed(state: &AppState, board_id: &str) {
    if let Err(error) = state.event_tx.send(
        lexera_core::watcher::types::BoardChangeEvent::MainFileChanged {
            board_id: board_id.to_string(),
            revision: state.storage.get_board_revision_token(board_id),
            generation: state.storage.get_board_generation(board_id),
            writer_id: Some(state.local_user_id.clone()),
        },
    ) {
        log::warn!(
            "[lexera.api.board] Failed to publish MainFileChanged for {}: {}",
            board_id,
            error
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use http_body_util::BodyExt;
    use lexera_core::storage::local::LocalStorage;
    use std::sync::Arc;
    use tower::ServiceExt;

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

    const MINIMAL_BOARD: &str = "\
---
kanban-plugin: board
---

## Todo
- [ ] Task A
- [ ] Task B

## Done
- [x] Task C
";

    #[tokio::test]
    async fn list_boards_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/boards")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let boards = json["boards"].as_array().unwrap();
        assert!(boards.is_empty());
    }

    #[tokio::test]
    async fn add_board_and_list() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "test.md", MINIMAL_BOARD);
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/boards")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "file": board_path.to_str().unwrap() }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json = body_json(resp.into_body()).await;
        let board_id = json["boardId"].as_str().unwrap().to_string();
        assert!(!board_id.is_empty());
    }

    #[tokio::test]
    async fn list_boards_includes_sync_overrides_from_config() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "sync.md", MINIMAL_BOARD);
        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();
        {
            let mut cfg = state.config.lock().unwrap();
            cfg.boards.push(crate::config::BoardEntry {
                file: std::fs::canonicalize(&board_path)
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                xbel_name: Some("bookmarks.xbel".to_string()),
                bookmark_sync: Some(false),
                calendar_sync: Some(true),
                calendar_slug: Some("team".to_string()),
                calendar_name: Some("Team Calendar".to_string()),
                workspace_ids: vec!["ws-1".to_string()],
                ..crate::config::BoardEntry::default()
            });
        }
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/boards")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let boards = json["boards"].as_array().unwrap();
        let board = boards
            .iter()
            .find(|entry| entry["id"].as_str() == Some(&board_id))
            .unwrap();
        assert_eq!(board["xbelName"], "bookmarks.xbel");
        assert_eq!(board["bookmarkSync"], false);
        assert_eq!(board["calendarSync"], true);
        assert_eq!(board["calendarSlug"], "team");
        assert_eq!(board["calendarName"], "Team Calendar");
        assert_eq!(board["workspaceIds"][0], "ws-1");
    }

    #[tokio::test]
    async fn get_columns_for_added_board() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "cols.md", MINIMAL_BOARD);
        let state = test_state(tmp.path());

        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(&format!("/boards/{}/columns", board_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let columns = json["columns"].as_array().unwrap();
        assert_eq!(columns.len(), 2);
        assert_eq!(columns[0]["title"].as_str().unwrap(), "Todo");
        assert_eq!(columns[1]["title"].as_str().unwrap(), "Done");

        let todo_cards = columns[0]["cards"].as_array().unwrap();
        assert_eq!(todo_cards.len(), 2);
    }

    #[tokio::test]
    async fn delete_board() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "del.md", MINIMAL_BOARD);
        let state = test_state(tmp.path());

        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state.clone());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(&format!("/boards/{}", board_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["success"], true);

        let app2 = test_router(state);
        let resp2 = app2
            .oneshot(
                Request::builder()
                    .uri("/boards")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let json2 = body_json(resp2.into_body()).await;
        assert!(json2["boards"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn get_columns_nonexistent_board_returns_404() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/boards/does-not-exist/columns")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    // ── New-format board for 3-way merge integration tests ──────────

    const NEW_FORMAT_BOARD: &str = "\
---
kanban-plugin: board
---

# Row1

## Stack1

### ColA
- [ ] card-a1
- [ ] card-a2

### ColB
- [ ] card-b1

## Stack2

### ColC
- [ ] card-c1
";

    /// Helper: add a new-format board and return (board_id, initial_board).
    async fn add_new_format_board(
        tmp: &std::path::Path,
        name: &str,
    ) -> (AppState, String, lexera_core::types::KanbanBoard) {
        let board_path = write_board_file(tmp, name, NEW_FORMAT_BOARD);
        let state = test_state(tmp);
        let board_id = state.storage.add_board(&board_path).unwrap();
        let board = state.storage.read_board(&board_id).unwrap();
        (state, board_id, board)
    }

    /// Helper: call POST /boards/{id}/sync-save with base and incoming boards.
    async fn sync_save(
        app: Router,
        board_id: &str,
        base: &lexera_core::types::KanbanBoard,
        incoming: &lexera_core::types::KanbanBoard,
    ) -> (StatusCode, serde_json::Value) {
        let body = serde_json::json!({
            "baseBoard": base,
            "board": incoming,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(&format!("/boards/{}/sync-save", board_id))
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let json = body_json(resp.into_body()).await;
        (status, json)
    }

    #[tokio::test]
    async fn sync_save_add_card_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "add-card.md").await;

        // User adds a card to ColA
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns[0].cards.push(
            lexera_core::types::KanbanCard {
                id: "new".into(),
                content: "new-card".into(),
                checked: false,
                kid: Some("kid-new".into()),
            },
        );

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a_cards: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards.iter().map(|c| c.content.as_str()).collect();
        assert!(col_a_cards.contains(&"new-card"), "new card should be saved");
        assert!(col_a_cards.contains(&"card-a1"), "existing cards preserved");
        assert!(col_a_cards.contains(&"card-a2"), "existing cards preserved");
    }

    #[tokio::test]
    async fn sync_save_delete_card_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "del-card.md").await;

        // User removes card-a2
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns[0].cards.retain(|c| c.content != "card-a2");

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a_cards: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards.iter().map(|c| c.content.as_str()).collect();
        assert!(!col_a_cards.contains(&"card-a2"), "card-a2 should be removed");
        assert!(col_a_cards.contains(&"card-a1"), "card-a1 preserved");
    }

    #[tokio::test]
    async fn sync_save_add_column_preserves_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "add-col.md").await;

        // User adds a new column to Stack1
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns.push(
            lexera_core::types::KanbanColumn {
                id: "col-new".into(),
                title: "NewCol".into(),
                cards: vec![lexera_core::types::KanbanCard {
                    id: "n".into(),
                    content: "new-col-card".into(),
                    checked: false,
                    kid: Some("kid-nc".into()),
                }],
                include_source: None,
            },
        );

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_titles: Vec<&str> = saved.rows[0].stacks[0]
            .columns.iter().map(|c| c.title.as_str()).collect();
        assert!(col_titles.contains(&"NewCol"), "new column added");
        assert!(col_titles.contains(&"ColA"), "ColA preserved");
        assert!(col_titles.contains(&"ColB"), "ColB preserved");
    }

    #[tokio::test]
    async fn sync_save_delete_column_preserves_siblings() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "del-col.md").await;

        // User deletes ColB from Stack1
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns.retain(|c| c.title != "ColB");

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_titles: Vec<&str> = saved.rows[0].stacks[0]
            .columns.iter().map(|c| c.title.as_str()).collect();
        assert!(!col_titles.contains(&"ColB"), "ColB removed");
        assert!(col_titles.contains(&"ColA"), "ColA preserved");
    }

    #[tokio::test]
    async fn sync_save_add_stack_preserves_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "add-stack.md").await;

        // User adds a new stack to Row1
        let mut incoming = base.clone();
        incoming.rows[0].stacks.push(lexera_core::types::KanbanStack {
            id: "stack-new".into(),
            title: "NewStack".into(),
            columns: vec![lexera_core::types::KanbanColumn {
                id: "col-ns".into(),
                title: "NSCol".into(),
                cards: vec![],
                include_source: None,
            }],
        });

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let stack_titles: Vec<&str> = saved.rows[0]
            .stacks.iter().map(|s| s.title.as_str()).collect();
        assert!(stack_titles.contains(&"NewStack"), "new stack added");
        assert!(stack_titles.contains(&"Stack1"), "Stack1 preserved");
        assert!(stack_titles.contains(&"Stack2"), "Stack2 preserved");
    }

    #[tokio::test]
    async fn sync_save_delete_stack_preserves_siblings() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "del-stack.md").await;

        // User deletes Stack2
        let mut incoming = base.clone();
        incoming.rows[0].stacks.retain(|s| s.title != "Stack2");

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let stack_titles: Vec<&str> = saved.rows[0]
            .stacks.iter().map(|s| s.title.as_str()).collect();
        assert!(!stack_titles.contains(&"Stack2"), "Stack2 removed");
        assert!(stack_titles.contains(&"Stack1"), "Stack1 preserved");
    }

    #[tokio::test]
    async fn sync_save_add_row_preserves_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "add-row.md").await;

        // User adds a new row
        let mut incoming = base.clone();
        incoming.rows.push(lexera_core::types::KanbanRow {
            id: "row-new".into(),
            title: "Row2".into(),
            stacks: vec![lexera_core::types::KanbanStack {
                id: "stack-r2".into(),
                title: "R2Stack".into(),
                columns: vec![lexera_core::types::KanbanColumn {
                    id: "col-r2".into(),
                    title: "R2Col".into(),
                    cards: vec![],
                    include_source: None,
                }],
            }],
        });

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let row_titles: Vec<&str> = saved.rows.iter().map(|r| r.title.as_str()).collect();
        assert!(row_titles.contains(&"Row2"), "new row added");
        assert!(row_titles.contains(&"Row1"), "Row1 preserved");
    }

    #[tokio::test]
    async fn sync_save_delete_row_preserves_siblings() {
        // Start with a 2-row board
        let two_row_md = "\
---
kanban-plugin: board
---

# RowA

## StackA

### ColX
- [ ] card-x1

# RowB

## StackB

### ColY
- [ ] card-y1
";
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "del-row.md", two_row_md);
        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();
        let base = state.storage.read_board(&board_id).unwrap();
        assert_eq!(base.rows.len(), 2);

        // User deletes RowB
        let mut incoming = base.clone();
        incoming.rows.retain(|r| r.title != "RowB");

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        assert_eq!(saved.rows.len(), 1);
        assert_eq!(saved.rows[0].title, "RowA");
    }

    #[tokio::test]
    async fn sync_save_rename_column_preserves_cards() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "rename-col.md").await;

        // User renames ColA -> ColA-Renamed
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns[0].title = "ColA-Renamed".into();

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col = &saved.rows[0].stacks[0].columns[0];
        assert_eq!(col.title, "ColA-Renamed");
        assert_eq!(col.cards.len(), 2, "cards preserved after rename");
    }

    #[tokio::test]
    async fn sync_save_move_card_between_columns() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "move-card.md").await;

        // User moves card-a1 from ColA to ColB
        let mut incoming = base.clone();
        let card = incoming.rows[0].stacks[0].columns[0]
            .cards.remove(0); // card-a1
        incoming.rows[0].stacks[0].columns[1].cards.push(card);

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a_cards: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards.iter().map(|c| c.content.as_str()).collect();
        let col_b_cards: Vec<&str> = saved.rows[0].stacks[0].columns[1]
            .cards.iter().map(|c| c.content.as_str()).collect();
        assert!(!col_a_cards.contains(&"card-a1"), "card-a1 moved from ColA");
        assert!(col_b_cards.contains(&"card-a1"), "card-a1 moved to ColB");
        assert!(col_b_cards.contains(&"card-b1"), "card-b1 still in ColB");
    }

    #[tokio::test]
    async fn sync_save_multiple_edits_sequential() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "multi-edit.md").await;

        // Edit 1: add a card
        let mut edit1 = base.clone();
        edit1.rows[0].stacks[0].columns[0].cards.push(
            lexera_core::types::KanbanCard {
                id: "e1".into(),
                content: "edit1-card".into(),
                checked: false,
                kid: Some("kid-e1".into()),
            },
        );

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &edit1).await;
        assert_eq!(status, StatusCode::OK);

        // Edit 2: read current state, then add another card
        let base2 = state.storage.read_board(&board_id).unwrap();
        let mut edit2 = base2.clone();
        edit2.rows[0].stacks[0].columns[0].cards.push(
            lexera_core::types::KanbanCard {
                id: "e2".into(),
                content: "edit2-card".into(),
                checked: false,
                kid: Some("kid-e2".into()),
            },
        );

        let app2 = test_router(state.clone());
        let (status2, _) = sync_save(app2, &board_id, &base2, &edit2).await;
        assert_eq!(status2, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a_cards: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards.iter().map(|c| c.content.as_str()).collect();
        assert!(col_a_cards.contains(&"card-a1"));
        assert!(col_a_cards.contains(&"card-a2"));
        assert!(col_a_cards.contains(&"edit1-card"));
        assert!(col_a_cards.contains(&"edit2-card"));
    }

    #[tokio::test]
    async fn sync_save_idempotent_no_change() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "idempotent.md").await;

        // Save the same board back (no changes)
        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &base).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        assert_eq!(saved.rows.len(), base.rows.len());
        assert_eq!(
            saved.rows[0].stacks[0].columns[0].cards.len(),
            base.rows[0].stacks[0].columns[0].cards.len(),
        );
    }
}
