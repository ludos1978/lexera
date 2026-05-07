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
) -> Result<Option<String>, String> {
    let register_body = serde_json::json!({
        "id": user_id,
        "name": user_name,
    });
    let register_resp = client
        .post(format!("{}/collab/users/register", server_url))
        .json(&register_body)
        .send()
        .await
        .map_err(|e| friendly_error("User registration", e))?;

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
) -> Result<KanbanBoard, String> {
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
        .map_err(|e| friendly_error("Initial board fetch", e))?;

    if !board_resp.status().is_success() {
        let status = board_resp.status();
        let text = board_resp.text().await.unwrap_or_default();
        return Err(format!(
            "Initial board fetch failed (HTTP {}): {}",
            status, text
        ));
    }

    let initial_board = board_resp
        .json::<RemoteBoardColumnsResponse>()
        .await
        .map_err(|e| format!("Parse initial board response: {}", e))?
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
