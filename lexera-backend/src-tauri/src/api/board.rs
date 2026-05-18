use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use lexera_core::storage::{
    BoardStorage, CrdtSyncStorage, StorageError, CRDT_SYNC_DISABLED_MESSAGE,
};
use serde::Deserialize;
use std::path::PathBuf;

#[cfg(feature = "crdt")]
use super::live_sync;
use super::{
    err_bad_request, err_internal, err_not_found, insert_header_safe, log_api_issue,
    validate_board_id, ErrorResponse,
};
use crate::state::AppState;

/// Map a `StorageError` to an HTTP status code + JSON error response, logging the issue.
fn storage_error_response(
    error: StorageError,
    target: &'static str,
    context: impl std::fmt::Display,
) -> (StatusCode, Json<ErrorResponse>) {
    let status = match &error {
        StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
        StorageError::CardNotFound(_) => StatusCode::NOT_FOUND,
        StorageError::ColumnOutOfRange { .. } => StatusCode::BAD_REQUEST,
        StorageError::ConflictDetected { .. } => StatusCode::CONFLICT,
        StorageError::InvalidBoard(_) => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    log_api_issue(status, target, format!("{}: {}", context, error));
    (
        status,
        Json(ErrorResponse {
            error: error.to_string(),
        }),
    )
}

fn board_response_metadata(state: &AppState, board_id: &str) -> (u64, bool, String, String) {
    let version = state.storage.get_board_version(board_id).unwrap_or(0);
    let is_remote = state.storage.is_remote_board(board_id);
    let revision = state
        .storage
        .get_board_revision_token(board_id)
        .unwrap_or_else(|| format!("v{}", version));
    let etag = format!("\"{}\"", revision);
    (version, is_remote, revision, etag)
}

fn err_crdt_sync_disabled() -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(ErrorResponse {
            error: CRDT_SYNC_DISABLED_MESSAGE.to_string(),
        }),
    )
}

fn maybe_not_modified(
    headers: &HeaderMap,
    etag: &str,
) -> Option<(StatusCode, HeaderMap, Json<serde_json::Value>)> {
    if let Some(if_none_match) = headers.get("if-none-match") {
        if let Ok(value) = if_none_match.to_str() {
            if value == etag {
                let mut resp_headers = HeaderMap::new();
                insert_header_safe(&mut resp_headers, "etag", etag);
                return Some((
                    StatusCode::NOT_MODIFIED,
                    resp_headers,
                    Json(serde_json::json!({})),
                ));
            }
        }
    }
    None
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

#[derive(Deserialize)]
pub struct ResolveMergeBody {
    /// The base the client merged from (same one it sent on the
    /// conflicting save).
    #[serde(rename = "baseBoard")]
    base_board: lexera_core::types::KanbanBoard,
    /// The client's draft ("ours") at conflict time.
    incoming: lexera_core::types::KanbanBoard,
    /// The user's decision from the merge view.
    resolution: lexera_core::merge::resolution::MergeResolution,
}

#[derive(Deserialize)]
pub struct BoardChangesQuery {
    since_generation: u64,
}

pub async fn list_boards(State(state): State<AppState>) -> Json<serde_json::Value> {
    let boards = state.storage.list_boards();

    // Enrich each board with workspace membership and sync overrides from config
    let board_config_map: std::collections::HashMap<String, crate::config::BoardEntry> = state
        .config
        .read()
        .ok()
        .map(|cfg| {
            cfg.boards
                .iter()
                .map(|b| (b.file.clone(), b.clone()))
                .collect()
        })
        .unwrap_or_default();

    // Collect peer counts from the sync hub
    let hub = state.sync_hub.lock().await;

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
            let peer_count = hub.online_users(&b.id).len();
            val["peerCount"] = serde_json::json!(peer_count);
            val["isLocal"] = serde_json::json!(!state.storage.is_remote_board(&b.id));
            val
        })
        .collect();

    drop(hub);
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
        let error = format!("Board not found: {}", board_id);
        log_api_issue(StatusCode::NOT_FOUND, "lexera.api.get_board", &error);
        err_not_found(error)
    })?;

    let (version, is_remote, revision, etag) = board_response_metadata(&state, &board_id);

    if let Some(response) = maybe_not_modified(&headers, &etag) {
        return Ok(response);
    }

    let mut resp_headers = HeaderMap::new();
    insert_header_safe(&mut resp_headers, "etag", &etag);

    Ok((
        StatusCode::OK,
        resp_headers,
        Json(serde_json::json!({
            "boardId": board_id,
            "title": board.title,
            "version": version,
            "revision": revision,
            "generation": state.storage.get_board_generation(&board_id).unwrap_or(0),
            "isRemote": is_remote,
            "fullBoard": board,
        })),
    ))
}

