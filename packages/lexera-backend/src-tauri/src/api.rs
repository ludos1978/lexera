/// Axum REST API routes.
///
///   GET  /boards                              -> list all boards
///   GET  /boards/:boardId/columns             -> full column data with cards (+ ETag)
///   POST /boards/:boardId/columns/:colIndex/cards -> add card
///   POST /boards/:boardId/media               -> upload media file
///   GET  /search?q=term                       -> search cards
///   GET  /events                              -> SSE stream of board changes
///   GET  /status                              -> health check (+ incoming config)

use std::convert::Infallible;
use std::path::PathBuf;
use axum::{
    Router,
    extract::{Path, Query, State, Multipart},
    http::{HeaderMap, StatusCode},
    response::{Json, Sse, sse::Event},
    routing::get,
};
use serde::{Deserialize, Serialize};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use lexera_core::storage::BoardStorage;
use lexera_core::types::is_archived_or_deleted;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    q: Option<String>,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    error: String,
}

#[derive(Deserialize)]
pub struct AddCardBody {
    content: String,
}

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/boards", get(list_boards))
        .route("/boards/{board_id}/columns", get(get_board_columns))
        .route(
            "/boards/{board_id}/columns/{col_index}/cards",
            axum::routing::post(add_card),
        )
        .route("/boards/{board_id}", axum::routing::put(write_board))
        .route(
            "/boards/{board_id}/media",
            axum::routing::post(upload_media),
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
                resp_headers.insert("etag", etag.parse().unwrap());
                return Ok((StatusCode::NOT_MODIFIED, resp_headers, Json(serde_json::json!({}))));
            }
        }
    }

    let columns: Vec<serde_json::Value> = board
        .columns
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
    resp_headers.insert("etag", etag.parse().unwrap());

    Ok((
        StatusCode::OK,
        resp_headers,
        Json(serde_json::json!({
            "boardId": board_id,
            "title": board.title,
            "columns": columns,
            "version": version,
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

    state.storage.add_card(&board_id, col_index, &body.content).map_err(|e| {
        let status = match &e {
            lexera_core::storage::StorageError::BoardNotFound(_) => StatusCode::NOT_FOUND,
            lexera_core::storage::StorageError::ColumnOutOfRange { .. } => StatusCode::BAD_REQUEST,
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
            Ok(Json(serde_json::json!({ "success": true, "merged": false })))
        }
        Ok(Some(merge_result)) => {
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
            Err((status, Json(ErrorResponse { error: e.to_string() })))
        }
    }
}

async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> Json<serde_json::Value> {
    let query = params.q.unwrap_or_default();
    let results = state.storage.search(&query);
    Json(serde_json::json!({ "query": query, "results": results }))
}

/// SSE endpoint: streams BoardChangeEvent as JSON to connected clients.
async fn sse_events(
    State(state): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = state.event_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| {
        match result {
            Ok(event) => {
                let json = serde_json::to_string(&event).unwrap_or_default();
                Some(Ok(Event::default().data(json)))
            }
            Err(_) => None,
        }
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
    let board_dir = board_path.parent().unwrap_or_else(|| std::path::Path::new("."));
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

    let filename = field
        .file_name()
        .unwrap_or("capture")
        .to_string();
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
