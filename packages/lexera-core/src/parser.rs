/// Lightweight markdown parser for Kanban boards.
///
/// Handles the core format:
///   --- YAML header (must contain kanban-plugin: board) ---
///   ## Column Title
///   - [ ] Task summary
///     description line
///   %% footer %%
///
/// Line-by-line port of packages/shared/src/markdownParser.ts.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::include::slide_parser;
use crate::include::syntax;
use crate::include::resolver::resolve_include_path;
use crate::merge::card_identity;
use crate::types::{
    BoardSettings, IncludeSource, KanbanBoard, KanbanCard, KanbanColumn, BOARD_SETTING_KEYS,
};

/// Context for parsing boards with include file support.
pub struct ParseContext {
    /// raw_path (as written in markdown) -> file content
    pub include_contents: HashMap<String, String>,
    /// Directory containing the main board file
    pub board_dir: std::path::PathBuf,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn generate_id(prefix: &str) -> String {
    let seq = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}-{}-{:x}", prefix, seq, ts)
}

/// Parse kanban markdown content into a board structure.
pub fn parse_markdown(content: &str) -> KanbanBoard {
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = content.split('\n').collect();

    let mut board = KanbanBoard {
        valid: false,
        title: String::new(),
        columns: Vec::new(),
        yaml_header: None,
        kanban_footer: None,
        board_settings: None,
    };

    let mut current_column: Option<KanbanColumn> = None;
    let mut current_task: Option<KanbanCard> = None;
    let mut collecting_description = false;
    let mut in_yaml_header = false;
    let mut in_kanban_footer = false;
    let mut yaml_lines: Vec<&str> = Vec::new();
    let mut footer_lines: Vec<&str> = Vec::new();
    let mut yaml_start_found = false;

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // Handle YAML front matter
        if line.starts_with("---") {
            if !yaml_start_found {
                yaml_start_found = true;
                in_yaml_header = true;
                yaml_lines.push(line);
                i += 1;
                continue;
            } else if in_yaml_header {
                yaml_lines.push(line);
                let header = yaml_lines.join("\n");
                board.valid = header.contains("kanban-plugin: board");
                board.yaml_header = Some(header);
                if !board.valid {
                    return board;
                }
                in_yaml_header = false;
                i += 1;
                continue;
            }
        }

        if in_yaml_header {
            yaml_lines.push(line);
            i += 1;
            continue;
        }

        // Handle Kanban footer
        if line.starts_with("%%") {
            if collecting_description {
                if let (Some(task), Some(col)) =
                    (current_task.take(), current_column.as_mut())
                {
                    col.cards.push(task);
                }
                collecting_description = false;
            }
            in_kanban_footer = true;
            footer_lines.push(line);
            i += 1;
            continue;
        }

        if in_kanban_footer {
            footer_lines.push(line);
            i += 1;
            continue;
        }

        // Parse column header
        if line.starts_with("## ") {
            if collecting_description {
                if let (Some(task), Some(col)) =
                    (current_task.take(), current_column.as_mut())
                {
                    col.cards.push(task);
                }
                collecting_description = false;
            }
            current_task = None;
            if let Some(col) = current_column.take() {
                board.columns.push(col);
            }

            let column_title = &line[3..];
            current_column = Some(KanbanColumn {
                id: generate_id("col"),
                title: column_title.to_string(),
                cards: Vec::new(),
                include_source: None,
            });
            i += 1;
            continue;
        }

        // Parse task
        if line.starts_with("- ") {
            if collecting_description {
                if let (Some(task), Some(col)) =
                    (current_task.take(), current_column.as_mut())
                {
                    col.cards.push(task);
                }
                collecting_description = false;
            }

            if current_column.is_some() {
                let checked = line.starts_with("- [x] ") || line.starts_with("- [X] ");
                let task_summary = if line.len() >= 6 { &line[6..] } else { "" };
                let kid = card_identity::extract_kid(task_summary);
                current_task = Some(KanbanCard {
                    id: generate_id("task"),
                    content: task_summary.to_string(),
                    checked,
                    kid,
                });
                collecting_description = true;
            }
            i += 1;
            continue;
        }

        // Collect description lines
        if current_task.is_some() && collecting_description {
            if trimmed.is_empty() && !line.starts_with("  ") {
                // Check if next non-empty line is a structural boundary
                let mut next_index = i + 1;
                while next_index < lines.len() && lines[next_index].trim().is_empty() {
                    next_index += 1;
                }
                let next_line = if next_index < lines.len() {
                    Some(lines[next_index])
                } else {
                    None
                };
                let is_structural_boundary = next_line.is_none()
                    || next_line.unwrap().starts_with("## ")
                    || next_line.unwrap().starts_with("- ")
                    || next_line.unwrap().starts_with("%%")
                    || next_line.unwrap().starts_with("---");
                if is_structural_boundary {
                    i += 1;
                    continue;
                }
            }
            let desc_line = if line.starts_with("  ") { &line[2..] } else { line };
            if let Some(task) = current_task.as_mut() {
                task.content.push('\n');
                task.content.push_str(desc_line);
            }
            i += 1;
            continue;
        }

        if trimmed.is_empty() {
            i += 1;
            continue;
        }

        i += 1;
    }

    // Finalize last task and column
    if collecting_description {
        if let (Some(task), Some(col)) = (current_task.take(), current_column.as_mut()) {
            col.cards.push(task);
        }
    }
    if let Some(col) = current_column.take() {
        board.columns.push(col);
    }

    if !footer_lines.is_empty() {
        board.kanban_footer = Some(footer_lines.join("\n"));
    }

    board.board_settings = Some(parse_board_settings(
        board.yaml_header.as_deref().unwrap_or(""),
    ));

    board
}

