/// Export API routes for the Lexera backend.
///
/// Thin wrappers around `lexera_core::export` functions, exposed as REST endpoints.
///
///   POST /boards/{board_id}/export/presentation  -> generate presentation markdown
///   POST /boards/{board_id}/export/document      -> generate document markdown
///   POST /boards/{board_id}/export/filter        -> filter board markdown by tags
///   POST /export/transform                       -> apply content transforms
///   GET  /boards/{board_id}/export/ical          -> text/calendar feed (RFC 5545)
///   GET  /boards/{board_id}/export/xbel          -> application/xbel+xml feed
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use lexera_core::export::content_transform::{
    apply_transforms, ExportFormat, HtmlCommentMode, HtmlContentMode, SpeakerNoteMode,
    TransformOptions,
};
use lexera_core::export::ical::export_board_to_ical;
use lexera_core::export::presentation::{self, PageBreaks, PresentationOptions};
use lexera_core::export::tag_filter::{
    self, filter_excluded_from_board, filter_excluded_from_markdown, TagVisibility,
};
use lexera_core::export::xbel::{columns_to_xbel, generate_xbel};
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
        log::info!(
            "[export.select] no filter → returning whole board (column_ids=0, column_indexes=0)"
        );
        return None;
    }

    let selected_ids: HashSet<&str> = column_ids.iter().map(|value| value.as_str()).collect();
    let selected_indexes: HashSet<usize> = column_indexes.iter().copied().collect();
    let mut flat_index = 0usize;
    let mut next_board = board.clone();

    // Snapshot the board's own column IDs so we can tell the user when
    // the frontend-supplied ids don't match anything in the stored board.
    let mut board_ids: Vec<String> = Vec::new();
    let mut board_titles: Vec<String> = Vec::new();
    for row in &next_board.rows {
        for stack in &row.stacks {
            for col in &stack.columns {
                board_ids.push(col.id.clone());
                board_titles.push(col.title.clone());
            }
        }
    }
    if next_board.rows.is_empty() {
        for col in &next_board.columns {
            board_ids.push(col.id.clone());
            board_titles.push(col.title.clone());
        }
    }
    // Detect duplicate IDs in the stored board. Duplicate `col.id` values
    // would cause a single frontend-selected ID to retain multiple
    // columns — and is the primary suspect when retained > ids_in.
    use std::collections::HashMap;
    let mut id_counts: HashMap<&str, usize> = HashMap::new();
    for id in &board_ids {
        *id_counts.entry(id.as_str()).or_insert(0) += 1;
    }
    let dup_ids: Vec<(&&str, &usize)> = id_counts.iter().filter(|(_, c)| **c > 1).collect();
    if !dup_ids.is_empty() {
        log::warn!(
            "[export.select] board has duplicate column IDs (this breaks id-based filtering): {:?}",
            dup_ids
        );
    }
    let mut retained = 0usize;
    let mut retained_details: Vec<(String, String, usize, bool, bool)> = Vec::new();

    // Selection semantics:
    //   both present → AND  (intersection — robust against duplicate IDs)
    //   only ids     → id match
    //   only indexes → index match
    // The frontend always emits both lists from the same tree selection;
    // intersecting them means a duplicate col.id won't pull in sibling
    // columns with the same id at a different flat position.
    let have_ids = !selected_ids.is_empty();
    let have_indexes = !selected_indexes.is_empty();
    let include_fn = |col_id: &str, idx: usize| -> (bool, bool, bool) {
        let by_id = selected_ids.contains(col_id);
        let by_idx = selected_indexes.contains(&idx);
        let include = if have_ids && have_indexes {
            by_id && by_idx
        } else if have_ids {
            by_id
        } else {
            by_idx
        };
        (include, by_id, by_idx)
    };

    if !next_board.rows.is_empty() {
        for row in &mut next_board.rows {
            for stack in &mut row.stacks {
                stack.columns.retain(|column| {
                    let idx = flat_index;
                    let (include, by_id, by_idx) = include_fn(column.id.as_str(), idx);
                    flat_index += 1;
                    if include {
                        retained += 1;
                        retained_details.push((column.id.clone(), column.title.clone(), idx, by_id, by_idx));
                    }
                    include
                });
            }
            row.stacks.retain(|stack| !stack.columns.is_empty());
        }
        next_board.rows.retain(|row| !row.stacks.is_empty());
        next_board.columns.clear();
    } else {
        next_board.columns.retain(|column| {
            let idx = flat_index;
            let (include, by_id, by_idx) = include_fn(column.id.as_str(), idx);
            flat_index += 1;
            if include {
                retained += 1;
                retained_details.push((column.id.clone(), column.title.clone(), idx, by_id, by_idx));
            }
            include
        });
    }

    // Surface mismatch diagnostics — the #1 reason "filter failed" in
    // practice is that the frontend-captured column IDs diverge from the
    // IDs the storage layer returns (e.g. after CRDT reconciliation).
    let mismatched: Vec<&str> = column_ids
        .iter()
        .map(|s| s.as_str())
        .filter(|id| !board_ids.iter().any(|b| b == id))
        .collect();
    log::info!(
        "[export.select] ids_in={} idx_in={} retained={} board_cols={} mismatched_ids={:?}",
        column_ids.len(),
        column_indexes.len(),
        retained,
        board_ids.len(),
        mismatched
    );
    // Per-column breakdown: tells us which columns were kept, via which
    // matcher (by id / by index / both), and their title. When retained >
    // ids_in this shows exactly where the extras come from.
    let by_id_count = retained_details.iter().filter(|d| d.3).count();
    let by_idx_count = retained_details.iter().filter(|d| d.4).count();
    let by_both_count = retained_details.iter().filter(|d| d.3 && d.4).count();
    log::info!(
        "[export.select] retention breakdown: by_id={} by_idx={} by_both={} (sum-both={})",
        by_id_count,
        by_idx_count,
        by_both_count,
        by_id_count + by_idx_count - by_both_count
    );
    // One-line summary: exactly which columns (by title) ended up in the
    // export, in flat order. Lets the user confirm visually.
    let kept_titles: Vec<&str> = retained_details.iter().map(|(_id, t, _i, _b, _x)| t.as_str()).collect();
    log::info!("[export.select] SUMMARY {} columns kept: {:?}", kept_titles.len(), kept_titles);
    for (id, title, idx, by_id, by_idx) in &retained_details {
        log::info!(
            "[export.select] KEEPING col idx={} id={} by_id={} by_idx={} title={:?}",
            idx,
            id,
            by_id,
            by_idx,
            title
        );
    }

    Some(next_board)
}

