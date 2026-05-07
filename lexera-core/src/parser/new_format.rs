//! New markdown format parser (`# row / ## stack / ### column / - card`).
//!
//! Handles the explicit hierarchy: h1 = row, h2 = stack, h3 = column,
//! and list items as cards. Implicit row / stack are synthesised when
//! a higher-level heading is missing so the resulting tree always has
//! the full row → stack → column nesting the rest of the codebase
//! expects. External callers reach this through `crate::parser::*`
//! via the qualified path in `parser.rs`.

use std::collections::HashMap;

use crate::types::{KanbanBoard, KanbanCard, KanbanColumn, KanbanRow, KanbanStack};

use super::params::{parse_params, parse_task_line};
use super::{finalize_task, generate_id, is_description_boundary};

/// Detect whether content uses the new h1/h2/h3 hierarchy format.
/// Returns true if any `# ` (h1, not h2/h3) heading is found outside YAML/footer.
pub fn detect_new_format(lines: &[&str]) -> bool {
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

/// Parse new format: # = row, ## = stack, ### = column, cards as list items.
pub fn parse_new_format(lines: &[&str], board: &mut KanbanBoard) {
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
                        params: HashMap::new(),
                    });
                }
                *current_stack = Some(KanbanStack {
                    id: generate_id("stack"),
                    title: "Default".to_string(),
                    columns: Vec::new(),
                    params: HashMap::new(),
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
                    params: HashMap::new(),
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

            let (row_title, row_params) = parse_params(&line[2..]);
            current_row = Some(KanbanRow {
                id: generate_id("row"),
                title: row_title,
                stacks: Vec::new(),
                params: row_params,
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

            let (stack_title, stack_params) = parse_params(&line[3..]);
            current_stack = Some(KanbanStack {
                id: generate_id("stack"),
                title: stack_title,
                columns: Vec::new(),
                params: stack_params,
            });
            i += 1;
            continue;
        }

        // h3 heading: column
        if let Some(stripped) = line.strip_prefix("### ") {
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );
            push_column(&mut current_column, &mut current_stack, &mut current_row);

            let (column_title, col_params) = parse_params(stripped);
            current_column = Some(KanbanColumn {
                id: generate_id("col"),
                title: column_title,
                cards: Vec::new(),
                include_source: None,
                params: col_params,
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
            if trimmed.is_empty()
                && !line.starts_with("  ")
                && is_description_boundary(lines, i, true)
            {
                i += 1;
                continue;
            }
            let desc_line = line.strip_prefix("  ").unwrap_or(line);
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
