use axum::{
    extract::{Query, State},
    response::Json,
};
use lexera_core::search::SearchOptions;
use serde::Deserialize;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    q: Option<String>,
    #[serde(default, alias = "caseSensitive")]
    case_sensitive: Option<bool>,
    #[serde(default, alias = "useRegex")]
    regex: Option<bool>,
}

pub async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchQuery>,
) -> Json<serde_json::Value> {
    let query = params.q.unwrap_or_default();
    let options = SearchOptions {
        case_sensitive: params.case_sensitive.unwrap_or(false),
        use_regex: params.regex.unwrap_or(false),
    };
    let results = state.storage.search_with_options(&query, options);
    Json(serde_json::json!({ "query": query, "results": results }))
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

    const BOARD_WITH_CARDS: &str = "\
---
kanban-plugin: board
---

## Backlog
- [ ] Fix login bug
- [ ] Implement search feature

## Done
- [x] Write unit tests
";

    #[tokio::test]
    async fn search_returns_matching_cards() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "search.md", BOARD_WITH_CARDS);
        let state = test_state(tmp.path());
        let token = register_test_user(&state);
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/search?q=login")
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["query"], "login");
        let results = json["results"].as_array().unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0]["cardContent"]
            .as_str()
            .unwrap()
            .contains("login"));
    }

    #[tokio::test]
    async fn search_nonexistent_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "search2.md", BOARD_WITH_CARDS);
        let state = test_state(tmp.path());
        let token = register_test_user(&state);
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/search?q=zzzznonexistent")
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["query"], "zzzznonexistent");
        let results = json["results"].as_array().unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn search_without_q_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "search3.md", BOARD_WITH_CARDS);
        let state = test_state(tmp.path());
        let token = register_test_user(&state);
        state.storage.add_board(&board_path).unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/search")
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["query"], "");
        let results = json["results"].as_array().unwrap();
        assert!(results.is_empty());
    }
}
