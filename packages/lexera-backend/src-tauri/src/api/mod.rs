use axum::{
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::get,
    Router,
};
use serde::Serialize;

mod board;
mod capture_api;
mod config_api;
mod events;
mod external_embed;
mod file_ops;
mod live_sync;
mod media;
mod rate_limit;
mod search;
mod template;

use crate::state::AppState;
use rate_limit::{rate_limit_middleware, RateLimiter};

/// Maximum allowed length for a board ID (path segment safety).
const MAX_BOARD_ID_LENGTH: usize = 256;
/// Rate limit for the search endpoint (requests per second).
const SEARCH_RATE_LIMIT: usize = 10;
/// Rate limit for the find-file endpoint (requests per second).
const FIND_FILE_RATE_LIMIT: usize = 5;
/// Rate limit for the template copy endpoint (requests per second).
const TEMPLATE_COPY_RATE_LIMIT: usize = 2;

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
///   POST /search/files                          -> search files across boards
///   GET  /search?q=term                       -> search cards
///   GET  /config/theme                        -> current theme ID
///   PUT  /config/theme                        -> update theme ID
///   GET  /events                              -> SSE stream of board changes
///   GET  /status                              -> health check (+ incoming config)
///   GET  /templates                           -> list available templates
///   GET  /templates/:id                       -> full template content + extra files
///   POST /templates/:id/copy                  -> copy template files with variable substitution
///   GET  /capture/history                     -> quick-capture / clipboard history
///   DELETE /capture/history/:id              -> remove one quick-capture / clipboard history entry
pub fn api_router() -> Router<AppState> {
    // Rate-limited sub-routers for expensive endpoints (requests per second)
    let search_routes = Router::new()
        .route("/search", get(search::search))
        .route_layer(axum::middleware::from_fn_with_state(
            RateLimiter::new(SEARCH_RATE_LIMIT),
            rate_limit_middleware,
        ));

    let find_file_routes = Router::new()
        .route(
            "/boards/{board_id}/find-file",
            axum::routing::post(file_ops::find_file),
        )
        .route(
            "/search/files",
            axum::routing::post(file_ops::search_files),
        )
        .route_layer(axum::middleware::from_fn_with_state(
            RateLimiter::new(FIND_FILE_RATE_LIMIT),
            rate_limit_middleware,
        ));

    let template_copy_routes = Router::new()
        .route(
            "/templates/{template_id}/copy",
            axum::routing::post(template::copy_template_files),
        )
        .route_layer(axum::middleware::from_fn_with_state(
            RateLimiter::new(TEMPLATE_COPY_RATE_LIMIT),
            rate_limit_middleware,
        ));

    // All other routes without rate limiting
    Router::new()
        .route(
            "/boards",
            get(board::list_boards).post(board::add_board_endpoint),
        )
        .route("/remote-boards", get(board::list_remote_boards))
        .route("/boards/{board_id}/columns", get(board::get_board_columns))
        .route(
            "/boards/{board_id}/columns/{col_index}/cards",
            axum::routing::post(board::add_card),
        )
        .route(
            "/boards/{board_id}/cards/{card_id}/append",
            axum::routing::post(board::append_to_card),
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
            "/boards/{board_id}/crashsave",
            axum::routing::post(board::create_board_crashsave),
        )
        .route(
            "/boards/{board_id}/rebase",
            axum::routing::post(board::rebase_board_with_base),
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
        .route(
            "/boards/{board_id}/media/{filename}",
            get(media::serve_media),
        )
        .route("/boards/{board_id}/file", get(file_ops::serve_file))
        .route("/boards/{board_id}/file-info", get(file_ops::file_info))
        .route(
            "/boards/{board_id}/convert-path",
            axum::routing::post(file_ops::convert_path),
        )
        .route("/logs", get(events::list_logs))
        .route("/logs/stream", get(events::stream_logs))
        .route("/events", get(events::sse_events))
        .route(
            "/external-embeds/probe",
            get(external_embed::probe_external_embed),
        )
        .route(
            "/config/theme",
            get(config_api::get_theme).put(config_api::set_theme),
        )
        .route(
            "/config/workspaces",
            get(config_api::list_workspaces).post(config_api::create_workspace),
        )
        .route(
            "/config/workspaces/{id}",
            axum::routing::put(config_api::update_workspace).delete(config_api::delete_workspace),
        )
        .route(
            "/config/workspaces/{id}/sync",
            axum::routing::put(config_api::update_workspace_sync),
        )
        .route(
            "/config/workspaces/{id}/appearance",
            axum::routing::put(config_api::update_workspace_appearance),
        )
        .route(
            "/config/default-workspace",
            axum::routing::put(config_api::set_default_workspace),
        )
        .route(
            "/config/boards/{board_id}/workspaces",
            axum::routing::put(config_api::assign_board_workspaces),
        )
        .route(
            "/config/boards/{board_id}/sync",
            axum::routing::put(config_api::update_board_sync),
        )
        .route("/status", get(events::status))
        .route(
            "/open-connection-window",
            axum::routing::post(events::open_connection_window),
        )
        .route("/templates", get(template::list_templates))
        .route("/templates/{template_id}", get(template::get_template))
        .route("/capture/history", get(capture_api::list_capture_history))
        .route(
            "/capture/history/{id}",
            axum::routing::delete(capture_api::delete_capture_history_entry),
        )
        .merge(search_routes)
        .merge(find_file_routes)
        .merge(template_copy_routes)
}

// ── Shared types and helpers used across sub-modules ────────────────────

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

fn validate_board_id(id: &str) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if id.is_empty() {
        log::warn!(target: "lexera.api.validate", "Rejected empty board ID");
        return Err(err_bad_request("Board ID must not be empty"));
    }
    if id.len() > MAX_BOARD_ID_LENGTH {
        log::warn!(target: "lexera.api.validate", "Rejected board ID exceeding {} chars (len={})", MAX_BOARD_ID_LENGTH, id.len());
        return Err(err_bad_request(format!("Board ID too long (max {} characters)", MAX_BOARD_ID_LENGTH)));
    }
    if has_path_traversal(id) {
        log::warn!(target: "lexera.api.validate", "Rejected board ID with path traversal characters: {}", id);
        return Err(err_bad_request("Board ID contains invalid characters"));
    }
    Ok(())
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

/// Convenience constructor for a NOT_FOUND error response.
pub(crate) fn err_not_found(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (StatusCode::NOT_FOUND, Json(ErrorResponse { error: msg.into() }))
}

/// Convenience constructor for a BAD_REQUEST error response.
pub(crate) fn err_bad_request(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: msg.into() }))
}