/// Collect column titles in flat order — used by export handlers to echo
/// back which columns were actually included, so the frontend can show it.
fn collect_column_titles(board: &KanbanBoard) -> Vec<String> {
    let mut out = Vec::new();
    if !board.rows.is_empty() {
        for row in &board.rows {
            for stack in &row.stacks {
                for col in &stack.columns {
                    out.push(col.title.clone());
                }
            }
        }
    } else {
        for col in &board.columns {
            out.push(col.title.clone());
        }
    }
    out
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
        // GET endpoints: stateless read-only feeds suitable for calendar /
        // bookmark client subscription by URL.
        .route("/boards/{board_id}/export/ical", get(export_ical))
        .route("/boards/{board_id}/export/xbel", get(export_xbel))
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

    let kept_columns = collect_column_titles(&export_board);
    let markdown = presentation::from_board(&export_board, &options);

    Ok(Json(serde_json::json!({
        "markdown": markdown,
        "keptColumns": kept_columns,
    })))
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

    let kept_columns = collect_column_titles(&export_board);
    let markdown = presentation::to_document(&export_board, body.page_breaks, &options);

    Ok(Json(serde_json::json!({
        "markdown": markdown,
        "keptColumns": kept_columns,
    })))
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

    let kept_columns = collect_column_titles(&export_board);
    let mut markdown = generate_markdown(&export_board);

    // Apply tag visibility filtering on the markdown
    if body.tag_visibility != TagVisibility::All {
        markdown = tag_filter::process_markdown_content(&markdown, body.tag_visibility);
    }

    // If exclude tags remain in the text, do a final pass
    if !exclude_tags.is_empty() {
        markdown = filter_excluded_from_markdown(&markdown, &exclude_tags);
    }

    Ok(Json(serde_json::json!({
        "markdown": markdown,
        "keptColumns": kept_columns,
    })))
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

// ---------------------------------------------------------------------------
// Calendar and bookmark feed endpoints
// ---------------------------------------------------------------------------

/// Default exclude-tag set for the subscribable feed endpoints.
///
/// These tags cover user-marked hidden content (`#hidden`) and the internal
/// markers the kanban applies to deleted / archived / parked / incoming cards.
/// Any card or column carrying one of these must never reach a subscription
/// client, because the client has no way to hide it again on its side.
fn feed_default_exclude_tags() -> Vec<String> {
    vec![
        "#hidden".to_string(),
        lexera_core::types::HIDDEN_TAG_DELETED.to_string(),
        lexera_core::types::HIDDEN_TAG_ARCHIVED.to_string(),
        lexera_core::types::HIDDEN_TAG_PARKED.to_string(),
        lexera_core::types::HIDDEN_TAG_INCOMING.to_string(),
    ]
}

/// Build a standard "this file is a streaming feed" header set so subscription
/// clients (calendar apps, bookmark managers) pick up updates on each poll.
fn feed_headers(content_type: &'static str, filename: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type),
    );
    // `Cache-Control: no-store` avoids clients silently pinning a stale body.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, must-revalidate"),
    );
    // `Content-Disposition: inline` with a filename hint — helps browsers and
    // calendar clients pick a sensible display name when the feed is saved.
    if let Ok(disposition) =
        HeaderValue::from_str(&format!("inline; filename=\"{}\"", filename))
    {
        headers.insert(header::CONTENT_DISPOSITION, disposition);
    }
    headers
}

