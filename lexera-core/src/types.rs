use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Indicates whether the board was parsed from legacy (## columns) or new (# / ## / ### hierarchy) format.
/// Used by `generate_markdown()` to preserve round-trip fidelity: legacy boards are written back
/// with `## Column` headings, new-format boards with `# Row` / `## Stack` / `### Column`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BoardFormat {
    /// Legacy flat format: `## Column Title` at heading level 2.
    /// Internally stored as a single Default row / Default stack wrapping the columns.
    #[default]
    Legacy,
    /// Hierarchical format: `# Row` / `## Stack` / `### Column`.
    New,
}

/// Internal tags applied by the kanban board to mark hidden items.
pub const HIDDEN_TAG_PARKED: &str = "#hidden-internal-parked";
pub const HIDDEN_TAG_DELETED: &str = "#hidden-internal-deleted";
pub const HIDDEN_TAG_ARCHIVED: &str = "#hidden-internal-archived";
pub const HIDDEN_TAG_INCOMING: &str = "#hidden-internal-incoming";

/// Check whether a text block is archived or deleted.
/// Parked items are NOT excluded — they are temporarily hidden
/// from the board view but still active.
pub fn is_archived_or_deleted(text: &str) -> bool {
    text.contains(HIDDEN_TAG_DELETED) || text.contains(HIDDEN_TAG_ARCHIVED)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KanbanCard {
    pub id: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub checked: bool,
    /// Persistent card identity for merge and sync support (8 hex chars).
    /// Legacy markdown may still contain a `<!-- kid:xxxx -->` marker, but the
    /// identifier is kept internal and no longer written into card content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kid: Option<String>,
    /// Inline parameters from `{key:value, ...}` blocks in the task line.
    /// Used for canvas layout (e.g. `span`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub params: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncludeSource {
    pub raw_path: String,
    #[serde(skip)]
    pub resolved_path: PathBuf,
    /// True when the include file could not be read (missing, permission error, etc.)
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub missing: bool,
}

impl IncludeSource {
    pub fn new(raw_path: String, resolved_path: PathBuf) -> Self {
        Self { raw_path, resolved_path, missing: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanColumn {
    pub id: String,
    pub title: String,
    pub cards: Vec<KanbanCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_source: Option<IncludeSource>,
    /// Inline parameters from `{key:value, ...}` blocks in the column heading.
    /// Used for canvas layout (e.g. `w` weight).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub params: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanStack {
    pub id: String,
    pub title: String,
    pub columns: Vec<KanbanColumn>,
    /// Inline parameters from `{key:value, ...}` blocks in the stack heading.
    /// Used for canvas layout (e.g. `x`, `y`, `w`, `h`, `dir`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub params: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanRow {
    pub id: String,
    pub title: String,
    pub stacks: Vec<KanbanStack>,
    /// Inline parameters from `{key:value, ...}` blocks in the row heading.
    /// Used for canvas layout (e.g. `h` height).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub params: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_width: Option<String>,
    /// Default stack width in kanban mode (px). Per-stack #width{N} overrides this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_width: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_rows: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_row_height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_height: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sticky_stack_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_min_height: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub whitespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_comment_render_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_content_render_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrow_key_focus_scroll: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_color_dark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_color_light: Option<String>,
    /// Board layout mode: "kanban" (default sequential flow) or "canvas" (free positioning).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_layout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas_surface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas_grid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas_page_size: Option<String>,
}

/// Generation metadata for staleness detection.
/// Persisted in YAML front matter alongside board settings.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependency_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub writer_id: Option<String>,
}

/// The YAML keys for generation metadata. Order determines output order.
pub const GENERATION_META_KEYS: &[&str] = &[
    "generation",
    "contentHash",
    "dependencyHash",
    "resolvedHash",
    "writerId",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanBoard {
    pub valid: bool,
    pub title: String,
    /// Legacy flat columns. After parser consolidation this is only populated by
    /// code that constructs boards programmatically (CRDT bridge, merge, tests).
    /// The parser always populates `rows` instead, wrapping legacy columns in a
    /// Default row / Default stack.
    pub columns: Vec<KanbanColumn>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<KanbanRow>,
    pub yaml_header: Option<String>,
    pub kanban_footer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_settings: Option<BoardSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation_meta: Option<GenerationMeta>,
    /// Tracks the original markdown format for round-trip fidelity.
    /// Defaults to Legacy when not set (e.g. programmatically constructed boards).
    #[serde(default = "default_board_format")]
    pub format_hint: BoardFormat,
}

/// Default board format for serde deserialization.
fn default_board_format() -> BoardFormat {
    BoardFormat::Legacy
}

impl KanbanBoard {
    /// Returns true when the board carries an explicit row/stack hierarchy that
    /// cannot be faithfully represented by the legacy flat-column markdown format.
    pub fn has_explicit_hierarchy(&self) -> bool {
        if self.rows.is_empty() {
            return false;
        }
        if self.rows.len() != 1 {
            return true;
        }
        let row = &self.rows[0];
        if row.title != "Default" {
            return true;
        }
        if row.stacks.len() != 1 {
            return true;
        }
        row.stacks[0].title != "Default"
    }

    /// Promotes stale legacy format hints when the board already contains an
    /// explicit row/stack hierarchy.
    pub fn reconcile_format_hint(&mut self) {
        if self.has_explicit_hierarchy() {
            self.format_hint = BoardFormat::New;
        }
    }

    /// Get all columns from the board, regardless of format.
    /// For new format: flattens rows→stacks→columns.
    /// For legacy format: returns columns directly.
    pub fn all_columns(&self) -> Vec<&KanbanColumn> {
        if !self.rows.is_empty() {
            self.rows
                .iter()
                .flat_map(|row| row.stacks.iter())
                .flat_map(|stack| stack.columns.iter())
                .collect()
        } else {
            self.columns.iter().collect()
        }
    }

    /// Get a mutable reference to all columns, regardless of format.
    pub fn all_columns_mut(&mut self) -> Vec<&mut KanbanColumn> {
        if !self.rows.is_empty() {
            self.rows
                .iter_mut()
                .flat_map(|row| row.stacks.iter_mut())
                .flat_map(|stack| stack.columns.iter_mut())
                .collect()
        } else {
            self.columns.iter_mut().collect()
        }
    }

    /// Total number of cards across all columns (rows + flat columns).
    pub fn total_card_count(&self) -> usize {
        self.all_columns().iter().map(|col| col.cards.len()).sum()
    }

    pub fn revision_token(&self) -> Option<String> {
        self.generation_meta
            .as_ref()
            .and_then(GenerationMeta::revision_token)
    }
}

impl GenerationMeta {
    pub fn revision_token(&self) -> Option<String> {
        let generation = self.generation?;
        let hash = self
            .resolved_hash
            .as_deref()
            .or(self.content_hash.as_deref())?;
        Some(format!("g{}-{}", generation, hash))
    }
}

/// Summary info for a board in list responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub last_modified: String,
    pub columns: Vec<ColumnSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_settings: Option<BoardSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSummary {
    pub index: usize,
    pub title: String,
    pub card_count: usize,
}

/// A search result entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub board_id: String,
    pub board_title: String,
    pub column_title: String,
    pub column_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col_local_index: Option<usize>,
    pub card_id: String,
    pub card_content: String,
    pub checked: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hash_tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub temporal_tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_overdue: bool,
}

/// Paginated search results with total count for the full (unpaginated) result set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedSearchResults {
    pub results: Vec<SearchResult>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

/// A paginated group of calendar tasks with total count.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedCalendarGroup {
    pub items: Vec<SearchResult>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

/// Calendar tasks grouped by time period, matching the dashboard UI structure.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupedCalendarTasks {
    pub overdue: PaginatedCalendarGroup,
    pub today: PaginatedCalendarGroup,
    pub this_week: PaginatedCalendarGroup,
    pub upcoming: PaginatedCalendarGroup,
    pub later: PaginatedCalendarGroup,
}

impl GroupedCalendarTasks {
    /// Group flat calendar tasks into time buckets.
    /// `today_str` is YYYY-MM-DD for today.
    /// `end_of_week_str` is YYYY-MM-DD for the last day of the current week.
    /// `two_weeks_str` is YYYY-MM-DD for 14 days from now.
    /// `limit` optionally caps the number of items returned per group.
    /// `truncate` optionally caps `card_content` to that many chars.
    pub fn from_tasks(
        tasks: Vec<SearchResult>,
        today_str: &str,
        end_of_week_str: &str,
        two_weeks_str: &str,
        limit: Option<usize>,
        offset: Option<usize>,
        truncate: Option<usize>,
    ) -> Self {
        let mut overdue = Vec::new();
        let mut today = Vec::new();
        let mut this_week = Vec::new();
        let mut upcoming = Vec::new();
        let mut later = Vec::new();

        for task in tasks {
            if task.checked {
                continue;
            }
            let due = task.due_date.as_deref().unwrap_or("");
            if due.is_empty() {
                continue;
            }
            if task.is_overdue {
                overdue.push(task);
            } else if due == today_str {
                today.push(task);
            } else if due <= end_of_week_str {
                this_week.push(task);
            } else if due <= two_weeks_str {
                upcoming.push(task);
            } else {
                later.push(task);
            }
        }

        fn make_group(
            items: Vec<SearchResult>,
            limit: Option<usize>,
            offset: Option<usize>,
            truncate: Option<usize>,
        ) -> PaginatedCalendarGroup {
            let total = items.len();
            let offset = offset.unwrap_or(0);
            let limit = limit.unwrap_or(total.saturating_sub(offset));
            let mut capped = items
                .into_iter()
                .skip(offset)
                .take(limit)
                .collect::<Vec<_>>();
            if let Some(max_chars) = truncate {
                for r in &mut capped {
                    if r.card_content.len() > max_chars {
                        let end = r.card_content.floor_char_boundary(max_chars);
                        r.card_content.truncate(end);
                        r.card_content.push('…');
                    }
                }
            }
            PaginatedCalendarGroup {
                items: capped,
                total,
                limit,
                offset,
            }
        }

        Self {
            overdue: make_group(overdue, limit, offset, truncate),
            today: make_group(today, limit, offset, truncate),
            this_week: make_group(this_week, limit, offset, truncate),
            upcoming: make_group(upcoming, limit, offset, truncate),
            later: make_group(later, limit, offset, truncate),
        }
    }
}

/// The YAML setting keys recognized by the board format.
/// Order matters — this determines output order in generated YAML.
pub const BOARD_SETTING_KEYS: &[&str] = &[
    "columnWidth",
    "stackWidth",
    "layoutRows",
    "maxRowHeight",
    "rowHeight",
    "layoutPreset",
    "stickyStackMode",
    "tagVisibility",
    "cardMinHeight",
    "fontSize",
    "fontFamily",
    "whitespace",
    "htmlCommentRenderMode",
    "htmlContentRenderMode",
    "arrowKeyFocusScroll",
    "boardColor",
    "boardColorDark",
    "boardColorLight",
    "boardLayout",
    "canvasSurface",
    "canvasGrid",
    "canvasPageSize",
];

impl BoardSettings {
    /// Get a setting value by its YAML key name (camelCase).
    pub fn get_by_key(&self, key: &str) -> Option<String> {
        match key {
            "columnWidth" => self.column_width.clone(),
            "stackWidth" => self.stack_width.clone(),
            "layoutRows" => self.layout_rows.map(|v| v.to_string()),
            "maxRowHeight" => self.max_row_height.map(|v| v.to_string()),
            "rowHeight" => self.row_height.clone(),
            "layoutPreset" => self.layout_preset.clone(),
            "stickyStackMode" => self.sticky_stack_mode.clone(),
            "tagVisibility" => self.tag_visibility.clone(),
            "cardMinHeight" => self.card_min_height.clone(),
            "fontSize" => self.font_size.clone(),
            "fontFamily" => self.font_family.clone(),
            "whitespace" => self.whitespace.clone(),
            "htmlCommentRenderMode" => self.html_comment_render_mode.clone(),
            "htmlContentRenderMode" => self.html_content_render_mode.clone(),
            "arrowKeyFocusScroll" => self.arrow_key_focus_scroll.clone(),
            "boardColor" => self.board_color.clone(),
            "boardColorDark" => self.board_color_dark.clone(),
            "boardColorLight" => self.board_color_light.clone(),
            "boardLayout" => self.board_layout.clone(),
            "canvasSurface" => self.canvas_surface.clone(),
            "canvasGrid" => self.canvas_grid.clone(),
            "canvasPageSize" => self.canvas_page_size.clone(),
            _ => None,
        }
    }

    /// Set a setting value by its YAML key name (camelCase).
    pub fn set_by_key(&mut self, key: &str, value: &str) {
        match key {
            "columnWidth" => self.column_width = Some(value.to_string()),
            "stackWidth" => self.stack_width = Some(value.to_string()),
            "layoutRows" => {
                if let Ok(n) = value.parse::<f64>() {
                    if n.is_finite() && n >= 1.0 {
                        self.layout_rows = Some(n.floor() as u32);
                    }
                }
            }
            "maxRowHeight" => {
                if let Ok(n) = value.parse::<f64>() {
                    if n.is_finite() && n >= 0.0 {
                        self.max_row_height = Some(n.floor() as u32);
                    }
                }
            }
            "rowHeight" => self.row_height = Some(value.to_string()),
            "layoutPreset" => self.layout_preset = Some(value.to_string()),
            "stickyStackMode" => self.sticky_stack_mode = Some(value.to_string()),
            "tagVisibility" => self.tag_visibility = Some(value.to_string()),
            "cardMinHeight" => self.card_min_height = Some(value.to_string()),
            "fontSize" => self.font_size = Some(value.to_string()),
            "fontFamily" => self.font_family = Some(value.to_string()),
            "whitespace" => self.whitespace = Some(value.to_string()),
            "htmlCommentRenderMode" => self.html_comment_render_mode = Some(value.to_string()),
            "htmlContentRenderMode" => self.html_content_render_mode = Some(value.to_string()),
            "arrowKeyFocusScroll" => self.arrow_key_focus_scroll = Some(value.to_string()),
            "boardColor" => self.board_color = Some(value.to_string()),
            "boardColorDark" => self.board_color_dark = Some(value.to_string()),
            "boardColorLight" => self.board_color_light = Some(value.to_string()),
            "boardLayout" => self.board_layout = Some(value.to_string()),
            "canvasSurface" => self.canvas_surface = Some(value.to_string()),
            "canvasGrid" => self.canvas_grid = Some(value.to_string()),
            "canvasPageSize" => self.canvas_page_size = Some(value.to_string()),
            _ => {}
        }
    }

    /// Merge `incoming` into `self`, overwriting only fields that are `Some` in `incoming`.
    pub fn merge_from(&mut self, incoming: BoardSettings) {
        macro_rules! merge_option {
            ($($field:ident),+ $(,)?) => {
                $(if incoming.$field.is_some() { self.$field = incoming.$field; })+
            };
        }
        merge_option!(
            column_width,
            stack_width,
            layout_rows,
            max_row_height,
            row_height,
            layout_preset,
            sticky_stack_mode,
            tag_visibility,
            card_min_height,
            font_size,
            font_family,
            whitespace,
            html_comment_render_mode,
            html_content_render_mode,
            arrow_key_focus_scroll,
            board_color,
            board_color_dark,
            board_color_light,
            board_layout,
            canvas_surface,
            canvas_grid,
            canvas_page_size,
        );
    }
}
