use axum::{extract::State, response::Json};
use lexera_core::storage::BoardStorage;
use lexera_core::types::GroupedCalendarTasks;

use crate::state::AppState;

fn format_date(secs_since_epoch: i64) -> String {
    let days = secs_since_epoch / 86400;
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", year, m, d)
}

fn compute_date_boundaries() -> (String, String, String) {
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let today_str = format_date(now_secs);

    let days_since_epoch = now_secs / 86400;
    let weekday = ((days_since_epoch % 7) + 4) % 7; // 0=Sun
    let days_until_sunday = if weekday == 0 { 0 } else { 7 - weekday };
    let end_of_week_str = format_date(now_secs + days_until_sunday * 86400);
    let two_weeks_str = format_date(now_secs + 14 * 86400);

    (today_str, end_of_week_str, two_weeks_str)
}

/// GET /calendar/tasks — return all cards with due dates, grouped by time period.
/// Response includes both flat `results` array (backwards compat) and `groups` object
/// with overdue/today/thisWeek/upcoming/later arrays.
pub async fn calendar_tasks(State(state): State<AppState>) -> Json<serde_json::Value> {
    let results = state.storage.calendar_tasks();
    let (today_str, end_of_week_str, two_weeks_str) = compute_date_boundaries();
    let groups = GroupedCalendarTasks::from_tasks(results.clone(), &today_str, &end_of_week_str, &two_weeks_str);
    Json(serde_json::json!({
        "results": results,
        "groups": groups,
        "today": today_str,
        "endOfWeek": end_of_week_str,
        "twoWeeksOut": two_weeks_str
    }))
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
