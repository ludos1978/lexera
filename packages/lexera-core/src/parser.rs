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
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::include::resolver::resolve_include_path;
use crate::include::slide_parser;
use crate::include::syntax;
use crate::merge::card_identity;
use crate::types::{
    BoardFormat, BoardSettings, GenerationMeta, IncludeSource, KanbanBoard, KanbanCard,
    KanbanColumn, KanbanRow, KanbanStack, BOARD_SETTING_KEYS, GENERATION_META_KEYS,
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
    let new_format = detect_new_format(&lines);

    if new_format {
        board.format_hint = BoardFormat::New;
        parse_new_format(&lines, &mut board);
    } else {
        board.format_hint = BoardFormat::Legacy;
        parse_legacy_format(&lines, &mut board);
    }

    board.board_settings = Some(parse_board_settings(
        board.yaml_header.as_deref().unwrap_or(""),
    ));
    board.generation_meta = Some(parse_generation_meta(
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

/// Extract inline `{key:value, key:value}` parameters from the end of a heading or task line.
/// Returns `(cleaned_text, params)` where `cleaned_text` has the param block stripped.
/// Handles missing, empty, and malformed params gracefully — returns empty map on failure.
pub fn parse_params(text: &str) -> (String, HashMap<String, String>) {
    let trimmed = text.trim_end();
    if !trimmed.ends_with('}') {
        return (text.to_string(), HashMap::new());
    }

    // Find the matching opening brace — scan backwards from the closing brace.
    // We skip nested braces (e.g. markdown content that might contain {}).
    let bytes = trimmed.as_bytes();
    let mut depth = 0i32;
    let mut open_pos = None;
    for i in (0..bytes.len()).rev() {
        if bytes[i] == b'}' {
            depth += 1;
        } else if bytes[i] == b'{' {
            depth -= 1;
            if depth == 0 {
                open_pos = Some(i);
                break;
            }
        }
    }

    let open = match open_pos {
        Some(p) => p,
        None => return (text.to_string(), HashMap::new()),
    };

    let inner = &trimmed[open + 1..trimmed.len() - 1];
    let mut params = HashMap::new();

    for pair in inner.split(',') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        if let Some(colon) = pair.find(':') {
            let key = pair[..colon].trim();
            let value = pair[colon + 1..].trim();
            if !key.is_empty() {
                params.insert(key.to_string(), value.to_string());
            }
        }
    }

    if params.is_empty() {
        // Malformed or empty braces — preserve original text
        return (text.to_string(), HashMap::new());
    }

    let before = trimmed[..open].trim_end();
    (before.to_string(), params)
}

/// Format params back into `{key:value, key:value}` string for markdown output.
pub fn format_params(params: &HashMap<String, String>) -> String {
    if params.is_empty() {
        return String::new();
    }
    // Sort keys for deterministic output
    let mut keys: Vec<&String> = params.keys().collect();
    keys.sort();
    let pairs: Vec<String> = keys
        .iter()
        .map(|k| format!("{}:{}", k, params[*k]))
        .collect();
    format!(" {{{}}}", pairs.join(", "))
}

/// Parse a task line (- [ ] or - [x]) and return the card and whether we're collecting description.
fn parse_task_line(line: &str) -> Option<KanbanCard> {
    if !line.starts_with("- ") {
        return None;
    }
    let checked = line.starts_with("- [x] ") || line.starts_with("- [X] ");
    let task_summary = if line.len() >= 6 { &line[6..] } else { "" };
    let (summary_clean, card_params) = parse_params(task_summary);
    let kid = card_identity::extract_kid(&summary_clean);
    Some(KanbanCard {
        id: generate_id("task"),
        content: card_identity::strip_kid(&summary_clean),
        checked,
        kid,
        params: card_params,
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
                .map(|(stack_index, group)| {
                    KanbanStack {
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
                    }
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
fn parse_legacy_format(lines: &[&str], board: &mut KanbanBoard) {
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
        "boardLayout" => settings.board_layout = None,
        "canvasSurface" => settings.canvas_surface = None,
        "canvasGrid" => settings.canvas_grid = None,
        "canvasPageSize" => settings.canvas_page_size = None,
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Generation metadata (staleness detection)
// ---------------------------------------------------------------------------

/// Strip the YAML front matter from content, returning only the body.
fn strip_yaml_header(content: &str) -> &str {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return content;
    }
    // Skip the opening "---" line
    let after_open = match trimmed.strip_prefix("---") {
        Some(rest) => rest.strip_prefix('\n').unwrap_or(rest),
        None => return content,
    };
    // Find the closing "---"
    if let Some(end_pos) = after_open.find("\n---") {
        let after_close = &after_open[end_pos + 4..]; // skip "\n---"
        after_close.strip_prefix('\n').unwrap_or(after_close)
    } else {
        content // No closing ---, return everything
    }
}

/// Compute SHA-256 hash of the board body (everything after the YAML front matter).
/// If no YAML header is present, hashes the entire content.
pub fn body_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let body = strip_yaml_header(content);
    let mut hasher = Sha256::new();
    hasher.update(body.replace("\r\n", "\n").as_bytes());
    hex::encode(hasher.finalize())
}

/// Parse generation metadata from a YAML header string.
pub fn parse_generation_meta(yaml_header: &str) -> GenerationMeta {
    let mut meta = GenerationMeta::default();
    if yaml_header.is_empty() {
        return meta;
    }
    for line in yaml_header.lines() {
        if let Some(colon_pos) = line.find(':') {
            let key = line[..colon_pos].trim();
            let value = line[colon_pos + 1..].trim();
            if value.is_empty() {
                continue;
            }
            match key {
                "generation" => meta.generation = value.parse().ok(),
                "contentHash" => meta.content_hash = Some(value.to_string()),
                "dependencyHash" => meta.dependency_hash = Some(value.to_string()),
                "resolvedHash" => meta.resolved_hash = Some(value.to_string()),
                "writerId" => meta.writer_id = Some(value.to_string()),
                _ => {}
            }
        }
    }
    meta
}

/// Update or insert generation metadata keys in a YAML header string.
/// Expects a complete YAML header (with opening and closing `---`).
pub fn update_yaml_with_generation_meta(yaml_header: &str, meta: &GenerationMeta) -> String {
    if yaml_header.is_empty() {
        return yaml_header.to_string();
    }

    let lines: Vec<&str> = yaml_header.split('\n').collect();
    let mut result: Vec<String> = Vec::new();
    let mut written_keys: Vec<&str> = Vec::new();

    for line in &lines {
        if let Some(colon_pos) = line.find(':') {
            let key = line[..colon_pos].trim();
            if GENERATION_META_KEYS.contains(&key) {
                // Replace with current value (or drop if None)
                if let Some(val) = meta_value_for_key(meta, key) {
                    result.push(format!("{}: {}", key, val));
                }
                written_keys.push(key);
                continue;
            }
        }
        result.push(line.to_string());
    }

    // Insert missing keys before closing ---
    if let Some(closing_index) = result.iter().rposition(|l| l.trim() == "---") {
        if closing_index > 0 {
            let mut new_entries: Vec<String> = Vec::new();
            for key in GENERATION_META_KEYS {
                if !written_keys.contains(key) {
                    if let Some(val) = meta_value_for_key(meta, key) {
                        new_entries.push(format!("{}: {}", key, val));
                    }
                }
            }
            for (j, s) in new_entries.into_iter().enumerate() {
                result.insert(closing_index + j, s);
            }
        }
    }

    result.join("\n")
}

/// Get the string value for a generation meta key.
fn meta_value_for_key(meta: &GenerationMeta, key: &str) -> Option<String> {
    match key {
        "generation" => meta.generation.map(|g| g.to_string()),
        "contentHash" => meta.content_hash.clone(),
        "dependencyHash" => meta.dependency_hash.clone(),
        "resolvedHash" => meta.resolved_hash.clone(),
        "writerId" => meta.writer_id.clone(),
        _ => None,
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
        assert_eq!(md1, md2, "Legacy format markdown should be idempotent after first normalization");
    }

    #[test]
    fn test_new_format_text_idempotency() {
        let board1 = parse_markdown(NEW_FORMAT_BOARD);
        let md1 = generate_markdown(&board1);
        let board2 = parse_markdown(&md1);
        let md2 = generate_markdown(&board2);
        assert_eq!(md1, md2, "New format markdown should be idempotent after first normalization");
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
    fn test_parse_params_basic() {
        let (text, params) = parse_params("My Title {x:100, y:200}");
        assert_eq!(text, "My Title");
        assert_eq!(params.get("x").unwrap(), "100");
        assert_eq!(params.get("y").unwrap(), "200");
    }

    #[test]
    fn test_parse_params_no_params() {
        let (text, params) = parse_params("Plain Title");
        assert_eq!(text, "Plain Title");
        assert!(params.is_empty());
    }

    #[test]
    fn test_parse_params_empty_braces() {
        let (text, params) = parse_params("Title {}");
        assert_eq!(text, "Title {}");
        assert!(params.is_empty());
    }

    #[test]
    fn test_parse_params_single_param() {
        let (text, params) = parse_params("Stack {w:400}");
        assert_eq!(text, "Stack");
        assert_eq!(params.len(), 1);
        assert_eq!(params.get("w").unwrap(), "400");
    }

    #[test]
    fn test_parse_params_all_stack_params() {
        let (text, params) = parse_params("Stack A {x:50, y:100, w:400, h:300, dir:row}");
        assert_eq!(text, "Stack A");
        assert_eq!(params.get("x").unwrap(), "50");
        assert_eq!(params.get("y").unwrap(), "100");
        assert_eq!(params.get("w").unwrap(), "400");
        assert_eq!(params.get("h").unwrap(), "300");
        assert_eq!(params.get("dir").unwrap(), "row");
    }

    #[test]
    fn test_parse_params_with_whitespace() {
        let (text, params) = parse_params("Title {  key : value , other : stuff  }");
        assert_eq!(text, "Title");
        assert_eq!(params.get("key").unwrap(), "value");
        assert_eq!(params.get("other").unwrap(), "stuff");
    }

    #[test]
    fn test_format_params_roundtrip() {
        let (_, params) = parse_params("Title {a:1, b:2}");
        let formatted = format_params(&params);
        assert!(formatted.contains("a:1"));
        assert!(formatted.contains("b:2"));
        assert!(formatted.starts_with(" {"));
        assert!(formatted.ends_with('}'));
    }

    #[test]
    fn test_format_params_empty() {
        let params = HashMap::new();
        assert_eq!(format_params(&params), "");
    }

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
        assert_eq!(board.rows[0].stacks[0].columns[0].cards[0].content, "My Task");
    }

    #[test]
    fn test_no_params_board_unchanged() {
        let md = "---\nkanban-plugin: board\n---\n\n# Row\n\n## Stack\n\n### Column\n- [ ] Task\n";
        let board = parse_markdown(md);
        assert!(board.rows[0].params.is_empty());
        assert!(board.rows[0].stacks[0].params.is_empty());
        assert!(board.rows[0].stacks[0].columns[0].params.is_empty());
        assert!(board.rows[0].stacks[0].columns[0].cards[0].params.is_empty());

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
        assert_eq!(stack_b2.params.get("dir").map(|s| s.as_str()), Some("vertical"));

        // Board should now be in kanban mode
        let settings2 = board2.board_settings.as_ref().unwrap();
        assert_eq!(settings2.board_layout.as_deref(), Some("kanban"));

        // Output should contain all canvas params despite kanban mode
        assert!(md_out.contains("boardLayout: kanban"));
        assert!(md_out.contains("{h:300, w:400, x:100, y:200}"));
        assert!(md_out.contains("{dir:vertical,"));
    }
}
