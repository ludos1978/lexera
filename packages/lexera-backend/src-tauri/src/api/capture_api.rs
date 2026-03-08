use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use tauri::Manager;

use crate::{capture::ClipboardHistory, state::AppState};

fn with_clipboard_history<T, F>(state: &AppState, f: F) -> Option<T>
where
    F: FnOnce(&ClipboardHistory) -> T,
{
    let app = state.app_handle.as_ref()?;
    let history = app.try_state::<ClipboardHistory>()?;
    Some(f(&history))
}

/// GET /capture/history -- list stored quick-capture / clipboard history entries.
pub async fn list_capture_history(
    State(state): State<AppState>,
) -> Json<Vec<lexera_core::capture::CaptureEntry>> {
    let entries = with_clipboard_history(&state, |history| {
        history.lock().map(|items| items.clone()).unwrap_or_default()
    })
    .unwrap_or_default();
    Json(entries)
}

/// DELETE /capture/history/{id} -- remove a stored quick-capture / clipboard history entry.
pub async fn delete_capture_history_entry(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> StatusCode {
    with_clipboard_history(&state, |history| {
        history
            .lock()
            .map(|mut items| {
                let before = items.len();
                items.retain(|entry| entry.id != id);
                if items.len() == before {
                    StatusCode::NOT_FOUND
                } else {
                    StatusCode::NO_CONTENT
                }
            })
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
    })
    .unwrap_or(StatusCode::NOT_FOUND)
}
