use axum::{extract::State, Json};
use lexera_core::search::SearchOptions;
use lexera_core::storage::local::BatchSearchQuery;
use lexera_core::storage::BoardStorage;
use lexera_core::types::{GroupedCalendarTasks, PaginatedSearchResults};
use serde::Deserialize;

use crate::state::AppState;

use super::calendar::compute_date_boundaries;

#[derive(Deserialize)]
pub struct DashboardDataBody {
    q: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, alias = "searchLimit")]
    search_limit: Option<usize>,
    #[serde(default, alias = "searchTruncate")]
    search_truncate: Option<usize>,
    #[serde(default, alias = "calendarLimit")]
    calendar_limit: Option<usize>,
    #[serde(default, alias = "calendarTruncate")]
    calendar_truncate: Option<usize>,
}

fn empty_paginated(options: SearchOptions) -> PaginatedSearchResults {
    PaginatedSearchResults {
        results: Vec::new(),
        total: 0,
        limit: options.limit.unwrap_or(50),
        offset: options.offset.unwrap_or(0),
    }
}

pub async fn dashboard_data(
    State(state): State<AppState>,
    Json(body): Json<DashboardDataBody>,
) -> Json<serde_json::Value> {
    let query = body.q.unwrap_or_default();
    let tags: Vec<String> = body
        .tags
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();
    let search_options = SearchOptions {
        case_sensitive: false,
        use_regex: false,
        limit: body.search_limit,
        offset: Some(0),
        truncate: body.search_truncate,
    };

    let mut queries = vec![BatchSearchQuery {
        key: "todos".to_string(),
        query: "is:open".to_string(),
        options: search_options,
    }];
    if !query.trim().is_empty() {
        queries.push(BatchSearchQuery {
            key: "query".to_string(),
            query: query.clone(),
            options: search_options,
        });
    }
    for (index, tag) in tags.iter().enumerate() {
        queries.push(BatchSearchQuery {
            key: format!("tag:{}", index),
            query: tag.clone(),
            options: search_options,
        });
    }

    let mut search_results = state
        .storage
        .search_many_with_options(&queries)
        .into_iter()
        .map(|result| (result.key, result.paginated))
        .collect::<std::collections::HashMap<_, _>>();

    let query_results = search_results
        .remove("query")
        .unwrap_or_else(|| empty_paginated(search_options));
    let todos_results = search_results
        .remove("todos")
        .unwrap_or_else(|| empty_paginated(search_options));
    let tag_results: Vec<serde_json::Value> = tags
        .iter()
        .enumerate()
        .map(|(index, tag)| {
            let paginated = search_results
                .remove(&format!("tag:{}", index))
                .unwrap_or_else(|| empty_paginated(search_options));
            serde_json::json!({
                "tag": tag,
                "results": paginated.results,
                "total": paginated.total,
                "limit": paginated.limit,
                "offset": paginated.offset,
            })
        })
        .collect();

    let calendar_results = state.storage.calendar_tasks();
    let (today, end_of_week, two_weeks_out) = compute_date_boundaries();
    let calendar_groups = GroupedCalendarTasks::from_tasks(
        calendar_results.clone(),
        &today,
        &end_of_week,
        &two_weeks_out,
        body.calendar_limit,
        Some(0),
        body.calendar_truncate,
    );

    Json(serde_json::json!({
        "query": {
            "query": query,
            "results": query_results.results,
            "total": query_results.total,
            "limit": query_results.limit,
            "offset": query_results.offset,
        },
        "todos": {
            "results": todos_results.results,
            "total": todos_results.total,
            "limit": todos_results.limit,
            "offset": todos_results.offset,
        },
        "tags": tag_results,
        "calendar": {
            "results": calendar_results,
            "groups": calendar_groups,
            "today": today,
            "endOfWeek": end_of_week,
            "twoWeeksOut": two_weeks_out,
        },
    }))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use crate::test_helpers::{body_json, register_test_user, test_router, test_state};

    fn write_board_file(dir: &std::path::Path, name: &str, content: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    const DASHBOARD_BOARD: &str = "\
---
kanban-plugin: board
---

## Todo
- [ ] Fix login bug #important @2030-01-02
- [ ] Review API #review

## Done
- [x] Blocked migration #blocked @2030-01-01
";

    #[tokio::test]
    async fn dashboard_data_returns_query_calendar_and_tags() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "dashboard.md", DASHBOARD_BOARD);
        let state = test_state(tmp.path());
        let token = register_test_user(&state);
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/dashboard/data")
                    .header("authorization", format!("Bearer {}", token))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "q": "login",
                            "tags": ["#important", "#blocked"],
                            "searchLimit": 30,
                            "searchTruncate": 200,
                            "calendarLimit": 20,
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["query"]["results"].as_array().unwrap().len(), 1);
        assert_eq!(json["todos"]["results"].as_array().unwrap().len(), 2);
        assert_eq!(json["tags"].as_array().unwrap().len(), 2);
        assert_eq!(json["tags"][0]["results"].as_array().unwrap().len(), 1);
        assert_eq!(json["calendar"]["results"].as_array().unwrap().len(), 2);
    }
}