/// Parse kanban markdown with include file support.
/// Include columns get their cards from the referenced include files (slide format)
/// instead of from inline task lines in the main markdown.
pub fn parse_markdown_with_includes(content: &str, ctx: &ParseContext) -> KanbanBoard {
    let mut board = parse_markdown(content);

    for col in &mut board.columns {
        if let Some(raw_path) = syntax::extract_include_path(&col.title) {
            let resolved = resolve_include_path(&raw_path, &ctx.board_dir);
            let tags = syntax::strip_include(&col.title);

            col.include_source = Some(IncludeSource {
                raw_path: raw_path.clone(),
                resolved_path: resolved,
            });

            // Load cards from include file content
            if let Some(include_content) = ctx.include_contents.get(&raw_path) {
                col.cards = slide_parser::parse_slides(include_content);
            } else {
                log::warn!("[lexera.parser.include] Include file not found in context: {}", raw_path);
                col.cards = Vec::new();
            }

            // Keep tags in the title for display purposes
            if !tags.trim().is_empty() {
                col.title = format!("!!!include({})!!!{}", raw_path, tags);
            }
        }
    }

    board
}

/// Generate markdown from a board structure.
/// For columns with include_source, only the column header is written (no inline cards).
pub fn generate_markdown(board: &KanbanBoard) -> String {
    let mut markdown = String::new();

    if board.yaml_header.is_some() || board.board_settings.is_some() {
        let updated_yaml = update_yaml_with_board_settings(
            board.yaml_header.as_deref(),
            board.board_settings.as_ref().cloned().unwrap_or_default(),
        );
        markdown.push_str(&updated_yaml);
        markdown.push_str("\n\n");
    }

    for column in &board.columns {
        markdown.push_str(&format!("## {}\n", column.title));

        // Include columns: cards live in the include file, not in the main markdown
        if column.include_source.is_some() {
            markdown.push('\n');
            continue;
        }

        for task in &column.cards {
            let normalized = task.content.replace("\r\n", "\n").replace('\r', "\n");
            let content_lines: Vec<&str> = normalized.split('\n').collect();
            let summary = content_lines.first().copied().unwrap_or("");

            let checkbox = if task.checked { "- [x] " } else { "- [ ] " };
            markdown.push_str(checkbox);
            markdown.push_str(summary);
            markdown.push('\n');

            if content_lines.len() > 1 {
                for line in &content_lines[1..] {
                    markdown.push_str("  ");
                    markdown.push_str(line);
                    markdown.push('\n');
                }
            }
        }

        markdown.push('\n');
    }

    if let Some(footer) = &board.kanban_footer {
        if markdown.ends_with("\n\n") {
            markdown.pop();
        }
        markdown.push_str(footer);
        if !footer.ends_with('\n') {
            markdown.push('\n');
        }
    } else {
        markdown.push('\n');
    }

    markdown
}