/// GET /boards/{board_id}/export/ical
///
/// Returns a `text/calendar` feed (RFC 5545) containing every non-hidden card
/// in the board that carries a resolvable temporal tag. Cards and columns
/// tagged with `#hidden` or any of the internal hidden markers
/// (`#hidden-internal-deleted` / `-archived` / `-parked` / `-incoming`) are
/// filtered out before export so subscription clients only see published
/// content.
///
/// Suitable for subscription from calendar clients: point Apple Calendar /
/// Google Calendar / Thunderbird at this URL and it will poll and refresh on
/// its normal interval.
async fn export_ical(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    // Strip hidden/archived/deleted cards and columns before export so they
    // never reach a subscription client.
    let filtered = filter_excluded_from_board(&board, &feed_default_exclude_tags());

    let ical = export_board_to_ical(&filtered, &board_id);
    let filename = format!("{}.ics", sanitize_filename(&board.title, &board_id));
    let headers = feed_headers("text/calendar; charset=utf-8", &filename);

    Ok((headers, ical).into_response())
}

/// GET /boards/{board_id}/export/xbel
///
/// Returns an `application/xbel+xml` document built from the board's columns
/// and cards. Cards and columns tagged with `#hidden` or any of the internal
/// hidden markers are filtered out before export, so the feed only ever
/// publishes content the user wants shared.
///
/// Suitable for Floccus-style bookmark sync over WebDAV. Cards that do not
/// contain a markdown link are silently skipped (documented in `XbelMapper`).
async fn export_xbel(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    let board = state.storage.read_board(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    // Strip hidden/archived/deleted cards and columns before export.
    let filtered = filter_excluded_from_board(&board, &feed_default_exclude_tags());

    // Collect columns from either legacy or new-format boards.
    let columns: Vec<_> = filtered.all_columns().into_iter().cloned().collect();
    let xbel_root = columns_to_xbel(&columns);
    let xml = generate_xbel(&xbel_root).map_err(|e| {
        log::warn!(target: "lexera.api.export.xbel", "xbel generation failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("XBEL generation failed: {}", e),
            }),
        )
    })?;

    let filename = format!("{}.xbel", sanitize_filename(&board.title, &board_id));
    let headers = feed_headers("application/xbel+xml; charset=utf-8", &filename);

    Ok((headers, xml).into_response())
}

