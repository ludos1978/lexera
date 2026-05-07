//! Legacy markdown format parser (`## column / - card` flat hierarchy).
//!
//! Columns in the legacy format used `#row<N>` and `#stack` tag tokens
//! in their headings to encode multi-row / multi-stack layout. This
//! module owns the logic that parses those tokens and converts the
//! flat column list into the rows/stacks/columns hierarchy the rest
//! of the codebase uses. External callers reach this through
//! `crate::parser::*` via the re-exports in `parser.rs`.

use std::collections::{BTreeMap, HashMap};

use crate::types::{KanbanBoard, KanbanCard, KanbanColumn, KanbanRow, KanbanStack};

use super::params::parse_task_line;
use super::{finalize_task, generate_id, is_description_boundary};

fn legacy_column_row_index(title: &str) -> usize {
    for token in title.split_whitespace() {
        let lower = token.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("#row") {
            if rest.is_empty() {
                return 1;
            }
            if let Ok(parsed) = rest.parse::<usize>() {
                return parsed.max(1);
            }
        }
    }
    1
}

fn legacy_column_has_stack_tag(title: &str) -> bool {
    title
        .split_whitespace()
        .any(|token| token.eq_ignore_ascii_case("#stack"))
}

fn strip_legacy_row_stack_tags(title: &str) -> String {
    let parts: Vec<&str> = title
        .split_whitespace()
        .filter(|token| {
            let lower = token.to_ascii_lowercase();
            if lower == "#stack" {
                return false;
            }
            if let Some(rest) = lower.strip_prefix("#row") {
                return !(rest.is_empty() || rest.chars().all(|c| c.is_ascii_digit()));
            }
            true
        })
        .collect();
    parts.join(" ").trim().to_string()
}

fn convert_legacy_columns_to_rows(parsed_columns: Vec<KanbanColumn>) -> Vec<KanbanRow> {
    if parsed_columns.is_empty() {
        return Vec::new();
    }

    let mut rows_by_index: BTreeMap<usize, Vec<(KanbanColumn, bool)>> = BTreeMap::new();
    for mut column in parsed_columns {
        let row_index = legacy_column_row_index(&column.title);
        let has_stack_tag = legacy_column_has_stack_tag(&column.title);
        column.title = strip_legacy_row_stack_tags(&column.title);
        rows_by_index
            .entry(row_index)
            .or_default()
            .push((column, has_stack_tag));
    }

    let has_any_tags = rows_by_index.len() > 1
        || rows_by_index.keys().any(|idx| *idx != 1)
        || rows_by_index
            .values()
            .any(|cols| cols.iter().any(|(_, has_stack)| *has_stack));
    let multiple_rows = rows_by_index.len() > 1 || rows_by_index.keys().any(|idx| *idx != 1);
    let mut rows = Vec::new();

    for (row_index, row_columns) in rows_by_index {
        let stacks = if !has_any_tags {
            // No #row/#stack tags: all columns go into a single Default stack
            let all_columns: Vec<KanbanColumn> =
                row_columns.into_iter().map(|(col, _)| col).collect();
            vec![KanbanStack {
                id: generate_id("stack"),
                title: "Default".to_string(),
                columns: all_columns,
                params: HashMap::new(),
            }]
        } else {
            // Has tags: group columns into stacks based on #stack tags
            let mut groups: Vec<Vec<KanbanColumn>> = Vec::new();
            for (column, has_stack_tag) in row_columns {
                if has_stack_tag && !groups.is_empty() {
                    groups.last_mut().unwrap().push(column);
                } else {
                    groups.push(vec![column]);
                }
            }

            groups
                .into_iter()
                .enumerate()
                .map(|(stack_index, group)| KanbanStack {
                    id: generate_id("stack"),
                    title: {
                        let stack_title = group
                            .first()
                            .map(|column| column.title.trim())
                            .filter(|title| !title.is_empty())
                            .unwrap_or("");
                        if stack_title.is_empty() {
                            format!("Stack {}", stack_index + 1)
                        } else {
                            stack_title.to_string()
                        }
                    },
                    columns: group,
                    params: HashMap::new(),
                })
                .collect()
        };

        rows.push(KanbanRow {
            id: generate_id("row"),
            title: if multiple_rows {
                format!("Row {}", row_index)
            } else {
                "Default".to_string()
            },
            stacks,
            params: HashMap::new(),
        });
    }

    rows
}

/// Parse legacy format: ## = column header, cards as list items.
/// Columns are wrapped in a Default row / Default stack so that the board
/// always uses the rows/stacks/columns hierarchy internally.
pub fn parse_legacy_format(lines: &[&str], board: &mut KanbanBoard) {
    let mut parsed_columns: Vec<KanbanColumn> = Vec::new();
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
        if let Some(column_title) = line.strip_prefix("## ") {
            finalize_task(
                &mut current_task,
                &mut current_column,
                &mut collecting_description,
            );
            if let Some(col) = current_column.take() {
                parsed_columns.push(col);
            }

            current_column = Some(KanbanColumn {
                id: generate_id("col"),
                title: column_title.to_string(),
                cards: Vec::new(),
                include_source: None,
                params: HashMap::new(),
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
                && is_description_boundary(lines, i, false)
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

    // Finalize last task and column
    finalize_task(
        &mut current_task,
        &mut current_column,
        &mut collecting_description,
    );
    if let Some(col) = current_column.take() {
        parsed_columns.push(col);
    }

    // Convert legacy flat columns into rows/stacks using the same layout tags
    // the UI understands: #rowN selects the row bucket and #stack appends the
    // column to the preceding stack anchor in that row.
    board.rows = convert_legacy_columns_to_rows(parsed_columns);

    if !footer_lines.is_empty() {
        board.kanban_footer = Some(footer_lines.join("\n"));
    }
}
