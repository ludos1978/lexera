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
use lexera_core::types::KanbanBoard;
use serde::Deserialize;
use std::collections::HashSet;

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
    /// Optional list of column ids to include (preferred over indexes when present).
    #[serde(default)]
    column_ids: Vec<String>,
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
    /// Optional list of column ids to include (preferred over indexes when present).
    #[serde(default)]
    column_ids: Vec<String>,
    /// Optional list of column indexes to include (empty = all).
    #[serde(default)]
    column_indexes: Vec<usize>,
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
    /// Optional list of column ids to include (preferred over indexes when present).
    #[serde(default)]
    column_ids: Vec<String>,
    /// Optional list of column indexes to include (empty = all).
    #[serde(default)]
    column_indexes: Vec<usize>,
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

fn selected_board_for_export(
    board: &KanbanBoard,
    column_ids: &[String],
    column_indexes: &[usize],
) -> Option<KanbanBoard> {
    if column_ids.is_empty() && column_indexes.is_empty() {
        return None;
    }

    let selected_ids: HashSet<&str> = column_ids.iter().map(|value| value.as_str()).collect();
    let selected_indexes: HashSet<usize> = column_indexes.iter().copied().collect();
    let mut flat_index = 0usize;
    let mut next_board = board.clone();

    if !next_board.rows.is_empty() {
        for row in &mut next_board.rows {
            for stack in &mut row.stacks {
                stack.columns.retain(|column| {
                    let include = selected_ids.contains(column.id.as_str())
                        || selected_indexes.contains(&flat_index);
                    flat_index += 1;
                    include
                });
            }
            row.stacks.retain(|stack| !stack.columns.is_empty());
        }
        next_board.rows.retain(|row| !row.stacks.is_empty());
        next_board.columns.clear();
    } else {
        next_board.columns.retain(|column| {
            let include =
                selected_ids.contains(column.id.as_str()) || selected_indexes.contains(&flat_index);
            flat_index += 1;
            include
        });
    }

    Some(next_board)
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
        .route("/boards/{board_id}/export/document", post(export_document))
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
    if !exclude_tags
        .iter()
        .any(|t| t.eq_ignore_ascii_case("#hidden"))
    {
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

    let export_board =
        selected_board_for_export(&filtered_board, &body.column_ids, &body.column_indexes)
            .unwrap_or_else(|| filtered_board.clone());

    let markdown = presentation::from_board(&export_board, &options);

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
    if !exclude_tags
        .iter()
        .any(|t| t.eq_ignore_ascii_case("#hidden"))
    {
        exclude_tags.push("#hidden".to_string());
    }

    let filtered_board = filter_excluded_from_board(&board, &exclude_tags);

    let options = PresentationOptions {
        strip_includes: body.strip_includes,
        tag_visibility: body.tag_visibility,
        exclude_tags,
        ..PresentationOptions::default()
    };

    let export_board =
        selected_board_for_export(&filtered_board, &body.column_ids, &body.column_indexes)
            .unwrap_or_else(|| filtered_board.clone());

    let markdown = presentation::to_document(&export_board, body.page_breaks, &options);

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
    if !exclude_tags
        .iter()
        .any(|t| t.eq_ignore_ascii_case("#hidden"))
    {
        exclude_tags.push("#hidden".to_string());
    }

    // Filter board by exclude tags
    let filtered_board = filter_excluded_from_board(&board, &exclude_tags);

    // Generate markdown from filtered board
    let export_board =
        selected_board_for_export(&filtered_board, &body.column_ids, &body.column_indexes)
            .unwrap_or_else(|| filtered_board.clone());

    let mut markdown = generate_markdown(&export_board);

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
async fn export_transform(Json(body): Json<TransformBody>) -> Json<serde_json::Value> {
    let options = TransformOptions {
        speaker_note_mode: body.speaker_note_mode,
        html_comment_mode: body.html_comment_mode,
        html_content_mode: body.html_content_mode,
        format: body.format,
    };

    let result = apply_transforms(&body.content, &options);

    Json(serde_json::json!({ "content": result }))
}

#[cfg(test)]
mod tests {
    use super::selected_board_for_export;
    use lexera_core::types::{
        BoardFormat, KanbanBoard, KanbanCard, KanbanColumn, KanbanRow, KanbanStack,
    };
    use std::collections::HashMap;

    fn sample_card(id: &str) -> KanbanCard {
        KanbanCard {
            id: id.to_string(),
            content: format!("Card {id}"),
            checked: false,
            kid: None,
            params: HashMap::new(),
        }
    }

    fn sample_column(id: &str, title: &str) -> KanbanColumn {
        KanbanColumn {
            id: id.to_string(),
            title: title.to_string(),
            cards: vec![sample_card(&(String::from(id) + "-card"))],
            include_source: None,
            params: HashMap::new(),
        }
    }

    fn sample_board() -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Board".to_string(),
            columns: Vec::new(),
            rows: vec![
                KanbanRow {
                    id: "row-1".to_string(),
                    title: "Planning".to_string(),
                    stacks: vec![
                        KanbanStack {
                            id: "stack-1".to_string(),
                            title: "Ideas".to_string(),
                            columns: vec![
                                sample_column("col-1", "Inbox"),
                                sample_column("col-2", "Next"),
                            ],
                            params: HashMap::new(),
                        },
                        KanbanStack {
                            id: "stack-2".to_string(),
                            title: "Ready".to_string(),
                            columns: vec![sample_column("col-3", "Doing")],
                            params: HashMap::new(),
                        },
                    ],
                    params: HashMap::new(),
                },
                KanbanRow {
                    id: "row-2".to_string(),
                    title: "Delivery".to_string(),
                    stacks: vec![KanbanStack {
                        id: "stack-3".to_string(),
                        title: "Ship".to_string(),
                        columns: vec![sample_column("col-4", "Done")],
                        params: HashMap::new(),
                    }],
                    params: HashMap::new(),
                },
            ],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        }
    }

    #[test]
    fn selected_board_for_export_filters_by_column_ids_and_keeps_hierarchy() {
        let board = sample_board();
        let selected =
            selected_board_for_export(&board, &["col-2".to_string(), "col-4".to_string()], &[])
                .expect("selection should produce subset board");

        assert_eq!(selected.rows.len(), 2);
        assert_eq!(selected.rows[0].stacks.len(), 1);
        assert_eq!(selected.rows[0].stacks[0].columns.len(), 1);
        assert_eq!(selected.rows[0].stacks[0].columns[0].id, "col-2");
        assert_eq!(selected.rows[1].stacks.len(), 1);
        assert_eq!(selected.rows[1].stacks[0].columns.len(), 1);
        assert_eq!(selected.rows[1].stacks[0].columns[0].id, "col-4");
    }

    #[test]
    fn selected_board_for_export_filters_by_column_indexes_in_flat_order() {
        let board = sample_board();
        let selected = selected_board_for_export(&board, &[], &[1, 2])
            .expect("selection should produce subset board");

        assert_eq!(selected.rows.len(), 1);
        assert_eq!(selected.rows[0].stacks.len(), 2);
        assert_eq!(selected.rows[0].stacks[0].columns.len(), 1);
        assert_eq!(selected.rows[0].stacks[0].columns[0].id, "col-2");
        assert_eq!(selected.rows[0].stacks[1].columns.len(), 1);
        assert_eq!(selected.rows[0].stacks[1].columns[0].id, "col-3");
    }
}
