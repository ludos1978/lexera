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

use crate::include::resolver::resolve_include_path;
use crate::include::slide_parser;
use crate::include::syntax;
use crate::merge::card_identity;
use crate::types::{
    BoardSettings, IncludeSource, KanbanBoard, KanbanCard, KanbanColumn, KanbanRow, KanbanStack,
    BOARD_SETTING_KEYS,
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
        rows: Vec::new(),
        yaml_header: None,
        kanban_footer: None,
        board_settings: None,
    };

    // First pass: detect format by scanning for h1 headings (# but not ## or ###)
    // We must skip YAML header and footer regions
    let new_format = detect_new_format(&lines);

    if new_format {
        parse_new_format(&lines, &mut board);
    } else {
        parse_legacy_format(&lines, &mut board);
    }

    board.board_settings = Some(parse_board_settings(
        board.yaml_header.as_deref().unwrap_or(""),
    ));

    board
}

/// Detect whether content uses the new h1/h2/h3 hierarchy format.
/// Returns true if any `# ` (h1, not h2/h3) heading is found outside YAML/footer.
fn detect_new_format(lines: &[&str]) -> bool {
    let mut in_yaml = false;
    let mut yaml_start_found = false;
    let mut in_footer = false;

    for line in lines {
        if line.starts_with("---") {
            if !yaml_start_found {
                yaml_start_found = true;
                in_yaml = true;
                continue;
            } else if in_yaml {
                in_yaml = false;
                continue;
            }
        }
        if in_yaml {
            continue;
        }
        if line.starts_with("%%") {
            in_footer = true;
            continue;
        }
        if in_footer {
            continue;
        }

        // h1 heading: starts with "# " but NOT "## " or "### "
        if line.starts_with("# ") && !line.starts_with("## ") {
            return true;
        }
    }
    false
}

/// Finalize current task into current column if both exist.
fn finalize_task(
    current_task: &mut Option<KanbanCard>,
    current_column: &mut Option<KanbanColumn>,
    collecting_description: &mut bool,
) {
    if *collecting_description {
        if let (Some(task), Some(col)) = (current_task.take(), current_column.as_mut()) {
            col.cards.push(task);
        }
        *collecting_description = false;
    }
    *current_task = None;
}

/// Parse a task line (- [ ] or - [x]) and return the card and whether we're collecting description.
fn parse_task_line(line: &str) -> Option<KanbanCard> {
    if !line.starts_with("- ") {
        return None;
    }
    let checked = line.starts_with("- [x] ") || line.starts_with("- [X] ");
    let task_summary = if line.len() >= 6 { &line[6..] } else { "" };
    let kid = card_identity::extract_kid(task_summary);
    Some(KanbanCard {
        id: generate_id("task"),
        content: card_identity::strip_kid(task_summary),
        checked,
        kid,
    })
}

/// Check if a blank line during description collection is a structural boundary.
fn is_description_boundary(lines: &[&str], i: usize, new_format: bool) -> bool {
    let mut next_index = i + 1;
    while next_index < lines.len() && lines[next_index].trim().is_empty() {
        next_index += 1;
    }
    let next_line = if next_index < lines.len() {
        lines[next_index]
    } else {
        return true;
    };
    next_line.starts_with("- ")
        || next_line.starts_with("%%")
        || next_line.starts_with("---")
        || (new_format
            && ((next_line.starts_with("# ") && !next_line.starts_with("## "))
                || (next_line.starts_with("## ") && !next_line.starts_with("### "))
                || next_line.starts_with("### ")))
        || (!new_format && next_line.starts_with("## "))
}

/// Parse legacy format: ## = column header, cards as list items.
fn parse_legacy_format(lines: &[&str], board: &mut KanbanBoard) {
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
                    return;
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
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );
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
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );
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
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );

            if current_column.is_some() {
                current_task = parse_task_line(line);
                collecting_description = current_task.is_some();
            }
            i += 1;
            continue;
        }

        // Collect description lines
        if current_task.is_some() && collecting_description {
            if trimmed.is_empty() && !line.starts_with("  ") {
                if is_description_boundary(lines, i, false) {
                    i += 1;
                    continue;
                }
            }
            let desc_line = if line.starts_with("  ") {
                &line[2..]
            } else {
                line
            };
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
    finalize_task(
        &mut current_task,
        &mut current_column,
        &mut collecting_description,
    );
    if let Some(col) = current_column.take() {
        board.columns.push(col);
    }

    if !footer_lines.is_empty() {
        board.kanban_footer = Some(footer_lines.join("\n"));
    }
}

