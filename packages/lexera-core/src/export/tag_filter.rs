use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

use crate::types::{KanbanBoard, KanbanCard, KanbanColumn, KanbanRow, KanbanStack};

// ---------------------------------------------------------------------------
// TagVisibility enum
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TagVisibility {
    #[default]
    All,
    #[serde(rename = "allexcludinglayout")]
    AllExcludingLayout,
    #[serde(rename = "customonly")]
    CustomOnly,
    #[serde(rename = "mentionsonly")]
    MentionsOnly,
    None,
}

impl TagVisibility {
    /// Parse from a string value (case-insensitive). Returns `All` for
    /// unrecognised values.
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "all" => Self::All,
            "allexcludinglayout" => Self::AllExcludingLayout,
            "customonly" => Self::CustomOnly,
            "mentionsonly" => Self::MentionsOnly,
            "none" => Self::None,
            _ => Self::All,
        }
    }
}

// ---------------------------------------------------------------------------
// Compiled regex singletons
// ---------------------------------------------------------------------------

fn basic_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"#[a-zA-Z][^\s]*").unwrap())
}

fn at_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|\s)(@[^\s]+)").unwrap())
}

fn row_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)#row\d*(?:\s|$)").unwrap())
}

fn span_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)#span\d*(?:\s|$)").unwrap())
}

fn stack_tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)#stack(?:\s|$)").unwrap())
}

fn multi_space_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"  +").unwrap())
}

fn task_line_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\s*)-\s*\[[xX\s]\]").unwrap())
}

/// The set of "configured" tags that `CustomOnly` mode strips out.
const CONFIGURED_TAG_BASES: &[&str] = &[
    "#urgent",
    "#high",
    "#medium",
    "#low",
    "#todo",
    "#doing",
    "#done",
    "#blocked",
    "#bug",
    "#feature",
    "#enhancement",
    "#red",
    "#green",
    "#blue",
    "#yellow",
    "#orange",
    "#row",
    "#span",
    "#stack",
];

// ---------------------------------------------------------------------------
// Tag visibility filtering (port of TagUtils)
// ---------------------------------------------------------------------------

/// Remove layout tags (#row, #span, #stack) and collapse whitespace.
fn strip_layout_tags(text: &str) -> String {
    let mut result = row_tag_re().replace_all(text, " ").to_string();
    result = span_tag_re().replace_all(&result, " ").to_string();
    result = stack_tag_re().replace_all(&result, " ").to_string();
    collapse_and_trim(&result)
}

/// Remove "configured" tags (status, priority, colour, layout) with optional
/// numeric suffix, then collapse whitespace.
fn strip_configured_tags(text: &str) -> String {
    let mut result = text.to_string();
    for base in CONFIGURED_TAG_BASES {
        let pattern = format!(r"(?i){}\d*(?:\s|$)", regex::escape(base));
        let re = Regex::new(&pattern).unwrap();
        result = re.replace_all(&result, " ").to_string();
    }
    collapse_and_trim(&result)
}

/// Remove all `#`-tags, collapse whitespace.
fn strip_hash_tags(text: &str) -> String {
    let result = basic_tag_re().replace_all(text, "").to_string();
    collapse_and_trim(&result)
}

/// Remove all `#`-tags AND `@`-mentions, collapse whitespace.
fn strip_all_tags(text: &str) -> String {
    let no_hash = basic_tag_re().replace_all(text, "").to_string();
    let no_at = at_tag_re().replace_all(&no_hash, "").to_string();
    collapse_and_trim(&no_at)
}

/// Collapse runs of multiple spaces into one and trim.
fn collapse_and_trim(s: &str) -> String {
    multi_space_re().replace_all(s, " ").trim().to_string()
}

/// Filter tags from a single text fragment according to `visibility`.
///
/// Leading whitespace is preserved (e.g. indented task lines).
pub fn filter_tags_from_text(text: &str, visibility: TagVisibility) -> String {
    if text.is_empty() {
        return String::new();
    }
    if visibility == TagVisibility::All {
        return text.to_string();
    }

    // Preserve leading whitespace.
    let leading_len = text.len() - text.trim_start().len();
    let leading = &text[..leading_len];
    let content = &text[leading_len..];

    let processed = match visibility {
        TagVisibility::All => unreachable!(),
        TagVisibility::AllExcludingLayout => strip_layout_tags(content),
        TagVisibility::CustomOnly => strip_configured_tags(content),
        TagVisibility::MentionsOnly => strip_hash_tags(content),
        TagVisibility::None => strip_all_tags(content),
    };

    format!("{}{}", leading, processed)
}

