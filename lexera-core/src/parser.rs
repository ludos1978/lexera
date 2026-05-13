/// Lightweight markdown parser for Kanban boards.
///
/// Handles the core format:
///   --- YAML header (must contain kanban-plugin: board) ---
///   ## Column Title
///   - [ ] Task summary
///     description line
///     %% footer %%
///
/// Line-by-line port of packages/shared/src/markdownParser.ts.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::include::resolver::resolve_include_path;
use crate::include::slide_parser;
use crate::include::syntax;
use crate::merge::card_identity;
use crate::types::{BoardFormat, IncludeSource, KanbanBoard, KanbanCard, KanbanColumn};

mod legacy;
mod new_format;
mod params;
mod yaml_meta;

pub use params::{format_params, parse_params};

pub use yaml_meta::{
    body_hash, parse_board_settings, parse_generation_meta, update_yaml_with_board_settings,
    update_yaml_with_generation_meta,
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
        generation_meta: None,
        format_hint: BoardFormat::Legacy,
    };

    // First pass: detect format by scanning for h1 headings (# but not ## or ###)
    // We must skip YAML header and footer regions
    let is_new_format = new_format::detect_new_format(&lines);

    if is_new_format {
        board.format_hint = BoardFormat::New;
        new_format::parse_new_format(&lines, &mut board);
    } else {
        board.format_hint = BoardFormat::Legacy;
        legacy::parse_legacy_format(&lines, &mut board);
    }

    board.board_settings = Some(parse_board_settings(
        board.yaml_header.as_deref().unwrap_or(""),
    ));
    board.generation_meta = Some(parse_generation_meta(
        board.yaml_header.as_deref().unwrap_or(""),
    ));

    board
}