/// Parse board settings from a YAML header string.
pub fn parse_board_settings(yaml_header: &str) -> BoardSettings {
    let mut settings = BoardSettings::default();
    if yaml_header.is_empty() {
        return settings;
    }

    for line in yaml_header.lines() {
        // Match key: value lines
        if let Some(colon_pos) = line.find(':') {
            let key = line[..colon_pos].trim();
            let value = line[colon_pos + 1..].trim();

            if !BOARD_SETTING_KEYS.contains(&key) || value.is_empty() {
                continue;
            }

            settings.set_by_key(key, value);
        }
    }

    settings
}

/// Update or create a YAML header with board settings.
pub fn update_yaml_with_board_settings(
    yaml_header: Option<&str>,
    settings: BoardSettings,
) -> String {
    let yaml_header = match yaml_header {
        Some(h) if !h.is_empty() => h,
        _ => {
            // No existing header — build from scratch
            let mut yaml = String::from("---\nkanban-plugin: board\n");
            for key in BOARD_SETTING_KEYS {
                if let Some(value) = settings.get_by_key(key) {
                    yaml.push_str(&format!("{}: {}\n", key, value));
                }
            }
            yaml.push_str("---");
            return yaml;
        }
    };

    let lines: Vec<&str> = yaml_header.split('\n').collect();
    let mut result: Vec<String> = Vec::new();
    let mut remaining_settings = settings;

    for line in &lines {
        // Check if this is a setting line
        if let Some(colon_pos) = line.find(':') {
            let key = line[..colon_pos].trim();
            if BOARD_SETTING_KEYS.contains(&key) {
                if let Some(value) = remaining_settings.get_by_key(key) {
                    result.push(format!("{}: {}", key, value));
                    // Clear it so we don't add it again
                    clear_setting(&mut remaining_settings, key);
                } else {
                    result.push(line.to_string());
                }
                continue;
            }
        }
        result.push(line.to_string());
    }

    // Find closing --- and insert remaining settings before it
    if let Some(closing_index) = result.iter().rposition(|l| l.trim() == "---") {
        if closing_index > 0 {
            let mut new_settings: Vec<String> = Vec::new();
            for key in BOARD_SETTING_KEYS {
                if let Some(value) = remaining_settings.get_by_key(key) {
                    new_settings.push(format!("{}: {}", key, value));
                }
            }
            if !new_settings.is_empty() {
                for (j, s) in new_settings.into_iter().enumerate() {
                    result.insert(closing_index + j, s);
                }
            }
        }
    }

    result.join("\n")
}