pub async fn get_board_hierarchy(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    headers: HeaderMap,
) -> Result<(StatusCode, HeaderMap, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    let title = state.storage.read_board_title(&board_id).ok_or_else(|| {
        let error = format!("Board not found: {}", board_id);
        log_api_issue(
            StatusCode::NOT_FOUND,
            "lexera.api.get_board_hierarchy",
            &error,
        );
        err_not_found(error)
    })?;
    let rows = state
        .storage
        .read_board_hierarchy(&board_id)
        .ok_or_else(|| {
            let error = format!("Board not found: {}", board_id);
            log_api_issue(
                StatusCode::NOT_FOUND,
                "lexera.api.get_board_hierarchy",
                &error,
            );
            err_not_found(error)
        })?;

    let (version, is_remote, revision, etag) = board_response_metadata(&state, &board_id);
    if let Some(response) = maybe_not_modified(&headers, &etag) {
        return Ok(response);
    }
    let generation = state.storage.get_board_generation(&board_id).unwrap_or(0);

    let mut resp_headers = HeaderMap::new();
    insert_header_safe(&mut resp_headers, "etag", &etag);

    Ok((
        StatusCode::OK,
        resp_headers,
        Json(serde_json::json!({
            "boardId": board_id,
            "title": title,
            "rows": rows,
            "version": version,
            "revision": revision,
            "generation": generation,
            "isRemote": is_remote,
        })),
    ))
}

pub async fn get_board_changes(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(query): Query<BoardChangesQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    let title = state.storage.read_board_title(&board_id).ok_or_else(|| {
        let error = format!("Board not found: {}", board_id);
        log_api_issue(
            StatusCode::NOT_FOUND,
            "lexera.api.get_board_changes",
            &error,
        );
        err_not_found(error)
    })?;

    let (version, is_remote, revision, _) = board_response_metadata(&state, &board_id);
    let generation = state.storage.get_board_generation(&board_id).unwrap_or(0);
    let delta = state
        .storage
        .get_board_delta_since_generation(&board_id, query.since_generation);

    Ok(Json(serde_json::json!({
        "boardId": board_id,
        "title": title,
        "version": version,
        "revision": revision,
        "generation": generation,
        "isRemote": is_remote,
        "available": delta.is_some(),
        "delta": delta,
    })))
}