/// Parse new format: # = row, ## = stack, ### = column, cards as list items.
fn parse_new_format(lines: &[&str], board: &mut KanbanBoard) {
    let mut current_row: Option<KanbanRow> = None;
    let mut current_stack: Option<KanbanStack> = None;
    let mut current_column: Option<KanbanColumn> = None;
    let mut current_task: Option<KanbanCard> = None;
    let mut collecting_description = false;
    let mut in_yaml_header = false;
    let mut in_kanban_footer = false;
    let mut yaml_lines: Vec<&str> = Vec::new();
    let mut footer_lines: Vec<&str> = Vec::new();
    let mut yaml_start_found = false;

    /// Push current column into current stack (creating implicit stack/row if needed).
    fn push_column(
        current_column: &mut Option<KanbanColumn>,
        current_stack: &mut Option<KanbanStack>,
        current_row: &mut Option<KanbanRow>,
    ) {
        if let Some(col) = current_column.take() {
            // Ensure we have a stack to push into
            if current_stack.is_none() {
                // Ensure we have a row
                if current_row.is_none() {
                    *current_row = Some(KanbanRow {
                        id: generate_id("row"),
                        title: "Default".to_string(),
                        stacks: Vec::new(),
                    });
                }
                *current_stack = Some(KanbanStack {
                    id: generate_id("stack"),
                    title: "Default".to_string(),
                    columns: Vec::new(),
                });
            }
            if let Some(stack) = current_stack.as_mut() {
                stack.columns.push(col);
            }
        }
    }

    /// Push current stack into current row (creating implicit row if needed).
    fn push_stack(current_stack: &mut Option<KanbanStack>, current_row: &mut Option<KanbanRow>) {
        if let Some(stack) = current_stack.take() {
            if current_row.is_none() {
                *current_row = Some(KanbanRow {
                    id: generate_id("row"),
                    title: "Default".to_string(),
                    stacks: Vec::new(),
                });
            }
            if let Some(row) = current_row.as_mut() {
                row.stacks.push(stack);
            }
        }
    }

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
                    return;
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
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );
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

        // h1 heading: row (# Title, but not ## or ###)
        if line.starts_with("# ") && !line.starts_with("## ") {
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );
            push_column(&mut current_column, &mut current_stack, &mut current_row);
            push_stack(&mut current_stack, &mut current_row);
            // Push current row
            if let Some(row) = current_row.take() {
                board.rows.push(row);
            }

            let row_title = &line[2..];
            current_row = Some(KanbanRow {
                id: generate_id("row"),
                title: row_title.to_string(),
                stacks: Vec::new(),
            });
            i += 1;
            continue;
        }

        // h2 heading: stack (## Title, but not ###)
        if line.starts_with("## ") && !line.starts_with("### ") {
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );
            push_column(&mut current_column, &mut current_stack, &mut current_row);
            push_stack(&mut current_stack, &mut current_row);

            let stack_title = &line[3..];
            current_stack = Some(KanbanStack {
                id: generate_id("stack"),
                title: stack_title.to_string(),
                columns: Vec::new(),
            });
            i += 1;
            continue;
        }

        // h3 heading: column
        if line.starts_with("### ") {
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );
            push_column(&mut current_column, &mut current_stack, &mut current_row);

            let column_title = &line[4..];
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
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );

            if current_column.is_some() {
                current_task = parse_task_line(line);
                collecting_description = current_task.is_some();
            }
            i += 1;
            continue;
        }

        // Collect description lines
        if current_task.is_some() && collecting_description {
            if trimmed.is_empty() && !line.starts_with("  ") {
                if is_description_boundary(lines, i, true) {
                    i += 1;
                    continue;
                }
            }
            let desc_line = if line.starts_with("  ") {
                &line[2..]
            } else {
                line
            };
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

    // Finalize last task, column, stack, row
    finalize_task(
        &mut current_task,
        &mut current_column,
        &mut collecting_description,
    );
    push_column(&mut current_column, &mut current_stack, &mut current_row);
    push_stack(&mut current_stack, &mut current_row);
    if let Some(row) = current_row.take() {
        board.rows.push(row);
    }

    if !footer_lines.is_empty() {
        board.kanban_footer = Some(footer_lines.join("\n"));
    }
}