/// Finalize current task into current column if both exist.
pub(super) fn finalize_task(
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

/// Check if a blank line during description collection is a structural boundary.
pub(super) fn is_description_boundary(lines: &[&str], i: usize, new_format: bool) -> bool {
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

/// Parse kanban markdown with include file support.
/// Include columns get their cards from the referenced include files (slide format)
/// instead of from inline task lines in the main markdown.
pub fn parse_markdown_with_includes(content: &str, ctx: &ParseContext) -> KanbanBoard {
    let mut board = parse_markdown(content);

    for col in board.all_columns_mut() {
        if let Some(raw_path) = syntax::extract_include_path(&col.title) {
            let resolved = resolve_include_path(&raw_path, &ctx.board_dir);
            let tags = syntax::strip_include(&col.title);

            col.include_source = Some(IncludeSource::new(raw_path.clone(), resolved));

            // Merge inline cards (already parsed from main markdown by
            // parse_markdown above) with cards loaded from the include
            // file. This preserves user-typed cards under include-headers
            // even when the include exists; on save those merged cards
            // round-trip into the include file (if writable) or stay
            // inline (if missing / non-markdown extension). Without this
            // merge, parse_slides clobbered any inline cards and the
            // following save dropped them from disk.
            if let Some(include_content) = ctx.include_contents.get(&raw_path) {
                let mut include_cards = slide_parser::parse_slides(include_content);
                col.cards.append(&mut include_cards);
            } else {
                log::warn!(
                    "[lexera.parser.include] Include file not found in context: {}",
                    raw_path
                );
                // Missing include: keep inline cards as the safety net.
                // The storage layer sets include_source.missing later, and
                // write_column_cards uses is_writable_target() to decide
                // whether to write them inline or skip.
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
    // Include columns with a writable target: cards round-trip into the
    // include file via write_include_column, not into the main markdown.
    // Non-writable targets (missing file, .pdf / .epub / etc.) fall through
    // and serialize inline as a safety net so the cards survive on disk.
    if let Some(src) = &column.include_source {
        if src.is_writable_target() {
            markdown.push('\n');
            return;
        }
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
        markdown.push_str(&format_params(&task.params));
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
    let use_new_format = board.format_hint == BoardFormat::New || board.has_explicit_hierarchy();

    if board.yaml_header.is_some() || board.board_settings.is_some() {
        let mut updated_yaml = update_yaml_with_board_settings(
            board.yaml_header.as_deref(),
            board.board_settings.as_ref().cloned().unwrap_or_default(),
        );
        if let Some(ref meta) = board.generation_meta {
            updated_yaml = update_yaml_with_generation_meta(&updated_yaml, meta);
        }
        markdown.push_str(&updated_yaml);
        markdown.push_str("\n\n");
    }

    match use_new_format {
        true => {
            // New format: # row / ## stack / ### column
            for row in &board.rows {
                markdown.push_str(&format!(
                    "# {}{}\n\n",
                    row.title,
                    format_params(&row.params)
                ));

                for stack in &row.stacks {
                    markdown.push_str(&format!(
                        "## {}{}\n\n",
                        stack.title,
                        format_params(&stack.params)
                    ));

                    for column in &stack.columns {
                        markdown.push_str(&format!(
                            "### {}{}\n",
                            column.title,
                            format_params(&column.params)
                        ));
                        write_column_cards(&mut markdown, column);
                    }
                }
            }
        }
        false => {
            // Legacy format: ## column headers only (no row/stack headings).
            // Columns come from rows hierarchy (parser always wraps in Default row/stack)
            // or from board.columns for programmatically constructed boards.
            let columns = board.all_columns();
            for column in columns {
                markdown.push_str(&format!("## {}\n", column.title));
                write_column_cards(&mut markdown, column);
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

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

    const LEGACY_STACK_TAG_BOARD: &str = "\
---
kanban-plugin: board
---

## Base
- [ ] Base task

## Child #stack
- [ ] Child task

## Next
- [ ] Next task

## Sibling #stack
- [ ] Sibling task
";

    const LEGACY_ROW_AND_STACK_TAG_BOARD: &str = "\
---
kanban-plugin: board
---

## Todo
- [ ] Row 1 task

## Backlog #row2
- [ ] Row 2 task

## Doing #row2 #stack
- [ ] Row 2 second task

## Done
- [ ] Final row 1 task
";

    #[test]
    fn test_parse_basic_board() {
        let board = parse_markdown(SAMPLE_BOARD);
        assert!(board.valid);
        assert_eq!(board.format_hint, BoardFormat::Legacy);
        let cols = board.all_columns();
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].title, "Todo");
        assert_eq!(cols[0].cards.len(), 2);
        assert!(!cols[0].cards[0].checked);
        assert_eq!(cols[0].cards[0].content, "First task");
        assert!(cols[0].cards[1].checked);
        assert_eq!(cols[0].cards[1].content, "Completed task\nwith description");
        assert_eq!(cols[1].title, "Done");
        assert_eq!(cols[1].cards.len(), 1);
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
        let cols = board.all_columns();
        assert_eq!(cols[0].cards[0].content, "Task");
        assert_eq!(cols[0].cards[0].kid, Some("a1b2c3d4".to_string()));
    }

    #[test]
    fn test_roundtrip() {
        let board = parse_markdown(SAMPLE_BOARD);
        let regenerated = generate_markdown(&board);
        let reparsed = parse_markdown(&regenerated);

        assert!(reparsed.valid);
        let orig_cols = board.all_columns();
        let re_cols = reparsed.all_columns();
        assert_eq!(re_cols.len(), orig_cols.len());
        for (orig, re) in orig_cols.iter().zip(re_cols.iter()) {
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
    fn test_empty_board() {
        let board = parse_markdown("---\nkanban-plugin: board\n---\n");
        assert!(board.valid);
        assert_eq!(board.all_columns().len(), 0);
    }

    #[test]
    fn test_description_with_blank_lines() {
        let md =
            "---\nkanban-plugin: board\n---\n\n## Col\n- [ ] Task\n  line1\n  line2\n\n## Next\n";
        let board = parse_markdown(md);
        let cols = board.all_columns();
        assert_eq!(cols[0].cards[0].content, "Task\nline1\nline2");
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
    fn test_legacy_format_uses_row_and_stack_hierarchy() {
        let board = parse_markdown(SAMPLE_BOARD);
        assert!(board.valid);
        assert_eq!(board.format_hint, BoardFormat::Legacy);
        assert_eq!(board.all_columns().len(), 2);
        assert_eq!(board.rows.len(), 1);
        assert_eq!(board.rows[0].title, "Default");
        assert_eq!(board.rows[0].stacks.len(), 1);
        assert_eq!(board.rows[0].stacks[0].title, "Default");
        assert_eq!(board.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(board.rows[0].stacks[0].columns[0].title, "Todo");
        assert_eq!(board.rows[0].stacks[0].columns[1].title, "Done");
        assert!(board.columns.is_empty());
    }

    #[test]
    fn test_legacy_format_groups_stack_columns_with_previous_anchor() {
        let board = parse_markdown(LEGACY_STACK_TAG_BOARD);
        assert!(board.valid);
        assert_eq!(board.rows.len(), 1);
        assert_eq!(board.rows[0].stacks.len(), 2);

        assert_eq!(board.rows[0].stacks[0].title, "Base");
        assert_eq!(board.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(board.rows[0].stacks[0].columns[0].title, "Base");
        assert_eq!(board.rows[0].stacks[0].columns[1].title, "Child");

        assert_eq!(board.rows[0].stacks[1].title, "Next");
        assert_eq!(board.rows[0].stacks[1].columns.len(), 2);
        assert_eq!(board.rows[0].stacks[1].columns[0].title, "Next");
        assert_eq!(board.rows[0].stacks[1].columns[1].title, "Sibling");
    }

    #[test]
    fn test_legacy_format_groups_rows_by_row_number_before_stacking() {
        let board = parse_markdown(LEGACY_ROW_AND_STACK_TAG_BOARD);
        assert!(board.valid);
        assert_eq!(board.rows.len(), 2);

        assert_eq!(board.rows[0].title, "Row 1");
        assert_eq!(board.rows[0].stacks.len(), 2);
        assert_eq!(board.rows[0].stacks[0].title, "Todo");
        assert_eq!(board.rows[0].stacks[0].columns[0].title, "Todo");
        assert_eq!(board.rows[0].stacks[1].title, "Done");
        assert_eq!(board.rows[0].stacks[1].columns[0].title, "Done");

        assert_eq!(board.rows[1].title, "Row 2");
        assert_eq!(board.rows[1].stacks.len(), 1);
        assert_eq!(board.rows[1].stacks[0].title, "Backlog");
        assert_eq!(board.rows[1].stacks[0].columns.len(), 2);
        assert_eq!(board.rows[1].stacks[0].columns[0].title, "Backlog");
        assert_eq!(board.rows[1].stacks[0].columns[1].title, "Doing");
    }

    #[test]
    fn test_detect_format_ignores_yaml_headings() {
        // A # inside YAML should NOT trigger new format
        let md = "---\nkanban-plugin: board\n# not a heading\n---\n\n## Col\n- [ ] Task\n";
        let board = parse_markdown(md);
        assert!(board.valid);
        assert_eq!(
            board.format_hint,
            BoardFormat::Legacy,
            "# inside YAML should not trigger new format"
        );
        assert_eq!(board.all_columns().len(), 1);
    }

    // ---------------------------------------------------------------
    // Markdown text idempotency: parse → generate → parse → generate
    // must produce identical markdown on the second generation.
    // ---------------------------------------------------------------

    #[test]
    fn test_legacy_format_text_idempotency() {
        let board1 = parse_markdown(SAMPLE_BOARD);
        let md1 = generate_markdown(&board1);
        let board2 = parse_markdown(&md1);
        let md2 = generate_markdown(&board2);
        assert_eq!(
            md1, md2,
            "Legacy format markdown should be idempotent after first normalization"
        );
    }

    #[test]
    fn test_new_format_text_idempotency() {
        let board1 = parse_markdown(NEW_FORMAT_BOARD);
        let md1 = generate_markdown(&board1);
        let board2 = parse_markdown(&md1);
        let md2 = generate_markdown(&board2);
        assert_eq!(
            md1, md2,
            "New format markdown should be idempotent after first normalization"
        );
    }

    #[test]
    fn test_multiline_card_text_idempotency() {
        let md = "---\nkanban-plugin: board\n---\n\n# Row\n\n## Stack\n\n### Col\n- [ ] Title line\n  Description line 1\n  Description line 2\n\n- [x] Another card\n  with continuation\n";
        let board1 = parse_markdown(md);
        let md1 = generate_markdown(&board1);
        let board2 = parse_markdown(&md1);
        let md2 = generate_markdown(&board2);
        assert_eq!(md1, md2, "Multiline card content should be idempotent");
    }

    #[test]
    fn test_card_with_tags_text_idempotency() {
        let md = "---\nkanban-plugin: board\n---\n\n# Row\n\n## Stack\n\n### Col\n- [ ] Task #tag1 #tag2 @2026-01-15\n  Some description with [link](https://example.com)\n  And a [[wiki-link]]\n";
        let board1 = parse_markdown(md);
        let md1 = generate_markdown(&board1);
        let board2 = parse_markdown(&md1);
        let md2 = generate_markdown(&board2);
        assert_eq!(md1, md2, "Cards with tags and links should be idempotent");
    }

    // -----------------------------------------------------------------------
    // Inline params {key:value} tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_params_in_board_roundtrip() {
        let md = "---\nkanban-plugin: board\n---\n\n# Row {h:500}\n\n## Stack {x:50, y:100, w:400, h:300}\n\n### Column {w:2}\n- [ ] Card {span:2}\n";
        let board = parse_markdown(md);

        // Verify params were parsed
        assert_eq!(board.rows.len(), 1);
        assert_eq!(board.rows[0].params.get("h").unwrap(), "500");

        let stack = &board.rows[0].stacks[0];
        assert_eq!(stack.params.get("x").unwrap(), "50");
        assert_eq!(stack.params.get("y").unwrap(), "100");
        assert_eq!(stack.params.get("w").unwrap(), "400");

        let col = &stack.columns[0];
        assert_eq!(col.params.get("w").unwrap(), "2");

        let card = &col.cards[0];
        assert_eq!(card.params.get("span").unwrap(), "2");
        assert_eq!(card.content, "Card");

        // Verify roundtrip
        let md_out = generate_markdown(&board);
        let board2 = parse_markdown(&md_out);
        let md_out2 = generate_markdown(&board2);
        assert_eq!(md_out, md_out2, "Params should survive roundtrip");
    }

    #[test]
    fn test_params_title_stripped_from_display() {
        let md = "---\nkanban-plugin: board\n---\n\n# My Row {h:300}\n\n## My Stack {x:10}\n\n### My Col {w:3}\n- [ ] My Task {span:1}\n";
        let board = parse_markdown(md);

        assert_eq!(board.rows[0].title, "My Row");
        assert_eq!(board.rows[0].stacks[0].title, "My Stack");
        assert_eq!(board.rows[0].stacks[0].columns[0].title, "My Col");
        assert_eq!(
            board.rows[0].stacks[0].columns[0].cards[0].content,
            "My Task"
        );
    }

    #[test]
    fn test_no_params_board_unchanged() {
        let md = "---\nkanban-plugin: board\n---\n\n# Row\n\n## Stack\n\n### Column\n- [ ] Task\n";
        let board = parse_markdown(md);
        assert!(board.rows[0].params.is_empty());
        assert!(board.rows[0].stacks[0].params.is_empty());
        assert!(board.rows[0].stacks[0].columns[0].params.is_empty());
        assert!(board.rows[0].stacks[0].columns[0].cards[0]
            .params
            .is_empty());

        let md_out = generate_markdown(&board);
        let board2 = parse_markdown(&md_out);
        let md_out2 = generate_markdown(&board2);
        assert_eq!(md_out, md_out2);
    }

    #[test]
    fn test_board_layout_setting_roundtrip() {
        let md = "---\nkanban-plugin: board\nboardLayout: canvas\n---\n\n## Col\n- [ ] task\n";
        let board = parse_markdown(md);
        let settings = board.board_settings.as_ref().unwrap();
        assert_eq!(settings.board_layout.as_deref(), Some("canvas"));

        let md_out = generate_markdown(&board);
        assert!(md_out.contains("boardLayout: canvas"));
    }

    #[test]
    fn test_kanban_layout_setting_roundtrip() {
        let md = "---\nkanban-plugin: board\nboardLayout: kanban\n---\n\n## Col\n- [ ] task\n";
        let board = parse_markdown(md);
        let settings = board.board_settings.as_ref().unwrap();
        assert_eq!(settings.board_layout.as_deref(), Some("kanban"));

        let md_out = generate_markdown(&board);
        assert!(md_out.contains("boardLayout: kanban"));
    }

    #[test]
    fn test_canvas_surface_settings_roundtrip() {
        let md = "---\nkanban-plugin: board\nboardLayout: canvas\ncanvasSurface: pages\ncanvasGrid: largest\ncanvasPageSize: 1280\n---\n\n## Stack {x:-120, y:-40, w:420, h:280}\n\n### Column\n- [ ] task\n";
        let board = parse_markdown(md);
        let settings = board.board_settings.as_ref().unwrap();
        assert_eq!(settings.board_layout.as_deref(), Some("canvas"));
        assert_eq!(settings.canvas_surface.as_deref(), Some("pages"));
        assert_eq!(settings.canvas_grid.as_deref(), Some("largest"));
        assert_eq!(settings.canvas_page_size.as_deref(), Some("1280"));

        let md_out = generate_markdown(&board);
        assert!(md_out.contains("canvasSurface: pages"));
        assert!(md_out.contains("canvasGrid: largest"));
        assert!(md_out.contains("canvasPageSize: 1280"));
    }

    #[test]
    fn test_canvas_params_preserved_after_kanban_mode_switch() {
        // A board in new format (has # row) with canvas position/size params on stacks
        let md = "---\nkanban-plugin: board\nboardLayout: canvas\n---\n\n# Row\n\n## Stack A {x:100, y:200, w:400, h:300}\n\n### Column 1\n- [ ] Task 1\n\n## Stack B {x:600, y:50, w:350, h:250, dir:vertical}\n\n### Column 2\n- [ ] Task 2\n";
        let mut board = parse_markdown(md);

        // Verify canvas params parsed correctly
        let stack_a = &board.rows[0].stacks[0];
        assert_eq!(stack_a.params.get("x").map(|s| s.as_str()), Some("100"));
        assert_eq!(stack_a.params.get("y").map(|s| s.as_str()), Some("200"));
        assert_eq!(stack_a.params.get("w").map(|s| s.as_str()), Some("400"));
        assert_eq!(stack_a.params.get("h").map(|s| s.as_str()), Some("300"));

        // Simulate switching to kanban mode (only changes header setting)
        if let Some(ref mut settings) = board.board_settings {
            settings.board_layout = Some("kanban".to_string());
        }

        // Roundtrip through markdown
        let md_out = generate_markdown(&board);
        let board2 = parse_markdown(&md_out);

        // Canvas params must survive the mode switch and roundtrip
        let stack_a2 = &board2.rows[0].stacks[0];
        assert_eq!(stack_a2.params.get("x").map(|s| s.as_str()), Some("100"));
        assert_eq!(stack_a2.params.get("y").map(|s| s.as_str()), Some("200"));
        assert_eq!(stack_a2.params.get("w").map(|s| s.as_str()), Some("400"));
        assert_eq!(stack_a2.params.get("h").map(|s| s.as_str()), Some("300"));

        let stack_b2 = &board2.rows[0].stacks[1];
        assert_eq!(stack_b2.params.get("x").map(|s| s.as_str()), Some("600"));
        assert_eq!(
            stack_b2.params.get("dir").map(|s| s.as_str()),
            Some("vertical")
        );

        // Board should now be in kanban mode
        let settings2 = board2.board_settings.as_ref().unwrap();
        assert_eq!(settings2.board_layout.as_deref(), Some("kanban"));

        // Output should contain all canvas params despite kanban mode
        assert!(md_out.contains("boardLayout: kanban"));
        assert!(md_out.contains("{h:300, w:400, x:100, y:200}"));
        assert!(md_out.contains("{dir:vertical,"));
    }

    // ── Shared fixture tests ─────────────────────────────────────────
    //
    // Each fixture in `packages/shared-fixtures/parser/` consists of a `.md`
    // file and a `.expected.json` file.  The Rust parser is authoritative:
    // we parse the `.md`, convert the result into the fixture JSON schema,
    // and assert equality with the expected JSON.

    /// Fixture-format column summary.
    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct FixtureColumn {
        title: String,
        card_count: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        has_include: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        include_path: Option<String>,
    }

    /// Fixture-format card.
    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct FixtureCard {
        column: usize,
        index: usize,
        content: String,
        checked: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        params: Option<HashMap<String, String>>,
    }

    /// Fixture-format stack (for new-format boards).
    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct FixtureStack {
        title: String,
        column_count: usize,
        columns: Vec<FixtureColumn>,
    }

    /// Fixture-format row (for new-format boards).
    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct FixtureRow {
        title: String,
        stack_count: usize,
        stacks: Vec<FixtureStack>,
    }

    /// Top-level fixture structure.
    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct FixtureBoard {
        valid: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        format: Option<String>,
        column_count: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        columns: Option<Vec<FixtureColumn>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cards: Option<Vec<FixtureCard>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        board_settings: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        row_count: Option<usize>,
        #[serde(skip_serializing_if = "Option::is_none")]
        rows: Option<Vec<FixtureRow>>,
    }

    /// Convert a parsed `KanbanBoard` into the shared fixture schema.
    fn board_to_fixture(board: &KanbanBoard) -> FixtureBoard {
        let format_str = match board.format_hint {
            BoardFormat::Legacy => "legacy",
            BoardFormat::New => "new",
        };

        let all_cols: Vec<&KanbanColumn> = board.all_columns();

        // Build flat column summaries
        let fixture_columns: Vec<FixtureColumn> = all_cols
            .iter()
            .map(|col| {
                let has_include = col.include_source.is_some();
                FixtureColumn {
                    title: col.title.clone(),
                    card_count: col.cards.len(),
                    has_include: if has_include { Some(true) } else { None },
                    include_path: col.include_source.as_ref().map(|inc| inc.raw_path.clone()),
                }
            })
            .collect();

        // Build flat card list
        let mut fixture_cards: Vec<FixtureCard> = Vec::new();
        for (col_idx, col) in all_cols.iter().enumerate() {
            for (card_idx, card) in col.cards.iter().enumerate() {
                fixture_cards.push(FixtureCard {
                    column: col_idx,
                    index: card_idx,
                    content: card.content.clone(),
                    checked: card.checked,
                    params: if card.params.is_empty() {
                        None
                    } else {
                        Some(card.params.clone())
                    },
                });
            }
        }

        // Build row/stack hierarchy for new-format boards
        let (row_count, fixture_rows) =
            if board.format_hint == BoardFormat::New && board.has_explicit_hierarchy() {
                let rows: Vec<FixtureRow> = board
                    .rows
                    .iter()
                    .map(|row| FixtureRow {
                        title: row.title.clone(),
                        stack_count: row.stacks.len(),
                        stacks: row
                            .stacks
                            .iter()
                            .map(|stack| FixtureStack {
                                title: stack.title.clone(),
                                column_count: stack.columns.len(),
                                columns: stack
                                    .columns
                                    .iter()
                                    .map(|col| FixtureColumn {
                                        title: col.title.clone(),
                                        card_count: col.cards.len(),
                                        has_include: None,
                                        include_path: None,
                                    })
                                    .collect(),
                            })
                            .collect(),
                    })
                    .collect();
                (Some(rows.len()), Some(rows))
            } else {
                (None, None)
            };

        // Board settings (only include if any field is set)
        let board_settings = board.board_settings.as_ref().and_then(|bs| {
            let val = serde_json::to_value(bs).ok()?;
            if val == serde_json::json!({}) {
                None
            } else {
                Some(val)
            }
        });

        FixtureBoard {
            valid: board.valid,
            format: if board.valid {
                Some(format_str.to_string())
            } else {
                None
            },
            column_count: all_cols.len(),
            columns: if fixture_columns.is_empty() {
                None
            } else {
                Some(fixture_columns)
            },
            cards: if fixture_cards.is_empty() {
                None
            } else {
                Some(fixture_cards)
            },
            board_settings,
            row_count,
            rows: fixture_rows,
        }
    }

    /// Find the shared-fixtures/parser directory relative to the workspace.
    fn fixtures_dir() -> std::path::PathBuf {
        // The test is compiled from lexera-core; Cargo sets
        // CARGO_MANIFEST_DIR to that crate directory. The fixtures live
        // at `<workspace-root>/packages/shared-fixtures/parser/` — both
        // Rust and JS sides consume the same files.
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest
            .parent()
            .unwrap()
            .join("packages")
            .join("shared-fixtures")
            .join("parser")
    }

    #[test]
    fn test_shared_fixtures() {
        let dir = fixtures_dir();
        assert!(dir.exists(), "Fixtures directory not found: {:?}", dir);

        let mut md_files: Vec<_> = std::fs::read_dir(&dir)
            .expect("Cannot read fixtures directory")
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    Some(path)
                } else {
                    None
                }
            })
            .collect();

        md_files.sort();
        assert!(!md_files.is_empty(), "No fixture .md files found");

        let mut failures: Vec<String> = Vec::new();

        for md_path in &md_files {
            let stem = md_path.file_stem().unwrap().to_str().unwrap();
            let expected_path = dir.join(format!("{}.expected.json", stem));
            assert!(
                expected_path.exists(),
                "Missing expected JSON for fixture: {}",
                stem
            );

            let md_content = std::fs::read_to_string(md_path)
                .unwrap_or_else(|e| panic!("Cannot read {}: {}", md_path.display(), e));
            let expected_json = std::fs::read_to_string(&expected_path)
                .unwrap_or_else(|e| panic!("Cannot read {}: {}", expected_path.display(), e));

            let board = parse_markdown(&md_content);
            let actual = board_to_fixture(&board);
            let expected: FixtureBoard = serde_json::from_str(&expected_json)
                .unwrap_or_else(|e| panic!("Invalid JSON in {}: {}", expected_path.display(), e));

            if actual != expected {
                let actual_json = serde_json::to_string_pretty(&actual).unwrap();
                failures.push(format!(
                    "FIXTURE MISMATCH: {}\n  expected: {}\n  actual:   {}",
                    stem,
                    expected_json.trim(),
                    actual_json
                ));
            }
        }

        if !failures.is_empty() {
            panic!(
                "{} fixture(s) failed:\n\n{}",
                failures.len(),
                failures.join("\n\n")
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Include-column data preservation (Slice 1 of include-save fix)
    // ─────────────────────────────────────────────────────────────────────
    // Contract: inline cards typed under an `!!!include(...)!!!` column
    // header must survive the load → serialize round-trip regardless of
    // whether the include file exists, is markdown, or is a non-card-shape
    // format. Before the fix, parse_markdown_with_includes clobbered inline
    // cards with parse_slides output (or Vec::new() for missing files) and
    // write_column_cards skipped serializing them — net result was silent
    // data loss in the main .md.

    const INCLUDE_INLINE_BOARD: &str = "\
---
kanban-plugin: board
---

# Board

## Stack One

### !!!include(includes/missing.md)!!! #red
- [ ] Inline card under missing include
- [x] Second inline card
";

    fn ctx_with(board_dir: &str, contents: &[(&str, &str)]) -> ParseContext {
        let mut include_contents = HashMap::new();
        for (k, v) in contents {
            include_contents.insert((*k).to_string(), (*v).to_string());
        }
        ParseContext {
            include_contents,
            board_dir: std::path::PathBuf::from(board_dir),
        }
    }

    #[test]
    fn include_missing_preserves_inline_cards_on_parse() {
        // Missing include: parser must keep inline cards, not clear them.
        let ctx = ctx_with("/tmp/board", &[]);
        let board = parse_markdown_with_includes(INCLUDE_INLINE_BOARD, &ctx);
        let cols = board.all_columns();
        let include_col = cols
            .iter()
            .find(|c| c.title.contains("!!!include"))
            .expect("include column present");
        assert!(include_col.include_source.is_some(), "include_source set");
        assert_eq!(
            include_col.cards.len(),
            2,
            "inline cards must survive missing-include parse"
        );
        assert_eq!(
            include_col.cards[0].content,
            "Inline card under missing include"
        );
        assert!(include_col.cards[1].checked);
    }

    #[test]
    fn include_present_merges_inline_with_slide_cards_on_parse() {
        // Present markdown include: parser must merge inline + slide cards,
        // not clobber inline.
        let ctx = ctx_with(
            "/tmp/board",
            &[("includes/missing.md", "# Slide A\n\n---\n\n# Slide B\n")],
        );
        let board = parse_markdown_with_includes(INCLUDE_INLINE_BOARD, &ctx);
        let include_col = board
            .all_columns()
            .into_iter()
            .find(|c| c.title.contains("!!!include"))
            .expect("include column present")
            .clone();
        // 2 inline + 2 slide blocks = 4 (inline preserved, slides appended)
        assert_eq!(
            include_col.cards.len(),
            4,
            "merged set: 2 inline + 2 slides"
        );
        assert_eq!(
            include_col.cards[0].content, "Inline card under missing include",
            "inline cards stay first"
        );
        assert!(
            include_col.cards[2].content.contains("Slide A")
                && include_col.cards[3].content.contains("Slide B"),
            "slide cards appended after inline (got [2]={:?}, [3]={:?})",
            include_col.cards[2].content,
            include_col.cards[3].content
        );
    }

    #[test]
    fn include_non_writable_serializes_cards_inline() {
        // is_writable_target=false (here via missing flag): serializer
        // must write cards inline in main .md as a safety net.
        let ctx = ctx_with("/tmp/board", &[]);
        let mut board = parse_markdown_with_includes(INCLUDE_INLINE_BOARD, &ctx);
        // Simulate the storage layer's missing-flag annotation.
        for col in board.all_columns_mut() {
            if let Some(src) = col.include_source.as_mut() {
                src.missing = true;
            }
        }
        let serialized = generate_markdown(&board);
        assert!(
            serialized.contains("- [ ] Inline card under missing include"),
            "first inline card should round-trip into main .md, got:\n{}",
            serialized
        );
        assert!(
            serialized.contains("- [x] Second inline card"),
            "second inline card should round-trip into main .md"
        );
    }

    #[test]
    fn include_writable_target_serializes_blank_in_main_md() {
        // is_writable_target=true (markdown extension, not missing):
        // serializer skips inline cards in main .md (they round-trip via
        // write_include_column into the include file instead).
        let ctx = ctx_with("/tmp/board", &[("includes/missing.md", "")]);
        let board = parse_markdown_with_includes(INCLUDE_INLINE_BOARD, &ctx);
        // Sanity: missing flag stays false because content was present.
        for col in board.all_columns() {
            if let Some(src) = &col.include_source {
                assert!(!src.missing, "missing not set when content is provided");
                assert!(src.is_writable_target(), "md extension is writable target");
            }
        }
        let serialized = generate_markdown(&board);
        assert!(
            !serialized.contains("Inline card under missing include"),
            "writable-target include: inline cards must NOT appear in main .md"
        );
    }

    #[test]
    fn is_writable_target_extension_matrix() {
        use std::path::PathBuf;
        let mk = |path: &str| IncludeSource::new("x".into(), PathBuf::from(path));
        assert!(mk("a.md").is_writable_target());
        assert!(mk("a.markdown").is_writable_target());
        assert!(mk("a.MD").is_writable_target(), "case-insensitive");
        assert!(!mk("a.pdf").is_writable_target());
        assert!(!mk("a.epub").is_writable_target());
        assert!(!mk("a").is_writable_target(), "no extension");
        let mut missing = mk("a.md");
        missing.missing = true;
        assert!(!missing.is_writable_target(), "missing flag wins");
    }
}