/// Clear a setting field after it's been written.
fn clear_setting(settings: &mut BoardSettings, key: &str) {
    match key {
        "columnWidth" => settings.column_width = None,
        "layoutRows" => settings.layout_rows = None,
        "maxRowHeight" => settings.max_row_height = None,
        "rowHeight" => settings.row_height = None,
        "layoutPreset" => settings.layout_preset = None,
        "stickyStackMode" => settings.sticky_stack_mode = None,
        "tagVisibility" => settings.tag_visibility = None,
        "cardMinHeight" => settings.card_min_height = None,
        "fontSize" => settings.font_size = None,
        "fontFamily" => settings.font_family = None,
        "whitespace" => settings.whitespace = None,
        "htmlCommentRenderMode" => settings.html_comment_render_mode = None,
        "htmlContentRenderMode" => settings.html_content_render_mode = None,
        "arrowKeyFocusScroll" => settings.arrow_key_focus_scroll = None,
        "boardColor" => settings.board_color = None,
        "boardColorDark" => settings.board_color_dark = None,
        "boardColorLight" => settings.board_color_light = None,
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_BOARD: &str = "\
---
kanban-plugin: board
columnWidth: 450px
---

## Todo
- [ ] First task
- [x] Completed task
  with description

## Done
- [x] Finished item

%% kanban:settings
```
```
%%
";

    #[test]
    fn test_parse_basic_board() {
        let board = parse_markdown(SAMPLE_BOARD);
        assert!(board.valid);
        assert_eq!(board.columns.len(), 2);
        assert_eq!(board.columns[0].title, "Todo");
        assert_eq!(board.columns[0].cards.len(), 2);
        assert!(!board.columns[0].cards[0].checked);
        assert_eq!(board.columns[0].cards[0].content, "First task");
        assert!(board.columns[0].cards[1].checked);
        assert_eq!(board.columns[0].cards[1].content, "Completed task\nwith description");
        assert_eq!(board.columns[1].title, "Done");
        assert_eq!(board.columns[1].cards.len(), 1);
        assert!(board.kanban_footer.is_some());
    }

    #[test]
    fn test_parse_invalid_board() {
        let board = parse_markdown("---\ntitle: not a kanban\n---\n## Col\n- [ ] task");
        assert!(!board.valid);
    }

    #[test]
    fn test_parse_board_settings() {
        let settings = parse_board_settings("---\nkanban-plugin: board\ncolumnWidth: 450px\nlayoutRows: 3\n---");
        assert_eq!(settings.column_width.as_deref(), Some("450px"));
        assert_eq!(settings.layout_rows, Some(3));
    }

    #[test]
    fn test_roundtrip() {
        let board = parse_markdown(SAMPLE_BOARD);
        let regenerated = generate_markdown(&board);
        let reparsed = parse_markdown(&regenerated);

        assert!(reparsed.valid);
        assert_eq!(reparsed.columns.len(), board.columns.len());
        for (orig, re) in board.columns.iter().zip(reparsed.columns.iter()) {
            assert_eq!(orig.title, re.title);
            assert_eq!(orig.cards.len(), re.cards.len());
            for (oc, rc) in orig.cards.iter().zip(re.cards.iter()) {
                assert_eq!(oc.content, rc.content);
                assert_eq!(oc.checked, rc.checked);
            }
        }
        assert_eq!(board.kanban_footer, reparsed.kanban_footer);
    }

    #[test]
    fn test_update_yaml_no_existing_header() {
        let mut settings = BoardSettings::default();
        settings.column_width = Some("300px".to_string());
        let yaml = update_yaml_with_board_settings(None, settings);
        assert!(yaml.contains("kanban-plugin: board"));
        assert!(yaml.contains("columnWidth: 300px"));
    }

    #[test]
    fn test_update_yaml_existing_header() {
        let header = "---\nkanban-plugin: board\ncolumnWidth: 450px\n---";
        let mut settings = BoardSettings::default();
        settings.column_width = Some("300px".to_string());
        let updated = update_yaml_with_board_settings(Some(header), settings);
        assert!(updated.contains("columnWidth: 300px"));
        assert!(!updated.contains("columnWidth: 450px"));
    }

    #[test]
    fn test_empty_board() {
        let board = parse_markdown("---\nkanban-plugin: board\n---\n");
        assert!(board.valid);
        assert_eq!(board.columns.len(), 0);
    }

    #[test]
    fn test_description_with_blank_lines() {
        let md = "---\nkanban-plugin: board\n---\n\n## Col\n- [ ] Task\n  line1\n  line2\n\n## Next\n";
        let board = parse_markdown(md);
        assert_eq!(board.columns[0].cards[0].content, "Task\nline1\nline2");
    }
}
