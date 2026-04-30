use axum::{
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::get,
    Router,
};
use serde::Serialize;

pub(crate) mod auth_middleware;
mod board;
mod calendar;
mod capture_api;
mod config_api;
mod dashboard;
mod diagnostics;
mod events;
mod external_embed;
mod file_ops;
mod live_sync;
mod media;
pub(crate) mod rate_limit;
mod registry;
mod search;
mod template;

use crate::state::AppState;
use auth_middleware::require_auth_middleware;
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
///   GET  /boards/:boardId/hierarchy           -> lightweight row/stack/column/card tree (+ ETag)
///   GET  /boards/:boardId/changes?since_generation=N -> structural delta from cached generation
///   GET  /boards/:boardId/columns             -> full column data with cards (+ ETag)
///   POST /boards/:boardId/columns/:colIndex/cards -> add card
///   POST /boards/:boardId/media               -> upload media file
///   GET  /boards/:boardId/media-manifest      -> list media files with SHA-256 hashes
///   GET  /boards/:boardId/media/:filename     -> serve media file
///   GET  /media/workspace-index               -> all media files across all boards
///   GET  /registry                            -> board registry (sorted entries)
///   POST /registry/boards/:boardId/access     -> record board access
///   PUT  /registry/boards/order               -> reorder boards
///   PUT  /registry/boards/:boardId/pin        -> set pinned state
///   PUT  /registry/boards/:boardId/label      -> set custom label
///   GET  /registry/searches                   -> search history
///   POST /registry/searches                   -> add search entry
///   DELETE /registry/searches/:query          -> remove search entry
///   PUT  /registry/searches/:query/pin        -> toggle pin state
///   GET  /boards/:boardId/file?path=...       -> serve any file relative to board dir
///   GET  /boards/:boardId/file-info?path=...  -> file metadata (size, type, etc.)
///   POST /boards/:boardId/find-file            -> search for files by name in board dir
///   POST /boards/:boardId/convert-path        -> convert relative<->absolute path in card
///   POST /search/files                          -> search files across boards
///   GET  /search?q=term                       -> search cards
///   GET  /calendar/tasks                      -> all cards with due dates
///   POST /dashboard/data                      -> dashboard query/todos/tags/calendar snapshot
///   GET  /config/theme                        -> current theme ID
///   PUT  /config/theme                        -> update theme ID
///   GET  /config/render-apps                  -> render application paths
///   PUT  /config/render-apps                  -> update render application paths
///   GET  /events                              -> SSE stream of board changes
///   GET  /status                              -> health check (+ incoming config)
///   GET  /diagnostics/disk                    -> disk usage and write-loop diagnostics
///   POST /test-results                        -> write local frontend test runner output
///   GET  /templates                           -> list available templates
///   GET  /templates/:id                       -> full template content + extra files
///   POST /templates/:id/copy                  -> copy template files with variable substitution
///   GET  /capture/history                     -> quick-capture / clipboard history
///   DELETE /capture/history/:id              -> remove one quick-capture / clipboard history entry
pub fn api_router(state: &AppState) -> Router<AppState> {
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
        .route("/search/files", axum::routing::post(file_ops::search_files))
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

    // Authenticated routes — require valid bearer token
    let authed_routes = Router::new()
        .route(
            "/boards",
            get(board::list_boards).post(board::add_board_endpoint),
        )
        .route(
            "/dashboard/data",
            axum::routing::post(dashboard::dashboard_data),
        )
        .route("/remote-boards", get(board::list_remote_boards))
        .route(
            "/boards/{board_id}/hierarchy",
            get(board::get_board_hierarchy),
        )
        .route("/boards/{board_id}/changes", get(board::get_board_changes))
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
            "/boards/{board_id}/gather",
            axum::routing::post(board::gather_board),
        )
        .route("/boards/{board_id}/scan", get(board::scan_board))
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
            "/boards/{board_id}/media-manifest",
            get(media::media_manifest),
        )
        .route(
            "/boards/{board_id}/media/{filename}",
            get(media::serve_media),
        )
        .route("/media/workspace-index", get(media::workspace_media_index))
        // ── Registry ────────────────────────────────────────────────────────
        .route("/registry", get(registry::get_registry))
        .route(
            "/registry/boards/{board_id}/access",
            axum::routing::post(registry::record_board_access),
        )
        .route(
            "/registry/boards/order",
            axum::routing::put(registry::reorder_boards),
        )
        .route(
            "/registry/boards/{board_id}/pin",
            axum::routing::put(registry::set_board_pinned),
        )
        .route(
            "/registry/boards/{board_id}/label",
            axum::routing::put(registry::set_board_label),
        )
        .route(
            "/registry/searches",
            get(registry::get_searches).post(registry::add_search),
        )
        .route(
            "/registry/searches/{query}",
            axum::routing::delete(registry::remove_search),
        )
        .route(
            "/registry/searches/{query}/pin",
            axum::routing::put(registry::toggle_search_pin),
        )
        .route("/boards/{board_id}/file", get(file_ops::serve_file))
        .route("/boards/{board_id}/file-info", get(file_ops::file_info))
        .route(
            "/boards/{board_id}/file-info-batch",
            axum::routing::post(file_ops::file_info_batch),
        )
        .route(
            "/boards/{board_id}/convert-path",
            axum::routing::post(file_ops::convert_path),
        )
        .route("/calendar/tasks", get(calendar::calendar_tasks))
        .route("/events", get(events::sse_events))
        .route(
            "/config/theme",
            get(config_api::get_theme).put(config_api::set_theme),
        )
        .route(
            "/config/global-sync",
            get(config_api::get_global_sync).put(config_api::update_global_sync),
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
        .route(
            "/config/render-apps",
            get(config_api::get_render_apps).put(config_api::set_render_apps),
        )
        .route(
            "/config/dashboard-tags",
            get(config_api::get_dashboard_tags).put(config_api::set_dashboard_tags),
        )
        .route(
            "/config/settings",
            get(config_api::get_settings).put(config_api::set_settings),
        )
        .route("/capture/history", get(capture_api::list_capture_history))
        .route(
            "/capture/history/{id}",
            axum::routing::delete(capture_api::delete_capture_history_entry),
        )
        .merge(search_routes)
        .merge(find_file_routes)
        .merge(template_copy_routes)
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            require_auth_middleware,
        ));

    // Unauthenticated routes — health check, templates, logs, diagnostics, external embeds
    Router::new()
        .route("/status", get(events::status))
        .route("/diagnostics/disk", get(diagnostics::disk_diagnostics))
        .route(
            "/test-results",
            axum::routing::post(diagnostics::write_test_results),
        )
        .route(
            "/open-connection-window",
            axum::routing::post(events::open_connection_window),
        )
        .route("/templates", get(template::list_templates))
        .route("/templates/{template_id}", get(template::get_template))
        .route("/logs", get(events::list_logs))
        .route("/logs/stream", get(events::stream_logs))
        .route(
            "/external-embeds/probe",
            get(external_embed::probe_external_embed),
        )
        // Export routes (presentation / document / filter / transform).
        //
        // These are currently unauthenticated to match the kanban frontend's
        // `exportService.js`, which issues raw `fetch` without a Bearer token.
        // Threat surface is limited because the backend binds to localhost
        // only and CORS is restricted to localhost origins. Move these into
        // the authed group once `exportService.js` routes through the
        // `LexeraApi` wrapper (which attaches the Bearer token automatically).
        .merge(crate::export_api::export_router())
        .merge(authed_routes)
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
        return Err(err_bad_request(format!(
            "Board ID too long (max {} characters)",
            MAX_BOARD_ID_LENGTH
        )));
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
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse { error: msg.into() }),
    )
}