/// Produce a filesystem-safe filename from the board title, falling back to
/// the board id when the title is empty or contains only unsafe characters.
/// We allow ASCII alphanumerics, dashes, underscores, and dots — everything
/// else collapses to `_`.
fn sanitize_filename(title: &str, board_id: &str) -> String {
    let candidate: String = title
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = candidate.trim_matches('_');
    if trimmed.is_empty() {
        board_id.to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{feed_default_exclude_tags, sanitize_filename, selected_board_for_export};
    use crate::test_helpers::{setup_board, test_router};
    use axum::body::Body;
    use axum::http::{header, HeaderMap, Request, Response, StatusCode};
    use http_body_util::BodyExt;
    use lexera_core::types::{
        BoardFormat, KanbanBoard, KanbanCard, KanbanColumn, KanbanRow, KanbanStack,
    };
    use std::collections::HashMap;
    use tower::ServiceExt;

    fn post_json_request(uri: &str, body: serde_json::Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    async fn response_json(resp: Response<Body>) -> serde_json::Value {
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

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

    fn duplicate_id_board() -> KanbanBoard {
        // Board where "col-dup" appears 3 times at flat indexes 0, 1, 3
        // (mimics the CRDT-reconciliation bug we saw in the huge-test
        // kanban where the same col.id was attached to multiple nodes).
        KanbanBoard {
            valid: true,
            title: "Dup".to_string(),
            columns: Vec::new(),
            rows: vec![KanbanRow {
                id: "row-1".to_string(),
                title: "R".to_string(),
                stacks: vec![KanbanStack {
                    id: "stack-1".to_string(),
                    title: "S".to_string(),
                    columns: vec![
                        sample_column("col-dup", "A0"),
                        sample_column("col-dup", "A1"),
                        sample_column("col-other", "B"),
                        sample_column("col-dup", "A2"),
                    ],
                    params: HashMap::new(),
                }],
                params: HashMap::new(),
            }],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        }
    }

    #[test]
    fn selected_board_for_export_intersects_ids_and_indexes_when_both_provided() {
        // With BOTH id and index lists supplied (the normal frontend
        // payload), the filter must AND them together — not OR. This is
        // the duplicate-id safety net: one selected id can legitimately
        // correspond to N columns in the stored board, but only the
        // specific index slot the user clicked is kept.
        let board = duplicate_id_board();
        let selected = selected_board_for_export(&board, &["col-dup".to_string()], &[1])
            .expect("selection should produce subset board");
        assert_eq!(selected.rows.len(), 1);
        assert_eq!(selected.rows[0].stacks[0].columns.len(), 1);
        // Only the col-dup at flat index 1 (title "A1") should remain.
        assert_eq!(selected.rows[0].stacks[0].columns[0].title, "A1");
    }

    #[test]
    fn selected_board_for_export_id_only_still_retains_all_duplicates() {
        // Documents the fallback behaviour — when the caller supplies ids
        // alone, we can't disambiguate duplicates and retain them all.
        let board = duplicate_id_board();
        let selected = selected_board_for_export(&board, &["col-dup".to_string()], &[])
            .expect("selection should produce subset board");
        assert_eq!(selected.rows[0].stacks[0].columns.len(), 3);
    }

    #[test]
    fn selected_board_for_export_index_only_picks_exact_slot() {
        let board = duplicate_id_board();
        let selected = selected_board_for_export(&board, &[], &[2])
            .expect("selection should produce subset board");
        assert_eq!(selected.rows[0].stacks[0].columns.len(), 1);
        assert_eq!(selected.rows[0].stacks[0].columns[0].title, "B");
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

    // -------------------------------------------------------------------
    // Integration tests — the export routes must actually be mounted by
    // api_router(). Before the orphan-router fix these all returned 404.
    // -------------------------------------------------------------------

    #[tokio::test]
    async fn export_presentation_route_returns_markdown() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(post_json_request(
                &format!("/boards/{}/export/presentation", board_id),
                serde_json::json!({}),
            ))
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "POST /boards/{{id}}/export/presentation must be mounted (was orphaned)"
        );
        let body = response_json(resp).await;
        assert!(body.get("markdown").is_some(), "response must contain a markdown field");
        let md = body["markdown"].as_str().unwrap();
        // MINIMAL_BOARD from test_helpers contains "Col" / "card".
        assert!(md.contains("Col") || md.contains("card"), "markdown: {}", md);
    }

    #[tokio::test]
    async fn export_document_route_returns_markdown() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(post_json_request(
                &format!("/boards/{}/export/document", board_id),
                serde_json::json!({}),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = response_json(resp).await;
        assert!(body.get("markdown").is_some());
    }

    #[tokio::test]
    async fn export_filter_route_returns_markdown() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(post_json_request(
                &format!("/boards/{}/export/filter", board_id),
                serde_json::json!({}),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = response_json(resp).await;
        assert!(body.get("markdown").is_some());
    }

    #[tokio::test]
    async fn export_transform_route_applies_transforms() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, _) = setup_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(post_json_request(
                "/export/transform",
                serde_json::json!({
                    "content": "# Heading\n\nParagraph",
                    "format": "presentation",
                }),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = response_json(resp).await;
        assert!(body.get("content").is_some(), "response must contain a content field");
    }

    #[tokio::test]
    async fn export_presentation_unknown_board_returns_404() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, _) = setup_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(post_json_request(
                "/boards/nonexistent-board-id/export/presentation",
                serde_json::json!({}),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    // -------------------------------------------------------------------
    // iCal + XBEL feed endpoints
    // -------------------------------------------------------------------

    /// Write a board that carries both a dated card and a bookmark-style
    /// card so the iCal and XBEL feeds have real content to emit.
    fn setup_feed_board(tmp: &std::path::Path) -> (crate::state::AppState, String) {
        const BOARD: &str = "\
---
kanban-plugin: board
---

## Links
- [ ] [GitHub](https://github.com \"bm-1\")
- [ ] [Rust](https://rust-lang.org \"bm-2\")

## Schedule
- [ ] Meeting @2026-04-15 #work
- [ ] Deadline @2026-05-01 #urgent
";
        let board_path = tmp.join("feed-board.md");
        std::fs::write(&board_path, BOARD).unwrap();
        let state = crate::test_helpers::test_state(tmp);
        let board_id = state.storage.add_board(&board_path).unwrap();
        (state, board_id)
    }

    fn get_request(uri: &str) -> Request<Body> {
        Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap()
    }

    async fn response_text(resp: Response<Body>) -> (HeaderMap, String) {
        let headers = resp.headers().clone();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        (headers, String::from_utf8(bytes.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn export_ical_route_returns_vcalendar_feed() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_feed_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(get_request(&format!(
                "/boards/{}/export/ical",
                board_id
            )))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let (headers, body) = response_text(resp).await;

        // Correct content type for calendar subscription clients.
        let ct = headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            ct.starts_with("text/calendar"),
            "unexpected content-type: {}",
            ct
        );
        // RFC 5545 structural landmarks.
        assert!(body.contains("BEGIN:VCALENDAR"));
        assert!(body.contains("END:VCALENDAR"));
        assert!(body.contains("VERSION:2.0"));
        assert!(body.contains("PRODID:-//Lexera//Kanban//EN"));
        // Both dated cards should produce VEVENTs.
        assert_eq!(body.matches("BEGIN:VEVENT").count(), 2);
        assert!(body.contains("DTSTART;VALUE=DATE:20260415"));
        assert!(body.contains("DTSTART;VALUE=DATE:20260501"));
        // DTSTAMP (required) and CALSCALE / METHOD (feed compatibility)
        // were added earlier this session — assert they flow through here.
        assert!(body.contains("DTSTAMP:"));
        assert!(body.contains("CALSCALE:GREGORIAN"));
        assert!(body.contains("METHOD:PUBLISH"));
    }

    #[tokio::test]
    async fn export_ical_unknown_board_returns_404() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, _) = setup_feed_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(get_request("/boards/nonexistent/export/ical"))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn export_xbel_route_returns_xbel_feed() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_feed_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(get_request(&format!(
                "/boards/{}/export/xbel",
                board_id
            )))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let (headers, body) = response_text(resp).await;

        let ct = headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            ct.starts_with("application/xbel+xml"),
            "unexpected content-type: {}",
            ct
        );
        // XBEL structural landmarks.
        assert!(body.contains("<?xml"));
        assert!(body.contains("<xbel"));
        assert!(body.contains("</xbel>"));
        // The Links column should have produced a <folder>, and the two
        // bookmark cards should appear as <bookmark> entries.
        assert!(body.contains("<title>Links</title>"));
        assert!(body.contains("https://github.com"));
        assert!(body.contains("https://rust-lang.org"));
        assert!(body.contains("bm-1"));
        assert!(body.contains("bm-2"));
    }

    #[tokio::test]
    async fn export_xbel_unknown_board_returns_404() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, _) = setup_feed_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(get_request("/boards/nonexistent/export/xbel"))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn export_ical_feed_sets_content_disposition_filename() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_feed_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(get_request(&format!(
                "/boards/{}/export/ical",
                board_id
            )))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let disposition = resp
            .headers()
            .get(header::CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            disposition.starts_with("inline;") && disposition.contains(".ics"),
            "unexpected disposition: {}",
            disposition
        );
    }

    // -------------------------------------------------------------------
    // Exclude-tag filtering on the subscribable feeds. Hidden/archived/
    // deleted/parked/incoming cards must never leak into a feed body.
    // -------------------------------------------------------------------

    /// Board whose columns and cards carry every flavour of hidden tag so the
    /// tests can assert each one is filtered out.
    fn setup_hidden_feed_board(tmp: &std::path::Path) -> (crate::state::AppState, String) {
        const BOARD: &str = "\
---
kanban-plugin: board
---

## Public
- [ ] [Public Link](https://public.example.com \"bm-public\")
- [ ] Public meeting @2026-04-15

## Hidden Column #hidden
- [ ] [Secret Link](https://secret.example.com \"bm-secret\")
- [ ] Secret event @2026-04-20

## Mixed
- [ ] Regular card @2026-05-01
- [ ] Parked item #hidden-internal-parked @2026-05-02
- [ ] Archived item #hidden-internal-archived @2026-05-03
- [ ] Deleted item #hidden-internal-deleted @2026-05-04
- [ ] User-hidden #hidden @2026-05-05
- [ ] [Real link](https://real.example.com \"bm-real\")
- [ ] [Hidden link](https://hidden.example.com \"bm-hidden-link\") #hidden
";
        let board_path = tmp.join("hidden-board.md");
        std::fs::write(&board_path, BOARD).unwrap();
        let state = crate::test_helpers::test_state(tmp);
        let board_id = state.storage.add_board(&board_path).unwrap();
        (state, board_id)
    }

    #[tokio::test]
    async fn export_ical_feed_excludes_hidden_column_and_cards() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_hidden_feed_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(get_request(&format!(
                "/boards/{}/export/ical",
                board_id
            )))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let (_, body) = response_text(resp).await;

        // Kept: public + regular cards that have dates
        assert!(body.contains("Public meeting"), "expected 'Public meeting' in:\n{}", body);
        assert!(body.contains("Regular card"), "expected 'Regular card' in:\n{}", body);

        // Dropped: entire hidden column's cards
        assert!(
            !body.contains("Secret event"),
            "hidden-column card leaked into iCal:\n{}",
            body
        );

        // Dropped: individually tagged cards
        assert!(!body.contains("Parked item"), "parked card leaked");
        assert!(!body.contains("Archived item"), "archived card leaked");
        assert!(!body.contains("Deleted item"), "deleted card leaked");
        assert!(!body.contains("User-hidden"), "#hidden card leaked");

        // Post-filter VEVENT count: 2 (Public meeting + Regular card)
        assert_eq!(
            body.matches("BEGIN:VEVENT").count(),
            2,
            "expected exactly 2 VEVENTs after filtering, body:\n{}",
            body
        );
    }

    #[tokio::test]
    async fn export_xbel_feed_excludes_hidden_column_and_cards() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_hidden_feed_board(tmp.path());

        let app = test_router(state);
        let resp = app
            .oneshot(get_request(&format!(
                "/boards/{}/export/xbel",
                board_id
            )))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let (_, body) = response_text(resp).await;

        // Kept: bookmarks in public columns and the real link in Mixed
        assert!(body.contains("https://public.example.com"), "public link missing:\n{}", body);
        assert!(body.contains("https://real.example.com"), "real link missing:\n{}", body);
        assert!(body.contains("bm-public"));
        assert!(body.contains("bm-real"));

        // Dropped: everything behind a hidden column or tag
        assert!(
            !body.contains("https://secret.example.com"),
            "hidden-column bookmark leaked into XBEL:\n{}",
            body
        );
        assert!(
            !body.contains("https://hidden.example.com"),
            "#hidden-tagged bookmark leaked into XBEL:\n{}",
            body
        );
        assert!(!body.contains("bm-secret"));
        assert!(!body.contains("bm-hidden-link"));

        // The entire "Hidden Column" folder should not appear.
        assert!(
            !body.contains("Hidden Column"),
            "hidden column title leaked into XBEL:\n{}",
            body
        );
    }

    #[tokio::test]
    async fn feed_default_exclude_tags_covers_all_hidden_markers() {
        let tags = feed_default_exclude_tags();
        assert!(tags.iter().any(|t| t == "#hidden"));
        assert!(tags.iter().any(|t| t == lexera_core::types::HIDDEN_TAG_DELETED));
        assert!(tags.iter().any(|t| t == lexera_core::types::HIDDEN_TAG_ARCHIVED));
        assert!(tags.iter().any(|t| t == lexera_core::types::HIDDEN_TAG_PARKED));
        assert!(tags.iter().any(|t| t == lexera_core::types::HIDDEN_TAG_INCOMING));
    }

    // -------------------------------------------------------------------
    // Filename sanitation (unit)
    // -------------------------------------------------------------------

    #[test]
    fn sanitize_filename_keeps_safe_chars() {
        assert_eq!(sanitize_filename("my-board_1.2", "fallback"), "my-board_1.2");
    }

    #[test]
    fn sanitize_filename_collapses_unsafe_chars() {
        assert_eq!(
            sanitize_filename("Project / 2026 ☆", "fallback"),
            "Project___2026"
        );
    }

    #[test]
    fn sanitize_filename_falls_back_when_empty() {
        assert_eq!(sanitize_filename("", "board-123"), "board-123");
        assert_eq!(sanitize_filename("☆☆☆", "board-456"), "board-456");
    }
}
