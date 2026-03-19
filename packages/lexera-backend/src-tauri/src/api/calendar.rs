use axum::{extract::State, response::Json};
use lexera_core::storage::BoardStorage;

use crate::state::AppState;

/// GET /calendar/tasks — return all cards with a due date across all boards.
pub async fn calendar_tasks(State(state): State<AppState>) -> Json<serde_json::Value> {
    let results = state.storage.calendar_tasks();
    Json(serde_json::json!({ "results": results }))
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use tower::ServiceExt;

    use crate::test_helpers::{authed_get, body_json, register_test_user, test_router, test_state};

    fn write_board_file(dir: &std::path::Path, name: &str, content: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    const BOARD_WITH_DATES: &str = "\
---
kanban-plugin: board
---

## Backlog
- [ ] Fix login bug @2026-03-20
- [ ] No date task

## Done
- [x] Write unit tests @2026-03-15
";

    #[tokio::test]
    async fn calendar_tasks_returns_cards_with_due_dates() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "calendar.md", BOARD_WITH_DATES);
        let state = test_state(tmp.path());
        let token = register_test_user(&state);
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get("/calendar/tasks", &token))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let results = json["results"].as_array().unwrap();
        // Should include both cards with dates, but not the "No date task"
        assert_eq!(results.len(), 2, "Expected 2 cards with due dates, got: {:?}", results);
        assert!(
            results.iter().all(|r| r["dueDate"].as_str().is_some()),
            "All results should have a dueDate"
        );
        assert!(
            !results.iter().any(|r| r["cardContent"].as_str().unwrap().contains("No date")),
            "Should not include cards without due dates"
        );
    }

    #[tokio::test]
    async fn calendar_tasks_empty_when_no_boards() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get("/calendar/tasks", &token))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let results = json["results"].as_array().unwrap();
        assert!(results.is_empty());
    }
}