/// Convenience constructor for a BAD_REQUEST error response.
pub(crate) fn err_bad_request(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse { error: msg.into() }),
    )
}

/// Convenience constructor for an INTERNAL_SERVER_ERROR error response.
pub(crate) fn err_internal(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse { error: msg.into() }),
    )
}

/// Convenience constructor for a FORBIDDEN error response.
pub(crate) fn err_forbidden(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::FORBIDDEN,
        Json(ErrorResponse { error: msg.into() }),
    )
}

/// Resolve a file path relative to the board's directory, or as absolute if it starts with /.
///
/// Access policy: the canonical path must be within one of the allowed roots.
/// An allowed root is either
///   (a) the owning board's parent directory, OR
///   (b) the grandparent directory of ANY registered board
/// (b) lets a board reference shared media/include folders living as siblings
/// of the board's folder — a common layout where boards and shared assets live
/// side-by-side under a workspace root. Attempts to escape beyond any board's
/// grandparent (e.g. to `/etc/passwd`, another user's home, etc.) are still
/// rejected with FORBIDDEN and logged under `lexera.api.file`.
pub(crate) fn resolve_board_file(
    state: &AppState,
    board_id: &str,
    file_path: &str,
) -> Result<std::path::PathBuf, (StatusCode, Json<ErrorResponse>)> {
    use lexera_core::storage::BoardStorage as _;

    let board_path = state
        .storage
        .get_board_path(board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));

    let path = std::path::Path::new(file_path);
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        board_dir.join(file_path)
    };

    let canonical = resolved
        .canonicalize()
        .map_err(|_| err_not_found("File not found"))?;

    // Build allowed roots: owning board's parent + every registered board's
    // grandparent. Canonicalize each; skip any that can't be resolved.
    let mut allowed_roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(dir) = board_dir.canonicalize() {
        allowed_roots.push(dir);
    }
    for info in state.storage.list_boards() {
        if let Some(bpath) = state.storage.get_board_path(&info.id) {
            if let Some(parent) = bpath.parent() {
                if let Some(grandparent) = parent.parent() {
                    if let Ok(canon) = grandparent.canonicalize() {
                        if !allowed_roots.contains(&canon) {
                            allowed_roots.push(canon);
                        }
                    }
                }
            }
        }
    }

    let within_allowed = allowed_roots.iter().any(|root| canonical.starts_with(root));
    if !within_allowed {
        log::warn!(
            target: "lexera.api.file",
            "Blocked path traversal attempt: {} resolved to {} (outside every board's grandparent)",
            file_path,
            canonical.display()
        );
        return Err(err_forbidden(
            "Access denied: path is outside the workspace",
        ));
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
