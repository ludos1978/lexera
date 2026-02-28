use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Internal tags applied by the kanban board to mark hidden items.
pub const HIDDEN_TAG_PARKED: &str = "#hidden-internal-parked";
pub const HIDDEN_TAG_DELETED: &str = "#hidden-internal-deleted";
pub const HIDDEN_TAG_ARCHIVED: &str = "#hidden-internal-archived";

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncludeSource {
    pub raw_path: String,
    #[serde(skip)]
    pub resolved_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanColumn {
    pub id: String,
    pub title: String,
    pub cards: Vec<KanbanCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_source: Option<IncludeSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanStack {
    pub id: String,
    pub title: String,
    pub columns: Vec<KanbanColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanRow {
    pub id: String,
    pub title: String,
    pub stacks: Vec<KanbanStack>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_width: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanBoard {
    pub valid: bool,
    pub title: String,
    pub columns: Vec<KanbanColumn>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<KanbanRow>,
    pub yaml_header: Option<String>,
    pub kanban_footer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_settings: Option<BoardSettings>,
}

impl KanbanBoard {
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_overdue: bool,
}

/// The YAML setting keys recognized by the board format.
/// Order matters — this determines output order in generated YAML.
pub const BOARD_SETTING_KEYS: &[&str] = &[
    "columnWidth",
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
];

impl BoardSettings {
    /// Get a setting value by its YAML key name (camelCase).
    pub fn get_by_key(&self, key: &str) -> Option<String> {
        match key {
            "columnWidth" => self.column_width.clone(),
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
            _ => None,
        }
    }

    /// Set a setting value by its YAML key name (camelCase).
    pub fn set_by_key(&mut self, key: &str, value: &str) {
        match key {
            "columnWidth" => self.column_width = Some(value.to_string()),
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
            _ => {}
        }
    }
}