/// Process full markdown content: only transforms lines that contain tags or
/// are column headings / task lines.
pub fn process_markdown_content(content: &str, visibility: TagVisibility) -> String {
    if visibility == TagVisibility::All {
        return content.to_string();
    }

    let lines: Vec<&str> = content.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());

    for line in &lines {
        if line.starts_with("## ") {
            out.push(filter_tags_from_text(line, visibility));
        } else if task_line_re().is_match(line) {
            out.push(filter_tags_from_text(line, visibility));
        } else if line.contains('#') || line.contains('@') {
            out.push(filter_tags_from_text(line, visibility));
        } else {
            out.push(line.to_string());
        }
    }

    out.join("\n")
}

// ---------------------------------------------------------------------------
// Exclude-tag filtering (port of ExportService exclude methods)
// ---------------------------------------------------------------------------

/// Check whether `text` contains any of the `exclude_tags` (case-insensitive,
/// must appear at a word boundary -- followed by whitespace or end-of-string).
pub fn has_exclude_tag(text: &str, exclude_tags: &[String]) -> bool {
    if text.is_empty() || exclude_tags.is_empty() {
        return false;
    }
    for tag in exclude_tags {
        let pattern = format!(r"(?i){}(?:\s|$)", regex::escape(tag));
        if let Ok(re) = Regex::new(&pattern) {
            if re.is_match(text) {
                return true;
            }
        }
    }
    false
}

/// Remove excluded content from markdown.  Automatically detects whether the
/// content is in presentation format (slide separators `---`) or kanban format.
pub fn filter_excluded_from_markdown(content: &str, exclude_tags: &[String]) -> String {
    if exclude_tags.is_empty() {
        return content.to_string();
    }

    let is_presentation = content.contains("\n---\n") || content.starts_with("---\n");
    if is_presentation {
        filter_excluded_from_presentation(content, exclude_tags)
    } else {
        filter_excluded_from_kanban(content, exclude_tags)
    }
}

/// Filter slides: drop entire slide if its title contains an exclude tag,
/// otherwise strip individual lines that match.
pub fn filter_excluded_from_presentation(content: &str, exclude_tags: &[String]) -> String {
    if exclude_tags.is_empty() {
        return content.to_string();
    }

    let slides: Vec<&str> = content.split("\n---\n").collect();
    let mut filtered_slides: Vec<String> = Vec::new();

    for slide in &slides {
        let lines: Vec<&str> = slide.split('\n').collect();

        // Find the first non-empty, non-comment, non-separator "title" line.
        let title_line = lines.iter().find(|l| {
            let trimmed = l.trim();
            !trimmed.is_empty() && !trimmed.starts_with("<!--") && !trimmed.starts_with("---")
        });

        // If the title line carries an exclude tag, drop the whole slide.
        if let Some(title) = title_line {
            if has_exclude_tag(title, exclude_tags) {
                continue;
            }
        }

        // Otherwise keep lines that don't individually match.
        let kept: Vec<&str> = lines
            .into_iter()
            .filter(|l| !has_exclude_tag(l, exclude_tags))
            .collect();
        filtered_slides.push(kept.join("\n"));
    }

    filtered_slides.join("\n---\n")
}

