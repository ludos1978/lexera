/// Export API routes for the Lexera backend.
///
/// Thin wrappers around `lexera_core::export` functions, exposed as REST endpoints.
///
///   POST /boards/{board_id}/export/presentation  -> generate presentation markdown
///   POST /boards/{board_id}/export/document      -> generate document markdown
///   POST /boards/{board_id}/export/filter        -> filter board markdown by tags
///   POST /export/transform                       -> apply content transforms
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
};
use lexera_core::export::content_transform::{
    apply_transforms, ExportFormat, HtmlCommentMode, HtmlContentMode, SpeakerNoteMode,
    TransformOptions,
};
use lexera_core::export::presentation::{self, PageBreaks, PresentationOptions};
use lexera_core::export::tag_filter::{
    self, filter_excluded_from_board, filter_excluded_from_markdown, TagVisibility,
};
use lexera_core::parser::generate_markdown;
use lexera_core::storage::BoardStorage;
use serde::Deserialize;

use crate::api::ErrorResponse;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationBody {
    #[serde(default)]
    tag_visibility: TagVisibility,
    #[serde(default)]
    exclude_tags: Vec<String>,
    #[serde(default)]
    strip_includes: bool,
    #[serde(default)]
    include_marp_directives: bool,
    marp_theme: Option<String>,
    #[serde(default)]
    marp_global_classes: Vec<String>,
    #[serde(default)]
    marp_local_classes: Vec<String>,
    per_slide_classes: Option<std::collections::HashMap<usize, Vec<String>>>,
    custom_yaml: Option<std::collections::HashMap<String, String>>,
    /// Optional list of column indexes to include (empty = all).
    #[serde(default)]
    column_indexes: Vec<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBody {
    #[serde(default)]
    tag_visibility: TagVisibility,
    #[serde(default)]
    exclude_tags: Vec<String>,
    #[serde(default)]
    strip_includes: bool,
    #[serde(default = "default_page_breaks")]
    page_breaks: PageBreaks,
}

fn default_page_breaks() -> PageBreaks {
    PageBreaks::Continuous
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterBody {
    #[serde(default)]
    tag_visibility: TagVisibility,
    #[serde(default)]
    exclude_tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformBody {
    content: String,
    speaker_note_mode: Option<SpeakerNoteMode>,
    html_comment_mode: Option<HtmlCommentMode>,
    html_content_mode: Option<HtmlContentMode>,
    #[serde(default = "default_format")]
    format: ExportFormat,
}

fn default_format() -> ExportFormat {
    ExportFormat::Presentation
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn export_router() -> Router<AppState> {
    Router::new()
        .route(
            "/boards/{board_id}/export/presentation",
            post(export_presentation),
        )
        .route(
            "/boards/{board_id}/export/document",
            post(export_document),
        )
        .route("/boards/{board_id}/export/filter", post(export_filter))
        .route("/export/transform", post(export_transform))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /boards/{board_id}/export/presentation
///
/// Generates a Marp-compatible presentation markdown from the board.
async fn export_presentation(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<PresentationBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    // Always add #hidden to exclude tags
    let mut exclude_tags = body.exclude_tags;
    if !exclude_tags.iter().any(|t| t.eq_ignore_ascii_case("#hidden")) {
        exclude_tags.push("#hidden".to_string());
    }

    // Filter the board by exclude tags first
    let filtered_board = filter_excluded_from_board(&board, &exclude_tags);

    let options = PresentationOptions {
        include_marp_directives: body.include_marp_directives,
        strip_includes: body.strip_includes,
        tag_visibility: body.tag_visibility,
        exclude_tags,
        marp_theme: body.marp_theme,
        marp_global_classes: body.marp_global_classes,
        marp_local_classes: body.marp_local_classes,
        per_slide_classes: body.per_slide_classes,
        custom_yaml: body.custom_yaml,
    };

    let markdown = if body.column_indexes.is_empty() {
        presentation::from_board(&filtered_board, &options)
    } else {
        // Select specific columns by index
        let all_cols = filtered_board.all_columns();
        let selected: Vec<&lexera_core::types::KanbanColumn> = body
            .column_indexes
            .iter()
            .filter_map(|&idx| all_cols.get(idx).copied())
            .collect();
        presentation::from_columns(&selected, &options)
    };

    Ok(Json(serde_json::json!({ "markdown": markdown })))
}

/// POST /boards/{board_id}/export/document
///
/// Generates a Pandoc-friendly document markdown from the board.
async fn export_document(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<DocumentBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    let mut exclude_tags = body.exclude_tags;
    if !exclude_tags.iter().any(|t| t.eq_ignore_ascii_case("#hidden")) {
        exclude_tags.push("#hidden".to_string());
    }

    let filtered_board = filter_excluded_from_board(&board, &exclude_tags);

    let options = PresentationOptions {
        strip_includes: body.strip_includes,
        tag_visibility: body.tag_visibility,
        exclude_tags,
        ..PresentationOptions::default()
    };

    let markdown = presentation::to_document(&filtered_board, body.page_breaks, &options);

    Ok(Json(serde_json::json!({ "markdown": markdown })))
}

/// POST /boards/{board_id}/export/filter
///
/// Returns the board as filtered kanban markdown (tag filtering + exclude tags).
async fn export_filter(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<FilterBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    let mut exclude_tags = body.exclude_tags;
    if !exclude_tags.iter().any(|t| t.eq_ignore_ascii_case("#hidden")) {
        exclude_tags.push("#hidden".to_string());
    }

    // Filter board by exclude tags
    let filtered_board = filter_excluded_from_board(&board, &exclude_tags);

    // Generate markdown from filtered board
    let mut markdown = generate_markdown(&filtered_board);

    // Apply tag visibility filtering on the markdown
    if body.tag_visibility != TagVisibility::All {
        markdown = tag_filter::process_markdown_content(&markdown, body.tag_visibility);
    }

    // If exclude tags remain in the text, do a final pass
    if !exclude_tags.is_empty() {
        markdown = filter_excluded_from_markdown(&markdown, &exclude_tags);
    }

    Ok(Json(serde_json::json!({ "markdown": markdown })))
}

/// POST /export/transform
///
/// Applies content transformations (speaker notes, HTML comments, HTML content, list split).
/// Not board-specific — operates on raw markdown content.
async fn export_transform(
    Json(body): Json<TransformBody>,
) -> Json<serde_json::Value> {
    let options = TransformOptions {
        speaker_note_mode: body.speaker_note_mode,
        html_comment_mode: body.html_comment_mode,
        html_content_mode: body.html_content_mode,
        format: body.format,
    };

    let result = apply_transforms(&body.content, &options);

    Json(serde_json::json!({ "content": result }))
}
