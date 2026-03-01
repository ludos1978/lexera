use axum::{
    http::{HeaderMap, StatusCode},
    routing::get,
    Router,
};
use serde::Serialize;

mod board;
mod events;
mod file_ops;
mod live_sync;
mod media;
mod search;
mod template;

use crate::state::AppState;

/// Axum REST API routes.
///
///   GET  /boards                              -> list all boards
///   POST /boards                              -> add board by file path
///   DELETE /boards/:boardId                   -> remove board from tracking
///   GET  /boards/:boardId/settings            -> read board settings only
///   PUT  /boards/:boardId/settings            -> update board settings only (merge)
///   GET  /boards/:boardId/columns             -> full column data with cards (+ ETag)
///   POST /boards/:boardId/columns/:colIndex/cards -> add card
///   POST /boards/:boardId/media               -> upload media file
///   GET  /boards/:boardId/media/:filename     -> serve media file
///   GET  /boards/:boardId/file?path=...       -> serve any file relative to board dir
///   GET  /boards/:boardId/file-info?path=...  -> file metadata (size, type, etc.)
///   POST /boards/:boardId/find-file            -> search for files by name in board dir
///   POST /boards/:boardId/convert-path        -> convert relative<->absolute path in card
///   GET  /search?q=term                       -> search cards
///   GET  /events                              -> SSE stream of board changes
///   GET  /status                              -> health check (+ incoming config)
///   GET  /templates                           -> list available templates
///   GET  /templates/:id                       -> full template content + extra files
///   POST /templates/:id/copy                  -> copy template files with variable substitution
pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/boards", get(board::list_boards).post(board::add_board_endpoint))
        .route("/remote-boards", get(board::list_remote_boards))
        .route("/boards/{board_id}/columns", get(board::get_board_columns))
        .route(
            "/boards/{board_id}/columns/{col_index}/cards",
            axum::routing::post(board::add_card),
        )
        .route(
            "/boards/{board_id}",
            axum::routing::put(board::write_board).delete(board::remove_board_endpoint),
        )
        .route(
            "/boards/{board_id}/settings",
            get(board::get_board_settings).put(board::update_board_settings),
        )
        .route(
            "/boards/{board_id}/sync-save",
            axum::routing::post(board::write_board_with_base),
        )
        .route(
            "/boards/{board_id}/live-sync/open",
            axum::routing::post(board::open_live_sync_session),
        )
        .route(
            "/live-sync/{session_id}/apply",
            axum::routing::post(board::apply_live_sync_board),
        )
        .route(
            "/live-sync/{session_id}/import",
            axum::routing::post(board::import_live_sync_updates),
        )
        .route(
            "/live-sync/{session_id}",
            axum::routing::delete(board::close_live_sync_session),
        )
        .route(
            "/boards/{board_id}/media",
            axum::routing::post(media::upload_media),
        )
        .route("/boards/{board_id}/media/{filename}", get(media::serve_media))
        .route("/boards/{board_id}/file", get(file_ops::serve_file))
        .route("/boards/{board_id}/file-info", get(file_ops::file_info))
        .route(
            "/boards/{board_id}/find-file",
            axum::routing::post(file_ops::find_file),
        )
        .route(
            "/boards/{board_id}/convert-path",
            axum::routing::post(file_ops::convert_path),
        )
        .route("/search", get(search::search))
        .route("/logs", get(events::list_logs))
        .route("/logs/stream", get(events::stream_logs))
        .route("/events", get(events::sse_events))
        .route("/status", get(events::status))
        .route(
            "/open-connection-window",
            axum::routing::post(events::open_connection_window),
        )
        .route("/templates", get(template::list_templates))
        .route("/templates/{template_id}", get(template::get_template))
        .route(
            "/templates/{template_id}/copy",
            axum::routing::post(template::copy_template_files),
        )
}

// ── Shared types and helpers used across sub-modules ────────────────────

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

/// Check if a user-supplied path segment contains path traversal sequences.
/// Percent-decodes the input first, then checks the decoded string for:
/// "..", "/", "\", "./" prefix, and "/./" in path.
fn has_path_traversal(input: &str) -> bool {
    use percent_encoding::percent_decode_str;
    let decoded = percent_decode_str(input).decode_utf8_lossy();
    decoded.contains("..")
        || decoded.contains('/')
        || decoded.contains('\\')
        || decoded.starts_with("./")
        || decoded.contains("/./")
}

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

fn log_api_issue(status: StatusCode, target: &'static str, message: impl AsRef<str>) {
    let message = message.as_ref();
    if status.is_server_error() {
        log::error!(target: target, "{}", message);
    } else {
        log::warn!(target: target, "{}", message);
    }
}