pub async fn add_card(
    State(state): State<AppState>,
    Path((board_id, col_index)): Path<(String, usize)>,
    Json(body): Json<AddCardBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    if body.content.trim().is_empty() {
        let error = format!(
            "Missing or empty content for add_card on board {} column {}",
            board_id, col_index
        );
        log_api_issue(StatusCode::BAD_REQUEST, "lexera.api.add_card", &error);
        return Err(err_bad_request("Missing or empty content"));
    }

    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        let error = format!("Board not found: {}", board_id);
        log_api_issue(StatusCode::NOT_FOUND, "lexera.api.add_card", &error);
        err_not_found(error)
    })?;
    let num_columns = board.all_columns().len();
    if col_index >= num_columns {
        let error = format!(
            "Column index {} out of range for board {} (has {} columns)",
            col_index, board_id, num_columns
        );
        log_api_issue(StatusCode::BAD_REQUEST, "lexera.api.add_card", &error);
        return Err(err_bad_request(format!(
            "Column index {} out of range (max {})",
            col_index,
            num_columns.saturating_sub(1)
        )));
    }

    state
        .storage
        .add_card(&board_id, col_index, &body.content)
        .map_err(|e| {
            storage_error_response(
                e,
                "lexera.api.add_card",
                format!(
                    "Failed to add card to board {} column {}",
                    board_id, col_index
                ),
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
        log_api_issue(
            StatusCode::BAD_REQUEST,
            "lexera.api.append_to_card",
            "Missing or empty content",
        );
        return Err(err_bad_request("Missing or empty content"));
    }

    state
        .storage
        .append_to_card(&board_id, &card_id, &body.content)
        .map_err(|e| {
            storage_error_response(
                e,
                "lexera.api.append_to_card",
                format!("Failed to append to card {} on board {}", card_id, board_id),
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
        storage_error_response(
            e,
            "lexera.api.write_board",
            format!("Failed to write board {}", board_id),
        )
    })?;
    emit_main_file_changed(&state, &board_id);
    broadcast_crdt_to_sync_hub(&state, &board_id).await;
    let mut response =
        build_write_board_response(&state, &board_id, write_result.merge_result, &board);
    if let Some(ref redirected) = write_result.redirected_path {
        response["redirectedPath"] =
            serde_json::Value::String(redirected.to_string_lossy().to_string());
    }
    Ok(Json(response))
}

/// POST /boards/{board_id}/resolve-merge -- apply the user's merge-view
/// decision for a non-CRDT conflicting save.
///
/// `current` is whatever is on disk now (the auto-merged board the
/// conflicting save persisted). The same three sides the frontend saw are
/// re-merged to recover the conflict set, then the user's
/// [`MergeResolution`] is applied. For the conflict-file-backup strategy
/// the discarded side is written to `{stem}-conflict-{ts}.md` first so no
/// data is ever lost; the kept side is then persisted.
pub async fn resolve_merge(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<ResolveMergeBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    use lexera_core::merge::resolution::apply_resolution;
    use lexera_core::storage::merge_engine::{CardIdentityMergeEngine, MergeEngine, MergeRequest};

    let current = state
        .storage
        .read_board(&board_id)
        .ok_or_else(|| err_not_found(format!("Board not found: {}", board_id)))?;

    let outcome = CardIdentityMergeEngine
        .merge_from_base(MergeRequest {
            board_id: &board_id,
            base: &body.base_board,
            current: &current,
            incoming: &body.incoming,
        })
        .map_err(|e| {
            storage_error_response(
                e,
                "lexera.api.resolve_merge",
                format!("Merge recompute failed for board {}", board_id),
            )
        })?;
    let mr = outcome.artifact;

    let resolved = apply_resolution(
        &body.base_board,
        &current,
        &body.incoming,
        &mr.board,
        &mr.conflicts,
        &body.resolution,
    );

    let mut conflict_backup_path: Option<String> = None;
    if let Some(losing) = resolved.backup {
        if let Some(board_path) = state.storage.get_board_path(&board_id) {
            let md = lexera_core::parser::generate_markdown(&losing);
            match lexera_core::storage::backup::BackupManager::create_conflict_backup(
                &board_path,
                &md,
            ) {
                Ok(entry) => conflict_backup_path = Some(entry.path.to_string_lossy().to_string()),
                Err(e) => log_api_issue(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "lexera.api.resolve_merge",
                    format!("Conflict backup write failed for board {}: {}", board_id, e),
                ),
            }
        }
    }

    let write_result = state
        .storage
        .write_board(&board_id, &resolved.board)
        .map_err(|e| {
            storage_error_response(
                e,
                "lexera.api.resolve_merge",
                format!("Failed to persist resolved board {}", board_id),
            )
        })?;
    emit_main_file_changed(&state, &board_id);
    broadcast_crdt_to_sync_hub(&state, &board_id).await;

    let mut response = build_write_board_response(
        &state,
        &board_id,
        write_result.merge_result,
        &resolved.board,
    );
    response["resolved"] = serde_json::Value::Bool(true);
    if let Some(p) = conflict_backup_path {
        response["conflictBackupPath"] = serde_json::Value::String(p);
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
            storage_error_response(
                e,
                "lexera.api.create_board_crashsave",
                format!(
                    "Failed to create crashsave for board {} (reason={})",
                    board_id, reason
                ),
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
            storage_error_response(
                e,
                "lexera.api.write_board_with_base",
                format!("Failed to write board {} from base snapshot", board_id),
            )
        })?;
    emit_main_file_changed(&state, &board_id);
    broadcast_crdt_to_sync_hub(&state, &board_id).await;
    let mut response =
        build_write_board_response(&state, &board_id, write_result.merge_result, &body.board);
    if let Some(ref redirected) = write_result.redirected_path {
        response["redirectedPath"] =
            serde_json::Value::String(redirected.to_string_lossy().to_string());
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
            storage_error_response(
                e,
                "lexera.api.rebase_board_with_base",
                format!("Failed to rebase board {} from base snapshot", board_id),
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

#[cfg(not(feature = "crdt"))]
pub async fn open_live_sync_session(
    State(_state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    log::warn!(
        target: "lexera.api.live_sync.open",
        "{}; rejecting live sync session for board {}",
        CRDT_SYNC_DISABLED_MESSAGE,
        board_id
    );
    Err(err_crdt_sync_disabled())
}

#[cfg(feature = "crdt")]
pub async fn open_live_sync_session(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;
    if !CrdtSyncStorage::crdt_sync_available(state.storage.as_ref()) {
        log::warn!(
            target: "lexera.api.live_sync.open",
            "{}; rejecting live sync session for board {}",
            CRDT_SYNC_DISABLED_MESSAGE,
            board_id
        );
        return Err(err_crdt_sync_disabled());
    }

    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        let error = format!("Board not found for live sync open: {}", board_id);
        log_api_issue(StatusCode::NOT_FOUND, "lexera.api.live_sync.open", &error);
        err_not_found(error)
    })?;

    let board_dir = state
        .storage
        .get_board_path(&board_id)
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let snapshot = CrdtSyncStorage::export_crdt_snapshot(state.storage.as_ref(), &board_id);

    let snapshot =
        live_sync::open_session(&board_id, board, board_dir, snapshot).map_err(|error| {
            log_api_issue(
                StatusCode::INTERNAL_SERVER_ERROR,
                "lexera.api.live_sync.open",
                format!(
                    "Failed to open live sync session for board {}: {}",
                    board_id, error
                ),
            );
            err_internal(error)
        })?;

    Ok(Json(serde_json::json!({
        "sessionId": snapshot.session_id,
        "board": snapshot.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &snapshot.vv),
    })))
}

#[cfg(not(feature = "crdt"))]
pub async fn apply_live_sync_board(
    Path(session_id): Path<String>,
    Json(body): Json<LiveSyncApplyBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let _ = body.board;
    log::warn!(
        target: "lexera.api.live_sync.apply",
        "{}; rejecting live sync apply for session {}",
        CRDT_SYNC_DISABLED_MESSAGE,
        session_id
    );
    Err(err_crdt_sync_disabled())
}

#[cfg(feature = "crdt")]
pub async fn apply_live_sync_board(
    Path(session_id): Path<String>,
    Json(body): Json<LiveSyncApplyBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let result = live_sync::apply_board(&session_id, body.board).map_err(|error| {
        log_api_issue(
            StatusCode::BAD_REQUEST,
            "lexera.api.live_sync.apply",
            format!(
                "Failed to apply live sync board for session {}: {}",
                session_id, error
            ),
        );
        err_bad_request(error)
    })?;

    Ok(Json(serde_json::json!({
        "board": result.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.vv),
        "changed": result.changed,
        "updates": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.updates),
    })))
}

#[cfg(not(feature = "crdt"))]
pub async fn import_live_sync_updates(
    Path(session_id): Path<String>,
    Json(body): Json<LiveSyncImportBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let _ = body.updates;
    log::warn!(
        target: "lexera.api.live_sync.import",
        "{}; rejecting live sync import for session {}",
        CRDT_SYNC_DISABLED_MESSAGE,
        session_id
    );
    Err(err_crdt_sync_disabled())
}

#[cfg(feature = "crdt")]
pub async fn import_live_sync_updates(
    Path(session_id): Path<String>,
    Json(body): Json<LiveSyncImportBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        body.updates.as_bytes(),
    )
    .map_err(|error| {
        let message = format!(
            "Failed to decode live sync update payload for session {}: {}",
            session_id, error
        );
        log_api_issue(
            StatusCode::BAD_REQUEST,
            "lexera.api.live_sync.import",
            &message,
        );
        err_bad_request(error.to_string())
    })?;

    let result = live_sync::import_updates(&session_id, &bytes).map_err(|error| {
        log_api_issue(
            StatusCode::BAD_REQUEST,
            "lexera.api.live_sync.import",
            format!(
                "Failed to import live sync update for session {} ({} bytes): {}",
                session_id,
                bytes.len(),
                error
            ),
        );
        err_bad_request(error)
    })?;

    Ok(Json(serde_json::json!({
        "board": result.board,
        "vv": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &result.vv),
        "changed": result.changed,
    })))
}

