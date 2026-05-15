//! HTTP-only remote-API helpers for the sync client.
//!
//! Out-of-band (HTTP, not WebSocket) calls the sync client makes
//! against a remote backend before / alongside the live WS message
//! loop:
//!
//!   - `register_remote_user` — POST `/collab/users/register`, returns
//!     the auth token on first registration or `None` on 409 Conflict
//!     (already registered, caller falls back to the invite token).
//!   - `fetch_remote_board_snapshot` — GET `/boards/{id}/columns`,
//!     returns the full `KanbanBoard` for the initial paint before
//!     the WS stream takes over.
//!
//! Split out of `sync_client.rs` so the synchronous bootstrap surface
//! is separate from the long-running WS handler.

use lexera_core::types::KanbanBoard;
use serde::Deserialize;

use super::friendly_error;

/// Typed error for the two HTTP remote-API helpers below. Display impls
/// reproduce the prior `format!()` wire strings byte-for-byte so the
/// existing callers (which stringify via `{}`) remain behaviourally
/// identical. Variants are kept matchable so future call-site refactors
/// can pattern-match on Http {status, ..} or Parse(..) without parsing
/// log strings. The Request variant pre-stringifies via friendly_error
/// because reqwest::Error isn't Clone and friendly_error's rich shaping
/// (connect / timeout / status-mapped) is already lossy — preserving the
/// typed source there would need a larger refactor of friendly_error
/// itself.
#[derive(Debug, thiserror::Error)]
pub(crate) enum RemoteApiError {
    #[error("{0}")]
    Request(String),
    // status is reqwest::StatusCode so its Display reproduces the prior
    // `format!("{}", status)` shape — "404 Not Found" with canonical
    // reason phrase, NOT bare "404". Switching to u16 would silently
    // drop the reason phrase from log output.
    #[error("{context} failed (HTTP {status}): {body}")]
    Http {
        context: &'static str,
        status: reqwest::StatusCode,
        body: String,
    },
    // source is reqwest::Error (not serde_json::Error) because
    // reqwest::Response::json() returns its own Error wrapping the
    // underlying serde failure; preserving that matches the prior
    // `format!("Parse initial board response: {}", e)` wire shape.
    #[error("Parse {context}: {source}")]
    Parse {
        context: &'static str,
        #[source]
        source: reqwest::Error,
    },
}

impl RemoteApiError {
    fn request(context: &str, err: reqwest::Error) -> Self {
        Self::Request(friendly_error(context, err))
    }
}

// Lets the `?` operator inside Tauri/HTTP-bound callers keep their
// existing `Result<_, String>` outer signatures unchanged — same
// boundary pattern used by CaptureGeometryError (Slice 5).
impl From<RemoteApiError> for String {
    fn from(err: RemoteApiError) -> String {
        err.to_string()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteBoardColumnsResponse {
    full_board: KanbanBoard,
}

/// Register the local user on the remote server.
/// Returns the auth token on successful registration, or `None` if the user
/// already exists (409). The caller should fall back to the token returned
/// by `accept_invite` in that case.
pub(super) async fn register_remote_user(
    client: &reqwest::Client,
    server_url: &str,
    user_id: &str,
    user_name: &str,
) -> Result<Option<String>, RemoteApiError> {
    let register_body = serde_json::json!({
        "id": user_id,
        "name": user_name,
    });
    let register_resp = client
        .post(format!("{}/collab/users/register", server_url))
        .json(&register_body)
        .send()
        .await
        .map_err(|e| RemoteApiError::request("User registration", e))?;

    let status = register_resp.status();
    if status.is_success() {
        // Extract auth token from successful registration
        let body: serde_json::Value = register_resp
            .json()
            .await
            .unwrap_or(serde_json::Value::Null);
        let token = body["token"].as_str().map(String::from);
        if token.is_some() {
            log::info!(
                "[sync_client] Registered on remote server {} and received auth token",
                server_url
            );
        }
        return Ok(token);
    }

    if status.as_u16() == 409 {
        // Already registered — no token available from register
        log::info!(
            "[sync_client] User {} already registered on {}, will get token from accept_invite",
            user_id,
            server_url
        );
        return Ok(None);
    }

    let body = register_resp.text().await.unwrap_or_default();
    log::warn!(
        "[sync_client] User registration returned unexpected status {} from {}: {}",
        status,
        server_url,
        body
    );
    Ok(None)
}

pub(super) async fn fetch_remote_board_snapshot(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
) -> Result<KanbanBoard, RemoteApiError> {
    log::info!(
        "[sync_client] Fetching initial board snapshot remote_board_id={} server={}",
        remote_board_id,
        server_url
    );
    let mut req = client.get(format!("{}/boards/{}/columns", server_url, remote_board_id));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let board_resp = req
        .send()
        .await
        .map_err(|e| RemoteApiError::request("Initial board fetch", e))?;

    if !board_resp.status().is_success() {
        let status = board_resp.status();
        let body = board_resp.text().await.unwrap_or_default();
        return Err(RemoteApiError::Http {
            context: "Initial board fetch",
            status,
            body,
        });
    }

    let initial_board = board_resp
        .json::<RemoteBoardColumnsResponse>()
        .await
        .map_err(|source| RemoteApiError::Parse {
            context: "initial board response",
            source,
        })?
        .full_board;
    log::info!(
        "[sync_client] Initial snapshot loaded remote_board_id={} title={} cards={}",
        remote_board_id,
        initial_board.title,
        initial_board
            .all_columns()
            .iter()
            .map(|col| col.cards.len())
            .sum::<usize>()
    );
    Ok(initial_board)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_api_error_request_variant_wraps_friendly_error_output() {
        // The Request variant pre-stringifies via friendly_error so its
        // Display is just the stored string verbatim. We can't easily
        // synthesize a reqwest::Error in tests (no public constructor),
        // but we can verify the Display passthrough by constructing the
        // variant directly with the same string friendly_error would
        // produce.
        let err = RemoteApiError::Request(
            "User registration: Could not connect to server (is it running and accessible on the network?)"
                .into(),
        );
        assert_eq!(
            err.to_string(),
            "User registration: Could not connect to server (is it running and accessible on the network?)"
        );
    }

    #[test]
    fn remote_api_error_http_variant_preserves_status_with_reason_phrase() {
        // Prior wire format: format!("Initial board fetch failed (HTTP {}): {}", status, text)
        // where {status} is a reqwest::StatusCode whose Display emits
        // "404 Not Found" (the canonical reason phrase, not bare "404").
        // The typed variant must reproduce that exactly.
        let err = RemoteApiError::Http {
            context: "Initial board fetch",
            status: reqwest::StatusCode::NOT_FOUND,
            body: "board missing".into(),
        };
        assert_eq!(
            err.to_string(),
            "Initial board fetch failed (HTTP 404 Not Found): board missing"
        );

        // Same shape for a 5xx case.
        let err500 = RemoteApiError::Http {
            context: "Initial board fetch",
            status: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            body: "boom".into(),
        };
        assert_eq!(
            err500.to_string(),
            "Initial board fetch failed (HTTP 500 Internal Server Error): boom"
        );
    }

    #[test]
    fn from_remote_api_error_for_string_uses_display() {
        let err = RemoteApiError::Request("any text".into());
        let s: String = err.into();
        assert_eq!(s, "any text");
    }
}
