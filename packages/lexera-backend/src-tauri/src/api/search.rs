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
