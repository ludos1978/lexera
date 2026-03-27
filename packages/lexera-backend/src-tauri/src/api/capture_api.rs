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
    // Standalone field (used in tests without Tauri app handle)
    if let Some(ref history) = state.clipboard_history {
        return Some(f(history));
    }
    // Tauri managed state
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

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use std::sync::{Arc, Mutex};
    use tower::ServiceExt;

    use crate::test_helpers::{authed_get, body_json, register_test_user, test_state};

    fn test_state_with_history(
        tmp: &std::path::Path,
        entries: Vec<lexera_core::capture::CaptureEntry>,
    ) -> crate::state::AppState {
        let mut state = test_state(tmp);
        state.clipboard_history = Some(Arc::new(Mutex::new(entries)));
        state
    }

    fn make_entry(id: u64, text: &str) -> lexera_core::capture::CaptureEntry {
        lexera_core::capture::CaptureEntry {
            id,
            text: Some(text.to_string()),
            image_data: None,
            image_filename: None,
            timestamp: 1000 + id,
        }
    }

    #[tokio::test]
    async fn list_capture_history_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state_with_history(tmp.path(), vec![]);
        let token = register_test_user(&state);
        let app = crate::test_helpers::test_router(state);

        let resp = app
            .oneshot(authed_get("/capture/history", &token))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let entries = json.as_array().unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn list_capture_history_returns_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let entries = vec![make_entry(1, "hello"), make_entry(2, "world")];
        let state = test_state_with_history(tmp.path(), entries);
        let token = register_test_user(&state);
        let app = crate::test_helpers::test_router(state);

        let resp = app
            .oneshot(authed_get("/capture/history", &token))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let arr = json.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["id"], 1);
        assert_eq!(arr[0]["text"], "hello");
        assert_eq!(arr[1]["id"], 2);
        assert_eq!(arr[1]["text"], "world");
    }

    #[tokio::test]
    async fn list_capture_history_no_history_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path()); // clipboard_history = None
        let token = register_test_user(&state);
        let app = crate::test_helpers::test_router(state);

        let resp = app
            .oneshot(authed_get("/capture/history", &token))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert!(json.as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn delete_capture_entry_success() {
        let tmp = tempfile::tempdir().unwrap();
        let entries = vec![make_entry(10, "keep"), make_entry(20, "delete me")];
        let state = test_state_with_history(tmp.path(), entries);
        let token = register_test_user(&state);
        let history = state.clipboard_history.clone().unwrap();
        let app = crate::test_helpers::test_router(state);

        let req = axum::http::Request::builder()
            .method("DELETE")
            .uri("/capture/history/20")
            .header("authorization", format!("Bearer {}", token))
            .body(axum::body::Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        let remaining = history.lock().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, 10);
    }

    #[tokio::test]
    async fn delete_capture_entry_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let entries = vec![make_entry(1, "only entry")];
        let state = test_state_with_history(tmp.path(), entries);
        let token = register_test_user(&state);
        let app = crate::test_helpers::test_router(state);

        let req = axum::http::Request::builder()
            .method("DELETE")
            .uri("/capture/history/999")
            .header("authorization", format!("Bearer {}", token))
            .body(axum::body::Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_capture_entry_no_history() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path()); // clipboard_history = None
        let token = register_test_user(&state);
        let app = crate::test_helpers::test_router(state);

        let req = axum::http::Request::builder()
            .method("DELETE")
            .uri("/capture/history/1")
            .header("authorization", format!("Bearer {}", token))
            .body(axum::body::Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