/// Filter kanban markdown: drop excluded columns (## headings) and tasks,
/// including indented children of excluded tasks.
pub fn filter_excluded_from_kanban(content: &str, exclude_tags: &[String]) -> String {
    if exclude_tags.is_empty() {
        return content.to_string();
    }

    let lines: Vec<&str> = content.split('\n').collect();
    let mut result: Vec<&str> = Vec::new();
    let mut skip_until_next_section = false;
    let mut in_excluded_task = false;
    let mut task_indent_level: usize = 0;

    for line in &lines {
        let trimmed = line.trim();

        // Column heading
        if trimmed.starts_with("## ") {
            skip_until_next_section = has_exclude_tag(line, exclude_tags);
            in_excluded_task = false;
            if !skip_until_next_section {
                result.push(line);
            }
            continue;
        }

        if skip_until_next_section {
            continue;
        }

        // Task line (checkbox)
        if let Some(caps) = task_line_re().captures(line) {
            task_indent_level = caps.get(1).map_or(0, |m| m.as_str().len());
            in_excluded_task = has_exclude_tag(line, exclude_tags);
            if !in_excluded_task {
                result.push(line);
            }
            continue;
        }

        // Indented continuation of an excluded task
        let line_indent = line.len() - line.trim_start().len();
        if in_excluded_task && line_indent > task_indent_level && !trimmed.is_empty() {
            continue;
        }
        if line_indent <= task_indent_level && !trimmed.is_empty() {
            in_excluded_task = false;
        }

        // Standalone line with exclude tag
        if has_exclude_tag(line, exclude_tags) {
            continue;
        }

        result.push(line);
    }

    result.join("\n")
}

// ---------------------------------------------------------------------------
// Board-level exclude-tag filtering
// ---------------------------------------------------------------------------

/// Return a **new** board with columns and cards that carry an exclude tag
/// removed.  Works for both legacy format (flat columns) and new format
/// (rows/stacks/columns).
pub fn filter_excluded_from_board(board: &KanbanBoard, exclude_tags: &[String]) -> KanbanBoard {
    if exclude_tags.is_empty() {
        return board.clone();
    }

    log::info!(
        "[export.tag_filter.filter_excluded_from_board] filtering board with {} exclude tags",
        exclude_tags.len()
    );

    let filtered_columns = filter_columns(&board.columns, exclude_tags);
    let filtered_rows = filter_rows(&board.rows, exclude_tags);

    KanbanBoard {
        valid: board.valid,
        title: board.title.clone(),
        columns: filtered_columns,
        rows: filtered_rows,
        yaml_header: board.yaml_header.clone(),
        kanban_footer: board.kanban_footer.clone(),
        board_settings: board.board_settings.clone(),
    }
}

/// Filter a list of rows, drilling into stacks and columns.
fn filter_rows(rows: &[KanbanRow], exclude_tags: &[String]) -> Vec<KanbanRow> {
    rows.iter()
        .map(|row| KanbanRow {
            id: row.id.clone(),
            title: row.title.clone(),
            stacks: filter_stacks(&row.stacks, exclude_tags),
        })
        .collect()
}

/// Filter stacks, drilling into columns.
fn filter_stacks(stacks: &[KanbanStack], exclude_tags: &[String]) -> Vec<KanbanStack> {
    stacks
        .iter()
        .map(|stack| KanbanStack {
            id: stack.id.clone(),
            title: stack.title.clone(),
            columns: filter_columns(&stack.columns, exclude_tags),
        })
        .collect()
}

/// Filter columns: skip column entirely if its title carries an exclude tag,
/// otherwise filter cards within the column.
fn filter_columns(columns: &[KanbanColumn], exclude_tags: &[String]) -> Vec<KanbanColumn> {
    columns
        .iter()
        .filter(|col| !has_exclude_tag(&col.title, exclude_tags))
        .map(|col| KanbanColumn {
            id: col.id.clone(),
            title: col.title.clone(),
            cards: filter_cards(&col.cards, exclude_tags),
            include_source: col.include_source.clone(),
        })
        .collect()
}

/// Filter cards: drop cards whose card header contains an exclude tag, and for
/// remaining cards strip individual content lines that carry an exclude tag.
///
/// The "card header" is the contiguous block of non-empty lines from the start
/// of the content (per tag scoping rules).  If the header carries an exclude
/// tag the entire card is dropped; otherwise only individual body lines that
/// carry an exclude tag are removed.
fn filter_cards(cards: &[KanbanCard], exclude_tags: &[String]) -> Vec<KanbanCard> {
    cards
        .iter()
        .filter(|card| !card_header_has_exclude_tag(&card.content, exclude_tags))
        .map(|card| {
            let filtered_content = filter_card_content_lines(&card.content, exclude_tags);
            KanbanCard {
                id: card.id.clone(),
                content: filtered_content,
                checked: card.checked,
                kid: card.kid.clone(),
            }
        })
        .collect()
}