#[cfg(not(feature = "crdt"))]
pub async fn close_live_sync_session(
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    log::warn!(
        target: "lexera.api.live_sync.close",
        "{}; rejecting live sync close for session {}",
        CRDT_SYNC_DISABLED_MESSAGE,
        session_id
    );
    Err(err_crdt_sync_disabled())
}

#[cfg(feature = "crdt")]
pub async fn close_live_sync_session(
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let closed = live_sync::close_session(&session_id).map_err(|error| {
        log_api_issue(
            StatusCode::INTERNAL_SERVER_ERROR,
            "lexera.api.live_sync.close",
            format!("Failed to close session {}: {}", session_id, error),
        );
        err_internal(error)
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
        let error = format!("File not found: {}", body.file);
        log_api_issue(StatusCode::NOT_FOUND, "lexera.api.add_board", &error);
        return Err(err_not_found(error));
    }
    if path.extension().and_then(|e| e.to_str()) != Some("md") {
        log_api_issue(
            StatusCode::BAD_REQUEST,
            "lexera.api.add_board",
            format!(
                "Rejected board add for {}: Only .md files are supported",
                body.file
            ),
        );
        return Err(err_bad_request("Only .md files are supported"));
    }

    let board_id = state.storage.add_board(&path).map_err(|e| {
        log_api_issue(
            StatusCode::INTERNAL_SERVER_ERROR,
            "lexera.api.add_board",
            format!("Failed to add board {}: {}", body.file, e),
        );
        err_internal(e.to_string())
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
            crate::sync_watcher_include_paths(
                state.storage.as_ref(),
                watcher,
                "lexera.api.add_board",
            );
        }
    }

    // Update config and persist — must succeed for the board to survive restart
    if let Ok(mut cfg) = state.config.write() {
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
                log::error!(
                    "[lexera.api.add_board] Failed to save config after adding board {}: {}",
                    board_id,
                    e
                );
                // Roll back: remove board from in-memory storage so state stays consistent
                let _ = state.storage.remove_board(&board_id);
                return Err(err_internal(format!(
                    "Board added but config save failed: {}",
                    e
                )));
            }
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
        storage_error_response(
            e,
            "lexera.api.remove_board",
            format!("Failed to remove board {}", board_id),
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
            .read()
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
        if let Ok(mut cfg) = state.config.write() {
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
    let board = state
        .storage
        .read_board(&board_id)
        .ok_or_else(|| err_not_found(format!("Board not found: {}", board_id)))?;

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
    let mut board = state
        .storage
        .read_board(&board_id)
        .ok_or_else(|| err_not_found(format!("Board not found: {}", board_id)))?;

    // Merge incoming settings into existing (only overwrite non-None fields)
    let mut current = board.board_settings.unwrap_or_default();
    current.merge_from(incoming);
    board.board_settings = Some(current.clone());

    state.storage.write_board(&board_id, &board).map_err(|e| {
        storage_error_response(
            e,
            "lexera.api.update_board_settings",
            format!("Failed to write board settings for {}", board_id),
        )
    })?;

    if let Ok(mut watcher_guard) = state.watcher.lock() {
        if let Some(ref mut watcher) = *watcher_guard {
            crate::sync_watcher_include_paths(
                state.storage.as_ref(),
                watcher,
                "lexera.api.update_board_settings",
            );
        }
    }

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
            // Structured per-card conflicts + offered strategies so the
            // frontend can open the non-CRDT merge view and POST a
            // resolution to /boards/{id}/resolve-merge. Empty when there
            // are no conflicts (CRDT auto-merge / clean save).
            "mergeConflicts": merge_result.conflicts,
            "mergeStrategies": lexera_core::merge::resolution::MergeProposal::default_strategies(),
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
    if !CrdtSyncStorage::crdt_sync_available(state.storage.as_ref()) {
        return;
    }

    // Quick check (racy but fine -- worst case we export then find no clients)
    {
        let hub = state.sync_hub.lock().await;
        if !hub.has_clients(board_id) {
            return;
        }
    }
    // Export outside the hub lock to prevent lock ordering inversion
    let updates =
        match CrdtSyncStorage::export_crdt_updates_since(state.storage.as_ref(), board_id, &[]) {
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
    if let Ok(mut watcher_guard) = state.watcher.lock() {
        if let Some(ref mut watcher) = *watcher_guard {
            crate::sync_watcher_include_paths(state.storage.as_ref(), watcher, "lexera.api.board");
        }
    }
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

/// GET /boards/{board_id}/scan?timeframe_days=30 — scan board for upcoming items, calendar events,
/// undated sub-tasks, and tag summary.
pub async fn scan_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Query(params): Query<ScanBoardParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;

    let board = state
        .storage
        .read_board(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;

    let timeframe_days = params.timeframe_days.unwrap_or(30).min(365) as i64;
    let result = lexera_core::dashboard::scan_board_today(&board, timeframe_days);

    Ok(Json(serde_json::to_value(result).unwrap_or_default()))
}

#[derive(serde::Deserialize)]
pub struct ScanBoardParams {
    timeframe_days: Option<u32>,
}

/// POST /boards/{board_id}/gather — apply gather rules and return the moves.
///
/// Loads the board, runs the gather engine, saves the updated board, and
/// returns `{ moves: [...], moveCount: N }`.
pub async fn gather_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    validate_board_id(&board_id)?;

    let mut board = state
        .storage
        .read_board(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;

    let moves = lexera_core::gather::apply_gather_today(&mut board);
    let move_count = moves.len();

    if move_count > 0 {
        state.storage.write_board(&board_id, &board).map_err(|e| {
            storage_error_response(
                e,
                "lexera.api.gather_board",
                format!("Failed to save gathered board {}", board_id),
            )
        })?;
        emit_main_file_changed(&state, &board_id);
        broadcast_crdt_to_sync_hub(&state, &board_id).await;
    }

    Ok(Json(serde_json::json!({
        "moves": moves,
        "moveCount": move_count,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use std::collections::HashMap;
    use tower::ServiceExt;

    use crate::test_helpers::{body_json, register_test_user, test_router, test_state};

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
        let token = register_test_user(&state);
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/boards")
                    .header("authorization", format!("Bearer {}", token))
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
        let token = register_test_user(&state);
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/boards")
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {}", token))
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
        let token = register_test_user(&state);
        let board_id = state.storage.add_board(&board_path).unwrap();
        {
            let mut cfg = state.config.write().unwrap();
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
                    .header("authorization", format!("Bearer {}", token))
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
        let token = register_test_user(&state);

        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(format!("/boards/{}/columns", board_id))
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        // columns field was removed — board data is available via fullBoard only
        assert!(json.get("columns").is_none());
        let full_board = &json["fullBoard"];
        let columns = full_board["rows"][0]["stacks"][0]["columns"]
            .as_array()
            .unwrap();
        assert_eq!(columns.len(), 2);
        assert_eq!(columns[0]["title"].as_str().unwrap(), "Todo");
        assert_eq!(columns[1]["title"].as_str().unwrap(), "Done");

        let todo_cards = columns[0]["cards"].as_array().unwrap();
        assert_eq!(todo_cards.len(), 2);
    }

    #[tokio::test]
    async fn get_hierarchy_for_added_board_returns_rows_without_full_board() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "hierarchy.md", MINIMAL_BOARD);
        let state = test_state(tmp.path());
        let token = register_test_user(&state);

        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(format!("/boards/{}/hierarchy", board_id))
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let rows = json["rows"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["stacks"][0]["columns"].as_array().unwrap().len(), 2);
        assert!(json.get("fullBoard").is_none());
    }

    #[tokio::test]
    async fn get_board_changes_returns_delta_for_cached_generation_snapshot() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "changes.md", MINIMAL_BOARD);
        let state = test_state(tmp.path());
        let token = register_test_user(&state);

        let board_id = state.storage.add_board(&board_path).unwrap();
        state
            .storage
            .add_card(&board_id, 0, "Delta API card")
            .unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(format!("/boards/{}/changes?since_generation=0", board_id))
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["available"], true);
        assert!(json["delta"].is_object());
        assert!(json["generation"].as_u64().unwrap() >= 1);
    }

    #[tokio::test]
    async fn delete_board() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "del.md", MINIMAL_BOARD);
        let state = test_state(tmp.path());
        let token = register_test_user(&state);

        let board_id = state.storage.add_board(&board_path).unwrap();

        let app = test_router(state.clone());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/boards/{}", board_id))
                    .header("authorization", format!("Bearer {}", token))
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
                    .header("authorization", format!("Bearer {}", token))
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
        let token = register_test_user(&state);
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/boards/does-not-exist/columns")
                    .header("authorization", format!("Bearer {}", token))
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
        token: &str,
    ) -> (StatusCode, serde_json::Value) {
        let body = serde_json::json!({
            "baseBoard": base,
            "board": incoming,
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/boards/{}/sync-save", board_id))
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {}", token))
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
        let token = register_test_user(&state);

        // User adds a card to ColA
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns[0]
            .cards
            .push(lexera_core::types::KanbanCard {
                id: "new".into(),
                content: "new-card".into(),
                checked: false,
                kid: Some("kid-new".into()),
                params: HashMap::new(),
            });

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a_cards: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards
            .iter()
            .map(|c| c.content.as_str())
            .collect();
        assert!(
            col_a_cards.contains(&"new-card"),
            "new card should be saved"
        );
        assert!(col_a_cards.contains(&"card-a1"), "existing cards preserved");
        assert!(col_a_cards.contains(&"card-a2"), "existing cards preserved");
    }

    #[tokio::test]
    async fn resolve_merge_conflict_file_backup_keeps_ours_and_backs_up_current() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "resolve-merge.md").await;
        let token = register_test_user(&state);

        // Client draft adds a card; user chose ConflictFileBackup keeping
        // "ours" (incoming) — current is written to a conflict backup.
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns[0]
            .cards
            .push(lexera_core::types::KanbanCard {
                id: "r".into(),
                content: "resolved-card".into(),
                checked: false,
                kid: Some("kid-resolved".into()),
                params: HashMap::new(),
            });

        let body = serde_json::json!({
            "baseBoard": base,
            "incoming": incoming,
            "resolution": {
                "boardId": board_id,
                "strategy": "conflict-file-backup",
                "backupKeep": "ours",
            },
        });
        let app = test_router(state.clone());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/boards/{}/resolve-merge", board_id))
                    .header("content-type", "application/json")
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["resolved"], serde_json::Value::Bool(true));
        assert!(
            json["conflictBackupPath"].is_string(),
            "discarded side must be backed up: {json}"
        );

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards
            .iter()
            .map(|c| c.content.as_str())
            .collect();
        assert!(
            col_a.contains(&"resolved-card"),
            "kept side (ours) must be persisted: {col_a:?}"
        );
    }

    #[tokio::test]
    async fn sync_save_delete_card_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "del-card.md").await;
        let token = register_test_user(&state);

        // User removes card-a2
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns[0]
            .cards
            .retain(|c| c.content != "card-a2");

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a_cards: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards
            .iter()
            .map(|c| c.content.as_str())
            .collect();
        assert!(
            !col_a_cards.contains(&"card-a2"),
            "card-a2 should be removed"
        );
        assert!(col_a_cards.contains(&"card-a1"), "card-a1 preserved");
    }

    #[tokio::test]
    async fn sync_save_add_column_preserves_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "add-col.md").await;
        let token = register_test_user(&state);

        // User adds a new column to Stack1
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0]
            .columns
            .push(lexera_core::types::KanbanColumn {
                id: "col-new".into(),
                title: "NewCol".into(),
                cards: vec![lexera_core::types::KanbanCard {
                    id: "n".into(),
                    content: "new-col-card".into(),
                    checked: false,
                    kid: Some("kid-nc".into()),
                    params: HashMap::new(),
                }],
                include_source: None,
                params: HashMap::new(),
            });

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_titles: Vec<&str> = saved.rows[0].stacks[0]
            .columns
            .iter()
            .map(|c| c.title.as_str())
            .collect();
        assert!(col_titles.contains(&"NewCol"), "new column added");
        assert!(col_titles.contains(&"ColA"), "ColA preserved");
        assert!(col_titles.contains(&"ColB"), "ColB preserved");
    }

    #[tokio::test]
    async fn sync_save_delete_column_preserves_siblings() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "del-col.md").await;
        let token = register_test_user(&state);

        // User deletes ColB from Stack1
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0]
            .columns
            .retain(|c| c.title != "ColB");

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_titles: Vec<&str> = saved.rows[0].stacks[0]
            .columns
            .iter()
            .map(|c| c.title.as_str())
            .collect();
        assert!(!col_titles.contains(&"ColB"), "ColB removed");
        assert!(col_titles.contains(&"ColA"), "ColA preserved");
    }

    #[tokio::test]
    async fn sync_save_add_stack_preserves_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "add-stack.md").await;
        let token = register_test_user(&state);

        // User adds a new stack to Row1
        let mut incoming = base.clone();
        incoming.rows[0]
            .stacks
            .push(lexera_core::types::KanbanStack {
                id: "stack-new".into(),
                title: "NewStack".into(),
                columns: vec![lexera_core::types::KanbanColumn {
                    id: "col-ns".into(),
                    title: "NSCol".into(),
                    cards: vec![],
                    include_source: None,
                    params: HashMap::new(),
                }],
                params: HashMap::new(),
            });

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let stack_titles: Vec<&str> = saved.rows[0]
            .stacks
            .iter()
            .map(|s| s.title.as_str())
            .collect();
        assert!(stack_titles.contains(&"NewStack"), "new stack added");
        assert!(stack_titles.contains(&"Stack1"), "Stack1 preserved");
        assert!(stack_titles.contains(&"Stack2"), "Stack2 preserved");
    }

    #[tokio::test]
    async fn sync_save_delete_stack_preserves_siblings() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "del-stack.md").await;
        let token = register_test_user(&state);

        // User deletes Stack2
        let mut incoming = base.clone();
        incoming.rows[0].stacks.retain(|s| s.title != "Stack2");

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let stack_titles: Vec<&str> = saved.rows[0]
            .stacks
            .iter()
            .map(|s| s.title.as_str())
            .collect();
        assert!(!stack_titles.contains(&"Stack2"), "Stack2 removed");
        assert!(stack_titles.contains(&"Stack1"), "Stack1 preserved");
    }

    #[tokio::test]
    async fn sync_save_add_row_preserves_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "add-row.md").await;
        let token = register_test_user(&state);

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
                    params: HashMap::new(),
                }],
                params: HashMap::new(),
            }],
            params: HashMap::new(),
        });

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
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
        let token = register_test_user(&state);
        let board_id = state.storage.add_board(&board_path).unwrap();
        let base = state.storage.read_board(&board_id).unwrap();
        assert_eq!(base.rows.len(), 2);

        // User deletes RowB
        let mut incoming = base.clone();
        incoming.rows.retain(|r| r.title != "RowB");

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        assert_eq!(saved.rows.len(), 1);
        assert_eq!(saved.rows[0].title, "RowA");
    }

    #[tokio::test]
    async fn sync_save_rename_column_preserves_cards() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "rename-col.md").await;
        let token = register_test_user(&state);

        // User renames ColA -> ColA-Renamed
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns[0].title = "ColA-Renamed".into();

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
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
        let token = register_test_user(&state);

        // User moves card-a1 from ColA to ColB
        let mut incoming = base.clone();
        let card = incoming.rows[0].stacks[0].columns[0].cards.remove(0); // card-a1
        incoming.rows[0].stacks[0].columns[1].cards.push(card);

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &incoming, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a_cards: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards
            .iter()
            .map(|c| c.content.as_str())
            .collect();
        let col_b_cards: Vec<&str> = saved.rows[0].stacks[0].columns[1]
            .cards
            .iter()
            .map(|c| c.content.as_str())
            .collect();
        assert!(!col_a_cards.contains(&"card-a1"), "card-a1 moved from ColA");
        assert!(col_b_cards.contains(&"card-a1"), "card-a1 moved to ColB");
        assert!(col_b_cards.contains(&"card-b1"), "card-b1 still in ColB");
    }

    #[tokio::test]
    async fn sync_save_multiple_edits_sequential() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "multi-edit.md").await;
        let token = register_test_user(&state);

        // Edit 1: add a card
        let mut edit1 = base.clone();
        edit1.rows[0].stacks[0].columns[0]
            .cards
            .push(lexera_core::types::KanbanCard {
                id: "e1".into(),
                content: "edit1-card".into(),
                checked: false,
                kid: Some("kid-e1".into()),
                params: HashMap::new(),
            });

        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &edit1, &token).await;
        assert_eq!(status, StatusCode::OK);

        // Edit 2: read current state, then add another card
        let base2 = state.storage.read_board(&board_id).unwrap();
        let mut edit2 = base2.clone();
        edit2.rows[0].stacks[0].columns[0]
            .cards
            .push(lexera_core::types::KanbanCard {
                id: "e2".into(),
                content: "edit2-card".into(),
                checked: false,
                kid: Some("kid-e2".into()),
                params: HashMap::new(),
            });

        let app2 = test_router(state.clone());
        let (status2, _) = sync_save(app2, &board_id, &base2, &edit2, &token).await;
        assert_eq!(status2, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        let col_a_cards: Vec<&str> = saved.rows[0].stacks[0].columns[0]
            .cards
            .iter()
            .map(|c| c.content.as_str())
            .collect();
        assert!(col_a_cards.contains(&"card-a1"));
        assert!(col_a_cards.contains(&"card-a2"));
        assert!(col_a_cards.contains(&"edit1-card"));
        assert!(col_a_cards.contains(&"edit2-card"));
    }

    #[tokio::test]
    async fn sync_save_idempotent_no_change() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id, base) = add_new_format_board(tmp.path(), "idempotent.md").await;
        let token = register_test_user(&state);

        // Save the same board back (no changes)
        let app = test_router(state.clone());
        let (status, _) = sync_save(app, &board_id, &base, &base, &token).await;
        assert_eq!(status, StatusCode::OK);

        let saved = state.storage.read_board(&board_id).unwrap();
        assert_eq!(saved.rows.len(), base.rows.len());
        assert_eq!(
            saved.rows[0].stacks[0].columns[0].cards.len(),
            base.rows[0].stacks[0].columns[0].cards.len(),
        );
    }
}