/// Parse kanban markdown with include file support.
/// Include columns get their cards from the referenced include files (slide format)
/// instead of from inline task lines in the main markdown.
pub fn parse_markdown_with_includes(content: &str, ctx: &ParseContext) -> KanbanBoard {
    let mut board = parse_markdown(content);

    for col in board.all_columns_mut() {
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
                log::warn!(
                    "[lexera.parser.include] Include file not found in context: {}",
                    raw_path
                );
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

/// Write cards for a single column in markdown format.
fn write_column_cards(markdown: &mut String, column: &KanbanColumn) {
    // Include columns: cards live in the include file, not in the main markdown
    if column.include_source.is_some() {
        markdown.push('\n');
        return;
    }

    for task in &column.cards {
        let normalized = card_identity::strip_kid(&task.content)
            .replace("\r\n", "\n")
            .replace('\r', "\n");
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

    if !board.rows.is_empty() {
        // New format: # row / ## stack / ### column
        for row in &board.rows {
            markdown.push_str(&format!("# {}\n\n", row.title));

            for stack in &row.stacks {
                markdown.push_str(&format!("## {}\n\n", stack.title));

                for column in &stack.columns {
                    markdown.push_str(&format!("### {}\n", column.title));
                    write_column_cards(&mut markdown, column);
                }
            }
        }
    } else {
        // Legacy format: ## column
        for column in &board.columns {
            markdown.push_str(&format!("## {}\n", column.title));
            write_column_cards(&mut markdown, column);
        }
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
        assert_eq!(
            board.columns[0].cards[1].content,
            "Completed task\nwith description"
        );
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
    fn test_parse_strips_legacy_kid_marker() {
        let board = parse_markdown(
            "---\nkanban-plugin: board\n---\n\n## Todo\n- [ ] Task <!-- kid:a1b2c3d4 -->\n",
        );
        assert_eq!(board.columns[0].cards[0].content, "Task");
        assert_eq!(board.columns[0].cards[0].kid, Some("a1b2c3d4".to_string()));
    }

    #[test]
    fn test_parse_board_settings() {
        let settings = parse_board_settings(
            "---\nkanban-plugin: board\ncolumnWidth: 450px\nlayoutRows: 3\n---",
        );
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
    fn test_generate_markdown_does_not_write_kid_marker() {
        let board = parse_markdown(
            "---\nkanban-plugin: board\n---\n\n## Todo\n- [ ] Task <!-- kid:a1b2c3d4 -->\n",
        );
        let regenerated = generate_markdown(&board);
        assert!(regenerated.contains("- [ ] Task\n"));
        assert!(!regenerated.contains("<!-- kid:"));
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
        let md =
            "---\nkanban-plugin: board\n---\n\n## Col\n- [ ] Task\n  line1\n  line2\n\n## Next\n";
        let board = parse_markdown(md);
        assert_eq!(board.columns[0].cards[0].content, "Task\nline1\nline2");
    }

    // --- New format tests (h1/h2/h3 hierarchy) ---

    const NEW_FORMAT_BOARD: &str = "\
---
kanban-plugin: board
---

# Work

## Frontend

### Todo
- [ ] Build UI
- [x] Design mockup
  with notes

### In Progress
- [ ] Implement parser

## Backend

### Backlog
- [ ] Setup DB

# Personal

## Tasks

### Errands
- [ ] Buy groceries
";

    #[test]
    fn test_parse_new_format() {
        let board = parse_markdown(NEW_FORMAT_BOARD);
        assert!(board.valid);
        assert!(
            board.columns.is_empty(),
            "legacy columns should be empty for new format"
        );
        assert_eq!(board.rows.len(), 2);

        // Row 0: Work
        assert_eq!(board.rows[0].title, "Work");
        assert_eq!(board.rows[0].stacks.len(), 2);

        // Stack 0: Frontend
        assert_eq!(board.rows[0].stacks[0].title, "Frontend");
        assert_eq!(board.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(board.rows[0].stacks[0].columns[0].title, "Todo");
        assert_eq!(board.rows[0].stacks[0].columns[0].cards.len(), 2);
        assert!(!board.rows[0].stacks[0].columns[0].cards[0].checked);
        assert_eq!(
            board.rows[0].stacks[0].columns[0].cards[0].content,
            "Build UI"
        );
        assert!(board.rows[0].stacks[0].columns[0].cards[1].checked);
        assert_eq!(
            board.rows[0].stacks[0].columns[0].cards[1].content,
            "Design mockup\nwith notes"
        );
        assert_eq!(board.rows[0].stacks[0].columns[1].title, "In Progress");
        assert_eq!(board.rows[0].stacks[0].columns[1].cards.len(), 1);

        // Stack 1: Backend
        assert_eq!(board.rows[0].stacks[1].title, "Backend");
        assert_eq!(board.rows[0].stacks[1].columns.len(), 1);
        assert_eq!(board.rows[0].stacks[1].columns[0].title, "Backlog");

        // Row 1: Personal
        assert_eq!(board.rows[1].title, "Personal");
        assert_eq!(board.rows[1].stacks.len(), 1);
        assert_eq!(board.rows[1].stacks[0].title, "Tasks");
        assert_eq!(board.rows[1].stacks[0].columns[0].title, "Errands");
        assert_eq!(board.rows[1].stacks[0].columns[0].cards.len(), 1);
    }

    #[test]
    fn test_new_format_roundtrip() {
        let board = parse_markdown(NEW_FORMAT_BOARD);
        let regenerated = generate_markdown(&board);
        let reparsed = parse_markdown(&regenerated);

        assert!(reparsed.valid);
        assert_eq!(reparsed.rows.len(), board.rows.len());
        for (orig_row, re_row) in board.rows.iter().zip(reparsed.rows.iter()) {
            assert_eq!(orig_row.title, re_row.title);
            assert_eq!(orig_row.stacks.len(), re_row.stacks.len());
            for (orig_stack, re_stack) in orig_row.stacks.iter().zip(re_row.stacks.iter()) {
                assert_eq!(orig_stack.title, re_stack.title);
                assert_eq!(orig_stack.columns.len(), re_stack.columns.len());
                for (orig_col, re_col) in orig_stack.columns.iter().zip(re_stack.columns.iter()) {
                    assert_eq!(orig_col.title, re_col.title);
                    assert_eq!(orig_col.cards.len(), re_col.cards.len());
                    for (oc, rc) in orig_col.cards.iter().zip(re_col.cards.iter()) {
                        assert_eq!(oc.content, rc.content);
                        assert_eq!(oc.checked, rc.checked);
                    }
                }
            }
        }
    }

    #[test]
    fn test_new_format_minimal() {
        // Minimal new format: just h3 columns with implicit row/stack
        let md = "---\nkanban-plugin: board\n---\n\n# Board\n\n### Todo\n- [ ] Task 1\n\n### Done\n- [x] Task 2\n";
        let board = parse_markdown(md);
        assert!(board.valid);
        assert_eq!(board.rows.len(), 1);
        assert_eq!(board.rows[0].title, "Board");
        // Columns before any ## heading get an implicit "Default" stack
        assert_eq!(board.rows[0].stacks.len(), 1);
        assert_eq!(board.rows[0].stacks[0].title, "Default");
        assert_eq!(board.rows[0].stacks[0].columns.len(), 2);
    }

    #[test]
    fn test_new_format_with_footer() {
        let md = "---\nkanban-plugin: board\n---\n\n# Row1\n\n## Stack1\n\n### Col1\n- [ ] Task\n\n%% kanban:settings\n```\n```\n%%\n";
        let board = parse_markdown(md);
        assert!(board.valid);
        assert_eq!(board.rows.len(), 1);
        assert!(board.kanban_footer.is_some());
    }

    #[test]
    fn test_legacy_format_unchanged() {
        // Make sure legacy boards with ## headers still work
        let board = parse_markdown(SAMPLE_BOARD);
        assert!(board.valid);
        assert!(board.rows.is_empty(), "legacy boards should have no rows");
        assert_eq!(board.columns.len(), 2);
    }

    #[test]
    fn test_detect_format_ignores_yaml_headings() {
        // A # inside YAML should NOT trigger new format
        let md = "---\nkanban-plugin: board\n# not a heading\n---\n\n## Col\n- [ ] Task\n";
        let board = parse_markdown(md);
        assert!(board.valid);
        assert!(
            board.rows.is_empty(),
            "# inside YAML should not trigger new format"
        );
        assert_eq!(board.columns.len(), 1);
    }
}