/// Check whether the card header (contiguous non-empty lines from the start)
/// contains any of the exclude tags.
fn card_header_has_exclude_tag(content: &str, exclude_tags: &[String]) -> bool {
    for line in content.split('\n') {
        if line.trim().is_empty() {
            break;
        }
        if has_exclude_tag(line, exclude_tags) {
            return true;
        }
    }
    false
}

/// Within a single card's content, remove individual lines that carry an
/// exclude tag while keeping the rest.
fn filter_card_content_lines(content: &str, exclude_tags: &[String]) -> String {
    content
        .split('\n')
        .filter(|line| !has_exclude_tag(line, exclude_tags))
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BoardSettings, IncludeSource};

    // Helper to create owned String from &str for exclude tag vectors.
    fn s(val: &str) -> String {
        val.to_string()
    }

    // ---- TagVisibility serde -------------------------------------------------

    #[test]
    fn tag_visibility_serialises_camel_case() {
        let json = serde_json::to_string(&TagVisibility::AllExcludingLayout).unwrap();
        assert_eq!(json, "\"allexcludinglayout\"");
    }

    #[test]
    fn tag_visibility_deserialises_camel_case() {
        let v: TagVisibility = serde_json::from_str("\"mentionsonly\"").unwrap();
        assert_eq!(v, TagVisibility::MentionsOnly);
    }

    #[test]
    fn tag_visibility_from_str_loose_roundtrip() {
        assert_eq!(TagVisibility::from_str_loose("none"), TagVisibility::None);
        assert_eq!(TagVisibility::from_str_loose("NONE"), TagVisibility::None);
        assert_eq!(
            TagVisibility::from_str_loose("unknown"),
            TagVisibility::All
        );
    }

    // ---- filter_tags_from_text -----------------------------------------------

    #[test]
    fn filter_tags_all_is_noop() {
        let input = "  hello #world @user";
        assert_eq!(filter_tags_from_text(input, TagVisibility::All), input);
    }

    #[test]
    fn filter_tags_empty_input() {
        assert_eq!(filter_tags_from_text("", TagVisibility::None), "");
    }

    #[test]
    fn filter_tags_allexcludinglayout_strips_layout() {
        let input = "Title #row2 #span3 #stack rest";
        let result = filter_tags_from_text(input, TagVisibility::AllExcludingLayout);
        assert_eq!(result, "Title rest");
    }

    #[test]
    fn filter_tags_allexcludinglayout_keeps_custom() {
        let input = "Title #urgent #feature";
        let result = filter_tags_from_text(input, TagVisibility::AllExcludingLayout);
        assert_eq!(result, "Title #urgent #feature");
    }

    #[test]
    fn filter_tags_customonly_strips_configured() {
        let input = "Fix login #urgent #bug #feature text";
        let result = filter_tags_from_text(input, TagVisibility::CustomOnly);
        assert_eq!(result, "Fix login text");
    }

    #[test]
    fn filter_tags_customonly_keeps_arbitrary_hash() {
        let input = "Fix #myproject stuff";
        let result = filter_tags_from_text(input, TagVisibility::CustomOnly);
        assert_eq!(result, "Fix #myproject stuff");
    }

    #[test]
    fn filter_tags_mentionsonly_strips_hash_keeps_at() {
        let input = "Hello #world @alice";
        let result = filter_tags_from_text(input, TagVisibility::MentionsOnly);
        assert_eq!(result, "Hello @alice");
    }

    #[test]
    fn filter_tags_none_strips_everything() {
        let input = "Hello #world @alice rest";
        let result = filter_tags_from_text(input, TagVisibility::None);
        assert_eq!(result, "Hello rest");
    }

    #[test]
    fn filter_tags_preserves_leading_whitespace() {
        let input = "    - [x] task #urgent";
        let result = filter_tags_from_text(input, TagVisibility::MentionsOnly);
        assert_eq!(result, "    - [x] task");
    }

    // ---- process_markdown_content --------------------------------------------

    #[test]
    fn process_markdown_content_all_is_noop() {
        let md = "## Col #row\n- [x] task #urgent\nplain line";
        assert_eq!(process_markdown_content(md, TagVisibility::All), md);
    }

    #[test]
    fn process_markdown_content_filters_headings() {
        let md = "## Column #row2\nplain line";
        let result = process_markdown_content(md, TagVisibility::AllExcludingLayout);
        assert_eq!(result, "## Column\nplain line");
    }

    #[test]
    fn process_markdown_content_filters_tasks() {
        let md = "- [ ] task #urgent\nplain line";
        let result = process_markdown_content(md, TagVisibility::MentionsOnly);
        assert_eq!(result, "- [ ] task\nplain line");
    }

    #[test]
    fn process_markdown_content_filters_lines_with_tags() {
        let md = "some text #tagged\nplain line";
        let result = process_markdown_content(md, TagVisibility::None);
        assert_eq!(result, "some text\nplain line");
    }

    #[test]
    fn process_markdown_content_skips_plain_lines() {
        let md = "nothing here\nno tags at all";
        let result = process_markdown_content(md, TagVisibility::None);
        assert_eq!(result, md);
    }

    // ---- has_exclude_tag -----------------------------------------------------

    #[test]
    fn has_exclude_tag_empty_inputs() {
        assert!(!has_exclude_tag("", &[s("#exclude")]));
        assert!(!has_exclude_tag("hello #exclude", &[]));
    }

    #[test]
    fn has_exclude_tag_matches_case_insensitive() {
        assert!(has_exclude_tag("hello #Exclude rest", &[s("#exclude")]));
    }

    #[test]
    fn has_exclude_tag_requires_boundary() {
        // "#ex" should NOT match inside "#exclude"
        assert!(!has_exclude_tag("hello #exclude", &[s("#ex")]));
    }

    #[test]
    fn has_exclude_tag_at_end_of_string() {
        assert!(has_exclude_tag("hello #exclude", &[s("#exclude")]));
    }

    #[test]
    fn has_exclude_tag_multiple_tags() {
        let tags = vec![s("#skip"), s("#hidden")];
        assert!(has_exclude_tag("task #hidden", &tags));
        assert!(!has_exclude_tag("task #visible", &tags));
    }

    // ---- filter_excluded_from_presentation -----------------------------------

    #[test]
    fn presentation_drops_slide_with_excluded_title() {
        let content =
            "# Slide 1\nContent\n---\n# Slide 2 #exclude\nSecret\n---\n# Slide 3\nMore";
        let result = filter_excluded_from_presentation(content, &[s("#exclude")]);
        assert!(result.contains("Slide 1"));
        assert!(!result.contains("Slide 2"));
        assert!(!result.contains("Secret"));
        assert!(result.contains("Slide 3"));
    }

    #[test]
    fn presentation_strips_excluded_lines_within_slide() {
        let content = "# Slide 1\nKeep this\nDrop this #exclude\nKeep too";
        let result = filter_excluded_from_presentation(content, &[s("#exclude")]);
        assert!(result.contains("Keep this"));
        assert!(!result.contains("Drop this"));
        assert!(result.contains("Keep too"));
    }

    #[test]
    fn presentation_empty_tags_is_noop() {
        let content = "# Slide\ntext";
        assert_eq!(filter_excluded_from_presentation(content, &[]), content);
    }

    // ---- filter_excluded_from_kanban -----------------------------------------

    #[test]
    fn kanban_skips_excluded_column() {
        let md = "## Todo\n- [ ] task1\n## Done #exclude\n- [x] task2\n## Archive\n- [ ] task3";
        let result = filter_excluded_from_kanban(md, &[s("#exclude")]);
        assert!(result.contains("## Todo"));
        assert!(!result.contains("## Done"));
        assert!(!result.contains("task2"));
        assert!(result.contains("## Archive"));
    }

    #[test]
    fn kanban_skips_excluded_task() {
        let md = "## Col\n- [ ] keep\n- [ ] drop #exclude\n- [ ] also keep";
        let result = filter_excluded_from_kanban(md, &[s("#exclude")]);
        assert!(result.contains("keep"));
        assert!(!result.contains("drop"));
        assert!(result.contains("also keep"));
    }

    #[test]
    fn kanban_skips_indented_children_of_excluded_task() {
        let md = "## Col\n- [ ] parent #exclude\n  child1\n  child2\n- [ ] next";
        let result = filter_excluded_from_kanban(md, &[s("#exclude")]);
        assert!(!result.contains("parent"));
        assert!(!result.contains("child1"));
        assert!(!result.contains("child2"));
        assert!(result.contains("next"));
    }

    #[test]
    fn kanban_strips_standalone_excluded_line() {
        let md = "## Col\n- [ ] task\nsome note #exclude\nkeep me";
        let result = filter_excluded_from_kanban(md, &[s("#exclude")]);
        assert!(!result.contains("some note"));
        assert!(result.contains("keep me"));
    }

    // ---- filter_excluded_from_markdown (auto-detect) -------------------------

    #[test]
    fn markdown_autodetects_presentation() {
        let content = "Slide 1\n---\nSlide 2 #exclude\n---\nSlide 3";
        let result = filter_excluded_from_markdown(content, &[s("#exclude")]);
        assert!(result.contains("Slide 1"));
        assert!(!result.contains("Slide 2"));
        assert!(result.contains("Slide 3"));
    }

    #[test]
    fn markdown_autodetects_kanban() {
        let content = "## Col\n- [ ] task #exclude\n- [ ] keep";
        let result = filter_excluded_from_markdown(content, &[s("#exclude")]);
        assert!(!result.contains("task #exclude"));
        assert!(result.contains("keep"));
    }

    // ---- filter_excluded_from_board ------------------------------------------

    fn make_card(id: &str, content: &str) -> KanbanCard {
        KanbanCard {
            id: id.to_string(),
            content: content.to_string(),
            checked: false,
            kid: None,
        }
    }

    fn make_column(id: &str, title: &str, cards: Vec<KanbanCard>) -> KanbanColumn {
        KanbanColumn {
            id: id.to_string(),
            title: title.to_string(),
            cards,
            include_source: None,
        }
    }

    fn make_legacy_board(columns: Vec<KanbanColumn>) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns,
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
        }
    }

    fn make_new_format_board(rows: Vec<KanbanRow>) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: vec![],
            rows,
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
        }
    }

    #[test]
    fn board_filter_empty_tags_returns_clone() {
        let board =
            make_legacy_board(vec![make_column("c1", "Todo", vec![make_card("1", "task")])]);
        let result = filter_excluded_from_board(&board, &[]);
        assert_eq!(result.columns.len(), 1);
        assert_eq!(result.columns[0].cards.len(), 1);
    }

    #[test]
    fn board_filter_drops_excluded_column_legacy() {
        let board = make_legacy_board(vec![
            make_column("c1", "Todo", vec![make_card("1", "task")]),
            make_column("c2", "Done #exclude", vec![make_card("2", "done task")]),
        ]);
        let result = filter_excluded_from_board(&board, &[s("#exclude")]);
        assert_eq!(result.columns.len(), 1);
        assert_eq!(result.columns[0].title, "Todo");
    }

    #[test]
    fn board_filter_drops_excluded_card() {
        let board = make_legacy_board(vec![make_column(
            "c1",
            "Todo",
            vec![
                make_card("1", "keep this"),
                make_card("2", "drop this #exclude"),
                make_card("3", "also keep"),
            ],
        )]);
        let result = filter_excluded_from_board(&board, &[s("#exclude")]);
        assert_eq!(result.columns[0].cards.len(), 2);
        assert_eq!(result.columns[0].cards[0].content, "keep this");
        assert_eq!(result.columns[0].cards[1].content, "also keep");
    }

    #[test]
    fn board_filter_strips_excluded_lines_from_card_content() {
        // Exclude tag is in the body (after the empty line), not the header,
        // so the card survives but the tagged line is stripped.
        let card_content = "first line\n\nsecond #exclude\nthird line";
        let board =
            make_legacy_board(vec![make_column("c1", "Col", vec![make_card("1", card_content)])]);
        let result = filter_excluded_from_board(&board, &[s("#exclude")]);
        assert_eq!(
            result.columns[0].cards[0].content,
            "first line\n\nthird line"
        );
    }

    #[test]
    fn board_filter_drops_card_when_header_has_exclude_tag() {
        // Exclude tag is in the card header (contiguous non-empty lines from start).
        let card_content = "title #exclude\nmore header\n\nbody text";
        let board =
            make_legacy_board(vec![make_column("c1", "Col", vec![make_card("1", card_content)])]);
        let result = filter_excluded_from_board(&board, &[s("#exclude")]);
        assert_eq!(result.columns[0].cards.len(), 0);
    }

    #[test]
    fn board_filter_new_format_rows() {
        let col1 = make_column("c1", "Todo", vec![make_card("1", "task")]);
        let col2 = make_column("c2", "Done #exclude", vec![make_card("2", "done")]);
        let stack = KanbanStack {
            id: "s1".to_string(),
            title: "Stack 1".to_string(),
            columns: vec![col1, col2],
        };
        let row = KanbanRow {
            id: "r1".to_string(),
            title: "Row 1".to_string(),
            stacks: vec![stack],
        };
        let board = make_new_format_board(vec![row]);
        let result = filter_excluded_from_board(&board, &[s("#exclude")]);
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].stacks[0].columns.len(), 1);
        assert_eq!(result.rows[0].stacks[0].columns[0].title, "Todo");
    }

    #[test]
    fn board_filter_new_format_card_within_row() {
        let col = make_column(
            "c1",
            "Col",
            vec![make_card("1", "visible"), make_card("2", "hidden #skip")],
        );
        let stack = KanbanStack {
            id: "s1".to_string(),
            title: "S".to_string(),
            columns: vec![col],
        };
        let row = KanbanRow {
            id: "r1".to_string(),
            title: "R".to_string(),
            stacks: vec![stack],
        };
        let board = make_new_format_board(vec![row]);
        let result = filter_excluded_from_board(&board, &[s("#skip")]);
        let cards = &result.rows[0].stacks[0].columns[0].cards;
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].content, "visible");
    }

    // ---- edge cases ----------------------------------------------------------

    #[test]
    fn customonly_strips_configured_with_numeric_suffix() {
        let input = "Title #row3 #urgent2";
        let result = filter_tags_from_text(input, TagVisibility::CustomOnly);
        assert_eq!(result, "Title");
    }

    #[test]
    fn allexcludinglayout_case_insensitive() {
        let input = "Title #ROW #SPAN2 #STACK end";
        let result = filter_tags_from_text(input, TagVisibility::AllExcludingLayout);
        assert_eq!(result, "Title end");
    }

    #[test]
    fn none_strips_at_tag_at_start_of_line() {
        let input = "@user mentioned here";
        let result = filter_tags_from_text(input, TagVisibility::None);
        assert_eq!(result, "mentioned here");
    }

    #[test]
    fn kanban_filter_handles_empty_lines() {
        let md = "## Col\n\n- [ ] task\n\n- [ ] task2 #exclude\n\ntrailing";
        let result = filter_excluded_from_kanban(md, &[s("#exclude")]);
        assert!(result.contains("task"));
        assert!(!result.contains("task2"));
        assert!(result.contains("trailing"));
    }

    #[test]
    fn board_filter_preserves_metadata() {
        let mut board = make_legacy_board(vec![make_column("c1", "Col", vec![])]);
        board.yaml_header = Some("---\ntitle: test\n---".to_string());
        board.kanban_footer = Some("footer".to_string());
        board.board_settings = Some(BoardSettings::default());
        let result = filter_excluded_from_board(&board, &[s("#x")]);
        assert_eq!(result.yaml_header, board.yaml_header);
        assert_eq!(result.kanban_footer, board.kanban_footer);
        assert!(result.board_settings.is_some());
    }

    #[test]
    fn board_filter_preserves_include_source() {
        let col = KanbanColumn {
            id: "c1".to_string(),
            title: "Col".to_string(),
            cards: vec![],
            include_source: Some(IncludeSource {
                raw_path: "./inc.md".to_string(),
                resolved_path: std::path::PathBuf::from("/abs/inc.md"),
            }),
        };
        let board = make_legacy_board(vec![col]);
        let result = filter_excluded_from_board(&board, &[s("#x")]);
        assert!(result.columns[0].include_source.is_some());
    }
}