/// Convenience constructor for an INTERNAL_SERVER_ERROR error response.
pub(crate) fn err_internal(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: msg.into() }))
}

/// Convenience constructor for a FORBIDDEN error response.
pub(crate) fn err_forbidden(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (StatusCode::FORBIDDEN, Json(ErrorResponse { error: msg.into() }))
}

/// Resolve a file path relative to the board's directory, or as absolute if it starts with /.
/// For absolute paths, verifies the resolved path is within the board directory.
/// Returns the canonicalized path on success, or a NOT_FOUND/FORBIDDEN error response.
fn resolve_board_file(
    state: &AppState,
    board_id: &str,
    file_path: &str,
) -> Result<std::path::PathBuf, (StatusCode, Json<ErrorResponse>)> {
    let board_path = state.storage.get_board_path(board_id).ok_or_else(|| {
        err_not_found("Board not found")
    })?;
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));

    let path = std::path::Path::new(file_path);
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        board_dir.join(file_path)
    };

    let canonical = resolved.canonicalize().map_err(|_| {
        err_not_found("File not found")
    })?;

    // Verify the resolved path is within the board directory to prevent path traversal.
    let canonical_board_dir = board_dir.canonicalize().map_err(|_| {
        err_not_found("Board directory not found")
    })?;
    if !canonical.starts_with(&canonical_board_dir) {
        log::warn!(
            target: "lexera.api.file",
            "Blocked path traversal attempt: {} resolved to {} (outside {})",
            file_path,
            canonical.display(),
            canonical_board_dir.display()
        );
        return Err(err_forbidden("Access denied: path is outside the board directory"));
    }

    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    // ── validate_board_id ───────────────────────────────────────────────

    #[test]
    fn validate_board_id_rejects_empty() {
        let result = validate_board_id("");
        assert!(result.is_err());
        let (status, body) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            body.error.contains("empty"),
            "error should mention empty: {}",
            body.error
        );
    }

    #[test]
    fn validate_board_id_rejects_overlength() {
        let long_id = "a".repeat(257);
        let result = validate_board_id(&long_id);
        assert!(result.is_err());
        let (status, body) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            body.error.contains("long"),
            "error should mention length: {}",
            body.error
        );
    }

    #[test]
    fn validate_board_id_accepts_max_length() {
        let id = "b".repeat(256);
        assert!(
            validate_board_id(&id).is_ok(),
            "256-char ID should be accepted"
        );
    }

    #[test]
    fn validate_board_id_rejects_dot_dot() {
        let result = validate_board_id("foo..bar");
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn validate_board_id_rejects_forward_slash() {
        let result = validate_board_id("foo/bar");
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn validate_board_id_rejects_backslash() {
        let result = validate_board_id("foo\\bar");
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn validate_board_id_accepts_normal_id() {
        assert!(validate_board_id("my-board-123").is_ok());
    }

    #[test]
    fn validate_board_id_accepts_single_char() {
        assert!(validate_board_id("x").is_ok());
    }

    // ── has_path_traversal ──────────────────────────────────────────────

    #[test]
    fn has_path_traversal_detects_raw_dot_dot() {
        assert!(has_path_traversal(".."));
        assert!(has_path_traversal("foo/../bar"));
        assert!(has_path_traversal("../etc/passwd"));
    }

    #[test]
    fn has_path_traversal_detects_forward_slash() {
        assert!(has_path_traversal("foo/bar"));
        assert!(has_path_traversal("/absolute"));
    }

    #[test]
    fn has_path_traversal_detects_backslash() {
        assert!(has_path_traversal("foo\\bar"));
        assert!(has_path_traversal("\\\\server\\share"));
    }

    #[test]
    fn has_path_traversal_detects_percent_encoded_dot_dot() {
        // %2e = '.', so %2e%2e = '..'
        assert!(
            has_path_traversal("%2e%2e"),
            "percent-encoded '..' should be detected"
        );
        assert!(
            has_path_traversal("foo%2f%2e%2e%2fbar"),
            "percent-encoded '/../' should be detected"
        );
    }

    #[test]
    fn has_path_traversal_detects_percent_encoded_slash() {
        // %2f = '/'
        assert!(
            has_path_traversal("foo%2fbar"),
            "percent-encoded '/' should be detected"
        );
    }

    #[test]
    fn has_path_traversal_allows_safe_paths() {
        assert!(!has_path_traversal("my-board-123"));
        assert!(!has_path_traversal("board_name"));
        assert!(!has_path_traversal("board.name")); // single dot is fine
        assert!(!has_path_traversal("a-b-c-d"));
        assert!(!has_path_traversal("BOARD-2024"));
    }

    // ── insert_header_safe ──────────────────────────────────────────────

    #[test]
    fn insert_header_safe_valid_value() {
        let mut headers = HeaderMap::new();
        insert_header_safe(&mut headers, "x-custom", "hello");
        assert_eq!(
            headers.get("x-custom").map(|v| v.to_str().unwrap()),
            Some("hello")
        );
    }

    #[test]
    fn insert_header_safe_multiple_values() {
        let mut headers = HeaderMap::new();
        insert_header_safe(&mut headers, "content-type", "application/json");
        insert_header_safe(&mut headers, "x-request-id", "abc-123");
        assert_eq!(
            headers.get("content-type").map(|v| v.to_str().unwrap()),
            Some("application/json")
        );
        assert_eq!(
            headers.get("x-request-id").map(|v| v.to_str().unwrap()),
            Some("abc-123")
        );
    }

    #[test]
    fn insert_header_safe_invalid_value_does_not_panic() {
        let mut headers = HeaderMap::new();
        // Header values cannot contain newlines or certain control characters
        insert_header_safe(&mut headers, "x-bad", "line1\nline2");
        assert!(
            headers.get("x-bad").is_none(),
            "invalid header value should not be inserted"
        );
    }

    #[test]
    fn insert_header_safe_empty_value_succeeds() {
        let mut headers = HeaderMap::new();
        insert_header_safe(&mut headers, "x-empty", "");
        assert_eq!(
            headers.get("x-empty").map(|v| v.to_str().unwrap()),
            Some("")
        );
    }
}
