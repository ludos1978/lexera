use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::types::{KanbanBoard, KanbanColumn, IncludeSource};
use super::tag_filter::{TagVisibility, process_markdown_content, has_exclude_tag};

// ---------------------------------------------------------------------------
// Compiled regexes (allocated once via OnceLock)
// ---------------------------------------------------------------------------

fn yaml_frontmatter_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^---[ \t]*\n[\s\S]*?\n---[ \t]*\n").unwrap())
}

fn html_comment_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<!--[\s\S]*?-->").unwrap())
}

fn comment_placeholder_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"__COMMENT_PLACEHOLDER_(\d+)__").unwrap())
}

fn slide_separator_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\n[ \t]*\n---[ \t]*\n[ \t]*\n").unwrap())
}

fn include_syntax_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!!!include\([^)]+\)!!!").unwrap())
}

fn crlf_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\r\n?").unwrap())
}

fn md_image_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?").unwrap())
}

fn md_include_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!!!include\(([^)]+)\)!!!").unwrap())
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// A single parsed presentation slide.
#[derive(Debug, Clone, PartialEq)]
pub struct PresentationSlide {
    pub content: String,
    pub slide_number: usize,
}

fn default_tag_visibility() -> TagVisibility {
    TagVisibility::All
}

/// Options controlling presentation / document generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationOptions {
    /// Include Marp YAML frontmatter (default: false).
    #[serde(default)]
    pub include_marp_directives: bool,

    /// Strip `!!!include(...)!!!` syntax from content (default: false).
    #[serde(default)]
    pub strip_includes: bool,

    /// Tag visibility filter applied to exported content.
    #[serde(default = "default_tag_visibility")]
    pub tag_visibility: TagVisibility,

    /// Tags whose presence causes a card / line to be excluded.
    #[serde(default)]
    pub exclude_tags: Vec<String>,

    /// Marp theme name (default: "default").
    #[serde(default)]
    pub marp_theme: Option<String>,

    /// CSS classes applied to every slide via the YAML `class:` directive.
    #[serde(default)]
    pub marp_global_classes: Vec<String>,

    /// CSS classes prepended as `<!-- _class: ... -->` to every slide.
    #[serde(default)]
    pub marp_local_classes: Vec<String>,

    /// Per-slide class overrides: slide index -> class list.
    #[serde(default)]
    pub per_slide_classes: Option<HashMap<usize, Vec<String>>>,

    /// Arbitrary key-value pairs merged into the YAML frontmatter.
    #[serde(default)]
    pub custom_yaml: Option<HashMap<String, String>>,
}

impl Default for PresentationOptions {
    fn default() -> Self {
        Self {
            include_marp_directives: false,
            strip_includes: false,
            tag_visibility: TagVisibility::All,
            exclude_tags: Vec::new(),
            marp_theme: None,
            marp_global_classes: Vec::new(),
            marp_local_classes: Vec::new(),
            per_slide_classes: None,
            custom_yaml: None,
        }
    }
}

/// Page-break strategy for `to_document`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageBreaks {
    Continuous,
    PerTask,
    PerColumn,
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Parse a Marp-style presentation markdown string into individual slides.
///
/// Handles:
/// - CRLF normalisation
/// - YAML frontmatter stripping
/// - HTML comment protection (prevents `---` inside comments from acting as separators)
pub fn parse_presentation(content: &str) -> Vec<PresentationSlide> {
    if content.is_empty() {
        return Vec::new();
    }

    // Normalise line endings (CRLF / CR -> LF)
    let working = normalize_crlf(content);

    // Strip YAML frontmatter if present
    let working = if let Some(m) = yaml_frontmatter_re().find(&working) {
        working[m.end()..].to_string()
    } else {
        working
    };

    // Protect HTML comments by replacing them with placeholders
    let mut comments: Vec<String> = Vec::new();
    let with_placeholders = html_comment_re()
        .replace_all(&working, |caps: &regex::Captures| {
            let idx = comments.len();
            comments.push(caps[0].to_string());
            format!("__COMMENT_PLACEHOLDER_{idx}__")
        })
        .into_owned();

    // Split on slide separators: \n<blank>\n---<blank>\n<blank>\n
    let raw_slides: Vec<&str> = slide_separator_re().split(&with_placeholders).collect();

    raw_slides
        .iter()
        .enumerate()
        .map(|(index, slide_content)| {
            // Restore HTML comments from placeholders
            let restored = comment_placeholder_re()
                .replace_all(slide_content, |caps: &regex::Captures| {
                    let idx_str = &caps[1];
                    if let Ok(idx) = idx_str.parse::<usize>() {
                        comments
                            .get(idx)
                            .cloned()
                            .unwrap_or_else(|| caps[0].to_string())
                    } else {
                        caps[0].to_string()
                    }
                })
                .into_owned();

            PresentationSlide {
                content: restored,
                slide_number: index + 1,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/// Generate presentation markdown from an entire board.
///
/// Uses `board.all_columns()` so both legacy (flat columns) and new
/// (rows/stacks/columns) formats are supported.
pub fn from_board(board: &KanbanBoard, options: &PresentationOptions) -> String {
    let columns = board.all_columns();
    let col_refs: Vec<&KanbanColumn> = columns.into_iter().collect();
    from_columns(&col_refs, options)
}

/// Generate presentation markdown from a slice of column references.
pub fn from_columns(columns: &[&KanbanColumn], options: &PresentationOptions) -> String {
    let mut slide_contents: Vec<String> = Vec::new();

    for column in columns {
        let column_title = match get_processed_column_title(column, options) {
            Some(t) => t,
            None => continue,
        };

        // Column title slide (title + blank trailing line)
        slide_contents.push(format!("{column_title}\n\n"));

        // Task slides
        let tasks = filter_tasks(&column.cards, options);
        for card in &tasks {
            let content = match &column.include_source {
                Some(src) => resolve_include_card_paths(&card.content, src),
                None => card.content.clone(),
            };
            slide_contents.push(task_to_slide_content(&content, options));
        }
    }

    format_output(&slide_contents, options)
}

/// Generate a document (Pandoc-friendly) from an entire board.
///
/// Column titles become `# Heading` lines. Optional `\newpage` breaks
/// can be inserted per-task or per-column.
pub fn to_document(
    board: &KanbanBoard,
    page_breaks: PageBreaks,
    options: &PresentationOptions,
) -> String {
    let mut lines: Vec<String> = Vec::new();
    let columns = board.all_columns();

    for column in &columns {
        let column_title = match get_processed_column_title(column, options) {
            Some(t) => t,
            None => continue,
        };

        lines.push(format!("# {column_title}"));
        lines.push(String::new());

        let tasks = filter_tasks(&column.cards, options);

        for card in &tasks {
            let raw_content = match &column.include_source {
                Some(src) => resolve_include_card_paths(&card.content, src),
                None => card.content.clone(),
            };
            let mut content = normalize_crlf(&raw_content);

            if options.strip_includes {
                content = include_syntax_re()
                    .replace_all(&content, "")
                    .to_string();
                content = content.trim().to_string();
            }

            if options.tag_visibility != TagVisibility::All {
                content = process_markdown_content(&content, options.tag_visibility);
            }

            if !options.exclude_tags.is_empty() {
                content = filter_excluded_lines(&content, &options.exclude_tags);
            }

            if !content.is_empty() {
                lines.push(content);
                lines.push(String::new());
            }

            if page_breaks == PageBreaks::PerTask {
                lines.push("\\newpage".to_string());
                lines.push(String::new());
            }
        }

        if page_breaks == PageBreaks::PerColumn {
            lines.push("\\newpage".to_string());
            lines.push(String::new());
        }
    }

    lines.join("\n")
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Normalise CRLF / lone CR to LF.
fn normalize_crlf(s: &str) -> String {
    crlf_re().replace_all(s, "\n").into_owned()
}

/// Check whether a path is a relative resource path (not absolute, not external).
fn is_relative_resource_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() { return false; }
    if trimmed.starts_with('#') { return false; }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") { return false; }
    if trimmed.starts_with("mailto:") || trimmed.starts_with("data:") { return false; }
    !Path::new(trimmed).is_absolute()
}

/// Join a base directory with a relative path, resolving `.` and `..`.
fn join_relative_path(base_dir: &str, rel_path: &str) -> String {
    let base = Path::new(base_dir);
    let joined = base.join(rel_path);
    // Normalize the path by resolving . and ..
    let mut parts: Vec<&std::ffi::OsStr> = Vec::new();
    for component in joined.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => { parts.pop(); }
            other => { parts.push(other.as_os_str()); }
        }
    }
    let result: std::path::PathBuf = parts.iter().collect();
    result.to_string_lossy().to_string()
}

/// Rewrite relative paths in markdown content so they resolve relative to
/// the board directory instead of the include file's directory.
/// `include_source.raw_path` is the include file path relative to the board dir.
fn resolve_include_card_paths(content: &str, include_source: &IncludeSource) -> String {
    let include_dir = Path::new(&include_source.raw_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if include_dir.is_empty() {
        return content.to_string();
    }

    // Rewrite image embeds: ![alt](path){attrs}
    let result = md_image_re().replace_all(content, |caps: &regex::Captures| {
        let alt = &caps[1];
        let raw_target = &caps[2];
        let attrs = caps.get(3).map(|m| m.as_str()).unwrap_or("");
        if !is_relative_resource_path(raw_target) {
            return caps[0].to_string();
        }
        let resolved = join_relative_path(&include_dir, raw_target);
        format!("![{alt}]({resolved}){attrs}")
    }).into_owned();

    // Rewrite links: [label](path)
    // Must avoid re-matching already rewritten image embeds — images start with `!`
    // Use a manual scan approach instead
    let result = rewrite_markdown_links(&result, &include_dir);

    // Rewrite include directives: !!!include(path)!!!
    let result = md_include_re().replace_all(&result, |caps: &regex::Captures| {
        let raw_path = &caps[1];
        if !is_relative_resource_path(raw_path) {
            return caps[0].to_string();
        }
        let resolved = join_relative_path(&include_dir, raw_path);
        format!("!!!include({resolved})!!!")
    }).into_owned();

    result
}

/// Rewrite markdown links [label](path) without touching image embeds ![alt](path).
fn rewrite_markdown_links(content: &str, include_dir: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Skip image embeds (handled separately)
        if i + 1 < bytes.len() && bytes[i] == b'!' && bytes[i + 1] == b'[' {
            // Find the closing ](...)
            if let Some(end) = find_markdown_link_end(&content[i + 1..]) {
                let chunk = &content[i..i + 1 + end];
                result.push_str(chunk);
                // Skip optional {attrs}
                let after = i + 1 + end;
                if after < bytes.len() && bytes[after] == b'{' {
                    if let Some(close) = content[after..].find('}') {
                        result.push_str(&content[after..after + close + 1]);
                        i = after + close + 1;
                        continue;
                    }
                }
                i = after;
                continue;
            }
        }
        // Match [label](path)
        if bytes[i] == b'[' {
            if let Some((label, path, total_len)) = parse_md_link(&content[i..]) {
                if is_relative_resource_path(&path) {
                    let resolved = join_relative_path(include_dir, &path);
                    result.push_str(&format!("[{label}]({resolved})"));
                } else {
                    result.push_str(&content[i..i + total_len]);
                }
                i += total_len;
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

/// Find the end of a markdown link starting at `[` — returns position after `)`.
fn find_markdown_link_end(s: &str) -> Option<usize> {
    let close_bracket = s.find(']')?;
    let after = close_bracket + 1;
    if s.as_bytes().get(after) != Some(&b'(') { return None; }
    let close_paren = s[after..].find(')')? + after + 1;
    Some(close_paren)
}

/// Parse a markdown link `[label](path)` at the start of `s`.
/// Returns (label, path, total_bytes_consumed).
fn parse_md_link(s: &str) -> Option<(String, String, usize)> {
    if !s.starts_with('[') { return None; }
    let close_bracket = s.find(']')?;
    let label = &s[1..close_bracket];
    let after = close_bracket + 1;
    if s.as_bytes().get(after) != Some(&b'(') { return None; }
    let paren_content_start = after + 1;
    let close_paren = s[paren_content_start..].find(')')? + paren_content_start;
    let path = &s[paren_content_start..close_paren];
    Some((label.to_string(), path.to_string(), close_paren + 1))
}

/// Process a column title: check exclude tags, optionally strip include syntax.
/// Returns `None` if the column should be excluded.
fn get_processed_column_title(
    column: &KanbanColumn,
    options: &PresentationOptions,
) -> Option<String> {
    let mut title = column.title.clone();

    if has_exclude_tag(&title, &options.exclude_tags) {
        return None;
    }

    if options.strip_includes {
        title = include_syntax_re().replace_all(&title, "").to_string();
        title = title.trim().to_string();
    }

    Some(title)
}

/// Filter cards: remove those matching any exclude tag.
fn filter_tasks<'a>(
    cards: &'a [crate::types::KanbanCard],
    options: &PresentationOptions,
) -> Vec<&'a crate::types::KanbanCard> {
    if options.exclude_tags.is_empty() {
        return cards.iter().collect();
    }
    cards
        .iter()
        .filter(|card| !has_exclude_tag(&card.content, &options.exclude_tags))
        .collect()
}

/// Convert a single card's content into slide content.
fn task_to_slide_content(content: &str, options: &PresentationOptions) -> String {
    let mut result = normalize_crlf(content);

    if options.strip_includes {
        // Strip include syntax from first line only (matches TS behaviour)
        if let Some(newline_pos) = result.find('\n') {
            let first_line = &result[..newline_pos];
            let cleaned = include_syntax_re()
                .replace_all(first_line, "")
                .to_string();
            let cleaned = cleaned.trim();
            result = format!("{cleaned}{}", &result[newline_pos..]);
        } else {
            result = include_syntax_re().replace_all(&result, "").to_string();
            result = result.trim().to_string();
        }
    }

    if !options.exclude_tags.is_empty() {
        result = filter_excluded_lines(&result, &options.exclude_tags);
    }

    result
}

/// Remove lines containing any of the exclude tags.
fn filter_excluded_lines(content: &str, exclude_tags: &[String]) -> String {
    if exclude_tags.is_empty() {
        return content.to_string();
    }
    content
        .split('\n')
        .filter(|line| !has_exclude_tag(line, exclude_tags))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Join slide contents into the final Marp presentation string.
fn format_output(slide_contents: &[String], options: &PresentationOptions) -> String {
    // Apply tag filtering
    let filtered: Vec<String> = if options.tag_visibility != TagVisibility::All {
        slide_contents
            .iter()
            .map(|c| process_markdown_content(c, options.tag_visibility))
            .collect()
    } else {
        slide_contents.to_vec()
    };

    // Apply Marp class directives
    let final_contents: Vec<String> = filtered
        .iter()
        .enumerate()
        .map(|(index, content)| {
            let mut result = content.clone();

            // Per-slide class overrides (prepended first so they appear before local)
            if let Some(ref per_slide) = options.per_slide_classes {
                if let Some(classes) = per_slide.get(&index) {
                    if !classes.is_empty() {
                        let directive =
                            format!("<!-- _class: {} -->\n\n", classes.join(" "));
                        result = format!("{directive}{result}");
                    }
                }
            }

            // Local classes applied to every slide
            if !options.marp_local_classes.is_empty() {
                let directive = format!(
                    "<!-- _class: {} -->\n\n",
                    options.marp_local_classes.join(" ")
                );
                result = format!("{directive}{result}");
            }

            result
        })
        .collect();

    let body = final_contents.join("\n\n---\n\n");

    if options.include_marp_directives {
        let yaml = build_yaml_frontmatter(options);
        format!("{yaml}{body}")
    } else {
        body
    }
}

/// Build the YAML frontmatter block for Marp.
fn build_yaml_frontmatter(options: &PresentationOptions) -> String {
    // Collect all key-value pairs in insertion order
    let mut entries: Vec<(String, YamlValue)> = Vec::new();

    entries.push(("marp".to_string(), YamlValue::Bool(true)));
    entries.push((
        "theme".to_string(),
        YamlValue::Str(
            options
                .marp_theme
                .as_deref()
                .unwrap_or("default")
                .to_string(),
        ),
    ));

    if !options.marp_global_classes.is_empty() {
        entries.push((
            "class".to_string(),
            YamlValue::Str(options.marp_global_classes.join(" ")),
        ));
    }

    // Merge custom YAML
    if let Some(ref custom) = options.custom_yaml {
        for (key, value) in custom {
            entries.push((key.clone(), YamlValue::Str(value.clone())));
        }
    }

    let mut result = String::from("---\n");
    for (key, value) in &entries {
        match value {
            YamlValue::Str(s) => {
                result.push_str(&format!("{key}: \"{s}\"\n"));
            }
            YamlValue::Bool(b) => {
                result.push_str(&format!("{key}: {b}\n"));
            }
        }
    }
    result.push_str("---\n\n");

    result
}

/// Internal representation of a YAML value for frontmatter generation.
enum YamlValue {
    Str(String),
    Bool(bool),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{KanbanBoard, KanbanCard, KanbanColumn};

    // -- Helpers --

    fn card(content: &str) -> KanbanCard {
        KanbanCard {
            id: "c1".to_string(),
            content: content.to_string(),
            checked: false,
            kid: None,
        }
    }

    fn column_with(title: &str, cards: Vec<KanbanCard>) -> KanbanColumn {
        KanbanColumn {
            id: "col1".to_string(),
            title: title.to_string(),
            cards,
            include_source: None,
        }
    }

    fn board_with(columns: Vec<KanbanColumn>) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test".to_string(),
            columns,
            rows: Vec::new(),
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
        }
    }

    fn default_opts() -> PresentationOptions {
        PresentationOptions::default()
    }

    // ======================================================================
    // parse_presentation
    // ======================================================================

    #[test]
    fn parse_empty_string() {
        assert!(parse_presentation("").is_empty());
    }

    #[test]
    fn parse_single_slide() {
        let slides = parse_presentation("Hello world");
        assert_eq!(slides.len(), 1);
        assert_eq!(slides[0].content, "Hello world");
        assert_eq!(slides[0].slide_number, 1);
    }

    #[test]
    fn parse_multiple_slides() {
        let input = "Slide 1\n\n---\n\nSlide 2\n\n---\n\nSlide 3";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 3);
        assert_eq!(slides[0].content, "Slide 1");
        assert_eq!(slides[1].content, "Slide 2");
        assert_eq!(slides[2].content, "Slide 3");
        assert_eq!(slides[2].slide_number, 3);
    }

    #[test]
    fn parse_strips_yaml_frontmatter() {
        let input = "---\nmarp: true\ntheme: default\n---\nFirst slide\n\n---\n\nSecond slide";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0].content, "First slide");
        assert_eq!(slides[1].content, "Second slide");
    }

    #[test]
    fn parse_yaml_with_trailing_spaces() {
        let input = "---  \t\nmarp: true\n---  \nContent here";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 1);
        assert_eq!(slides[0].content, "Content here");
    }

    #[test]
    fn parse_html_comment_protection() {
        // The --- inside the comment must NOT be treated as a slide separator
        let input =
            "Before\n\n<!-- a comment\n---\nstill comment -->\n\nAfter separator\n\n---\n\nReal slide 2";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 2);
        assert!(slides[0]
            .content
            .contains("<!-- a comment\n---\nstill comment -->"));
        assert_eq!(slides[1].content, "Real slide 2");
    }

    #[test]
    fn parse_preserves_html_comments() {
        let input = "<!-- kid:abc123 -->\n# Title\n\nBody text";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 1);
        assert!(slides[0].content.contains("<!-- kid:abc123 -->"));
    }

    #[test]
    fn parse_crlf_normalisation() {
        let input = "Slide 1\r\n\r\n---\r\n\r\nSlide 2";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0].content, "Slide 1");
        assert_eq!(slides[1].content, "Slide 2");
    }

    #[test]
    fn parse_separator_with_whitespace_lines() {
        // Blank lines around --- may contain spaces/tabs
        let input = "Slide A\n \n--- \n \nSlide B";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0].content, "Slide A");
        assert_eq!(slides[1].content, "Slide B");
    }

    // ======================================================================
    // Round-trip: parse -> rejoin -> parse
    // ======================================================================

    #[test]
    fn round_trip_simple() {
        let original = "## Column\n\n\n\n---\n\nCard 1\n\n---\n\nCard 2";
        let slides = parse_presentation(original);
        assert_eq!(slides.len(), 3);

        // Re-join with the same separator
        let rejoined = slides
            .iter()
            .map(|s| s.content.clone())
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");
        assert_eq!(rejoined, original);
    }

    #[test]
    fn round_trip_with_html_comments() {
        let original =
            "<!-- kid:a --> Slide 1\n\n---\n\n<!-- kid:b --> Slide 2\n\n---\n\nSlide 3";
        let slides = parse_presentation(original);
        let rejoined = slides
            .iter()
            .map(|s| s.content.clone())
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");
        assert_eq!(rejoined, original);
    }

    // ======================================================================
    // from_board / from_columns
    // ======================================================================

    #[test]
    fn from_board_single_column() {
        let b = board_with(vec![column_with(
            "My Column",
            vec![card("Task A"), card("Task B")],
        )]);
        let output = from_board(&b, &default_opts());
        assert!(output.contains("My Column"));
        assert!(output.contains("Task A"));
        assert!(output.contains("Task B"));
        // Slides separated by ---
        assert!(output.contains("\n\n---\n\n"));
    }

    #[test]
    fn from_board_excludes_column_by_tag() {
        let opts = PresentationOptions {
            exclude_tags: vec!["#private".to_string()],
            ..default_opts()
        };
        let b = board_with(vec![
            column_with("Public", vec![card("visible")]),
            column_with("Secret #private", vec![card("hidden")]),
        ]);
        let output = from_board(&b, &opts);
        assert!(output.contains("Public"));
        assert!(output.contains("visible"));
        assert!(!output.contains("Secret"));
        assert!(!output.contains("hidden"));
    }

    #[test]
    fn from_board_excludes_cards_by_tag() {
        let opts = PresentationOptions {
            exclude_tags: vec!["#exclude".to_string()],
            ..default_opts()
        };
        let b = board_with(vec![column_with(
            "Col",
            vec![card("keep me"), card("drop me #exclude")],
        )]);
        let output = from_board(&b, &opts);
        assert!(output.contains("keep me"));
        assert!(!output.contains("drop me"));
    }

    #[test]
    fn from_board_strip_includes() {
        let opts = PresentationOptions {
            strip_includes: true,
            ..default_opts()
        };
        let b = board_with(vec![column_with(
            "Title !!!include(file.md)!!!",
            vec![card("!!!include(other.md)!!! Card text\nline 2")],
        )]);
        let output = from_board(&b, &opts);
        assert!(!output.contains("!!!include"));
        assert!(output.contains("Title"));
        assert!(output.contains("Card text"));
    }

    #[test]
    fn from_board_with_marp_directives() {
        let opts = PresentationOptions {
            include_marp_directives: true,
            marp_theme: Some("gaia".to_string()),
            marp_global_classes: vec!["invert".to_string()],
            ..default_opts()
        };
        let b = board_with(vec![column_with("Slide", vec![card("Content")])]);
        let output = from_board(&b, &opts);
        assert!(output.starts_with("---\n"));
        assert!(output.contains("marp: true"));
        assert!(output.contains("theme: \"gaia\""));
        assert!(output.contains("class: \"invert\""));
        assert!(output.contains("---\n\n"));
    }

    #[test]
    fn from_board_with_local_classes() {
        let opts = PresentationOptions {
            marp_local_classes: vec!["lead".to_string(), "invert".to_string()],
            ..default_opts()
        };
        let b = board_with(vec![column_with("Title", vec![card("Body")])]);
        let output = from_board(&b, &opts);
        assert!(output.contains("<!-- _class: lead invert -->"));
    }

    #[test]
    fn from_board_with_per_slide_classes() {
        let mut per_slide = HashMap::new();
        per_slide.insert(1, vec!["highlight".to_string()]);
        let opts = PresentationOptions {
            per_slide_classes: Some(per_slide),
            ..default_opts()
        };
        let b = board_with(vec![column_with("Title", vec![card("Body")])]);
        let output = from_board(&b, &opts);
        // Slide index 1 (the card slide) should have highlight class
        assert!(output.contains("<!-- _class: highlight -->"));
    }

    #[test]
    fn from_board_custom_yaml() {
        let mut custom = HashMap::new();
        custom.insert("paginate".to_string(), "true".to_string());
        custom.insert("header".to_string(), "My Header".to_string());
        let opts = PresentationOptions {
            include_marp_directives: true,
            custom_yaml: Some(custom),
            ..default_opts()
        };
        let b = board_with(vec![column_with("S", vec![card("C")])]);
        let output = from_board(&b, &opts);
        assert!(output.contains("paginate: \"true\""));
        assert!(output.contains("header: \"My Header\""));
    }

    // ======================================================================
    // to_document
    // ======================================================================

    #[test]
    fn to_document_continuous() {
        let b = board_with(vec![
            column_with("Chapter 1", vec![card("Para A"), card("Para B")]),
            column_with("Chapter 2", vec![card("Para C")]),
        ]);
        let output = to_document(&b, PageBreaks::Continuous, &default_opts());
        assert!(output.contains("# Chapter 1"));
        assert!(output.contains("# Chapter 2"));
        assert!(output.contains("Para A"));
        assert!(output.contains("Para B"));
        assert!(output.contains("Para C"));
        assert!(!output.contains("\\newpage"));
    }

    #[test]
    fn to_document_per_task() {
        let b = board_with(vec![column_with("Ch", vec![card("A"), card("B")])]);
        let output = to_document(&b, PageBreaks::PerTask, &default_opts());
        let count = output.matches("\\newpage").count();
        assert_eq!(count, 2);
    }

    #[test]
    fn to_document_per_column() {
        let b = board_with(vec![
            column_with("C1", vec![card("X")]),
            column_with("C2", vec![card("Y")]),
        ]);
        let output = to_document(&b, PageBreaks::PerColumn, &default_opts());
        let count = output.matches("\\newpage").count();
        assert_eq!(count, 2);
    }

    #[test]
    fn to_document_strip_includes() {
        let opts = PresentationOptions {
            strip_includes: true,
            ..default_opts()
        };
        let b = board_with(vec![column_with(
            "Ch",
            vec![card("!!!include(x.md)!!! Hello world")],
        )]);
        let output = to_document(&b, PageBreaks::Continuous, &opts);
        assert!(!output.contains("!!!include"));
        assert!(output.contains("Hello world"));
    }

    #[test]
    fn to_document_exclude_tags_drops_entire_card() {
        // has_exclude_tag checks the full card content, so a card containing
        // an exclude tag on ANY line is dropped entirely by filter_tasks.
        let opts = PresentationOptions {
            exclude_tags: vec!["#secret".to_string()],
            ..default_opts()
        };
        let b = board_with(vec![column_with(
            "Ch",
            vec![
                card("Visible card"),
                card("Line 1\nLine 2 #secret\nLine 3"),
            ],
        )]);
        let output = to_document(&b, PageBreaks::Continuous, &opts);
        assert!(output.contains("Visible card"));
        // Entire card is dropped because its content contains #secret
        assert!(!output.contains("Line 1"));
        assert!(!output.contains("Line 2"));
        assert!(!output.contains("Line 3"));
    }

    #[test]
    fn to_document_filter_excluded_lines_within_card() {
        // filterExcludedLines in toDocument strips individual lines AFTER
        // the card passes the card-level filter. This tests a card that passes
        // card-level filter (no exclude tag in content visible to has_exclude_tag)
        // but has lines removed by filterExcludedLines with a different tag.
        // Since both use the same tag set, we verify the line-level filter
        // by checking filter_excluded_lines directly.
        let content = "keep\nremove #private\nalso keep";
        let result = filter_excluded_lines(content, &["#private".to_string()]);
        assert_eq!(result, "keep\nalso keep");
    }

    #[test]
    fn to_document_exclude_column() {
        let opts = PresentationOptions {
            exclude_tags: vec!["#hidden".to_string()],
            ..default_opts()
        };
        let b = board_with(vec![
            column_with("Visible", vec![card("ok")]),
            column_with("Hidden #hidden", vec![card("nope")]),
        ]);
        let output = to_document(&b, PageBreaks::Continuous, &opts);
        assert!(output.contains("Visible"));
        assert!(!output.contains("Hidden"));
        assert!(!output.contains("nope"));
    }

    // ======================================================================
    // YAML frontmatter
    // ======================================================================

    #[test]
    fn yaml_frontmatter_defaults() {
        let opts = default_opts();
        let yaml = build_yaml_frontmatter(&opts);
        assert!(yaml.starts_with("---\n"));
        assert!(yaml.ends_with("---\n\n"));
        assert!(yaml.contains("marp: true"));
        assert!(yaml.contains("theme: \"default\""));
    }

    #[test]
    fn yaml_frontmatter_custom_theme() {
        let opts = PresentationOptions {
            marp_theme: Some("uncover".to_string()),
            ..default_opts()
        };
        let yaml = build_yaml_frontmatter(&opts);
        assert!(yaml.contains("theme: \"uncover\""));
    }

    #[test]
    fn yaml_frontmatter_with_global_classes() {
        let opts = PresentationOptions {
            marp_global_classes: vec!["lead".to_string(), "invert".to_string()],
            ..default_opts()
        };
        let yaml = build_yaml_frontmatter(&opts);
        assert!(yaml.contains("class: \"lead invert\""));
    }

    // ======================================================================
    // filter_excluded_lines
    // ======================================================================

    #[test]
    fn filter_excluded_lines_basic() {
        let content = "keep\nremove #exclude\nalso keep";
        let result = filter_excluded_lines(content, &["#exclude".to_string()]);
        assert_eq!(result, "keep\nalso keep");
    }

    #[test]
    fn filter_excluded_lines_no_tags() {
        let content = "keep\nalso keep";
        let result = filter_excluded_lines(content, &["#exclude".to_string()]);
        assert_eq!(result, "keep\nalso keep");
    }

    #[test]
    fn filter_excluded_lines_empty_tags() {
        let content = "line1 #foo\nline2";
        let result = filter_excluded_lines(content, &[]);
        assert_eq!(result, content);
    }

    // ======================================================================
    // normalize_crlf
    // ======================================================================

    #[test]
    fn crlf_to_lf() {
        assert_eq!(normalize_crlf("a\r\nb\rc"), "a\nb\nc");
    }

    #[test]
    fn lf_unchanged() {
        assert_eq!(normalize_crlf("a\nb\nc"), "a\nb\nc");
    }

    // ======================================================================
    // include stripping
    // ======================================================================

    #[test]
    fn strip_include_syntax_from_content() {
        let opts = PresentationOptions {
            strip_includes: true,
            ..default_opts()
        };
        let result = task_to_slide_content("!!!include(foo.md)!!! Title\nBody", &opts);
        assert!(!result.contains("!!!include"));
        assert!(result.contains("Title"));
        assert!(result.contains("Body"));
    }

    #[test]
    fn strip_include_preserves_rest_of_first_line() {
        let opts = PresentationOptions {
            strip_includes: true,
            ..default_opts()
        };
        let result = task_to_slide_content("!!!include(x.md)!!! Hello\nworld", &opts);
        assert_eq!(result, "Hello\nworld");
    }

    #[test]
    fn strip_include_single_line() {
        let opts = PresentationOptions {
            strip_includes: true,
            ..default_opts()
        };
        let result = task_to_slide_content("!!!include(z.md)!!! Only line", &opts);
        assert_eq!(result, "Only line");
    }

    // ======================================================================
    // Edge cases
    // ======================================================================

    #[test]
    fn empty_board_produces_empty_output() {
        let b = board_with(vec![]);
        let output = from_board(&b, &default_opts());
        assert!(output.is_empty());
    }

    #[test]
    fn column_with_no_cards() {
        let b = board_with(vec![column_with("Empty Col", vec![])]);
        let output = from_board(&b, &default_opts());
        assert!(output.contains("Empty Col"));
    }

    #[test]
    fn multiple_comments_restored_correctly() {
        let input = "<!-- c1 -->\nA\n\n---\n\n<!-- c2 -->\nB\n\n---\n\n<!-- c3 -->\nC";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 3);
        assert!(slides[0].content.contains("<!-- c1 -->"));
        assert!(slides[1].content.contains("<!-- c2 -->"));
        assert!(slides[2].content.contains("<!-- c3 -->"));
    }

    #[test]
    fn parse_preserves_multiline_content_within_slide() {
        let input = "Line 1\nLine 2\nLine 3";
        let slides = parse_presentation(input);
        assert_eq!(slides.len(), 1);
        assert_eq!(slides[0].content, "Line 1\nLine 2\nLine 3");
    }

    #[test]
    fn default_options_sensible() {
        let opts = PresentationOptions::default();
        assert!(!opts.include_marp_directives);
        assert!(!opts.strip_includes);
        assert_eq!(opts.tag_visibility, TagVisibility::All);
        assert!(opts.exclude_tags.is_empty());
        assert!(opts.marp_theme.is_none());
        assert!(opts.marp_global_classes.is_empty());
        assert!(opts.marp_local_classes.is_empty());
        assert!(opts.per_slide_classes.is_none());
        assert!(opts.custom_yaml.is_none());
    }

    #[test]
    fn multiple_columns_produces_correct_structure() {
        let b = board_with(vec![
            column_with("Col A", vec![card("A1"), card("A2")]),
            column_with("Col B", vec![card("B1")]),
        ]);
        let output = from_board(&b, &default_opts());
        // Structure: ColA title --- A1 --- A2 --- ColB title --- B1
        let slides = parse_presentation(&output);
        assert_eq!(slides.len(), 5);
        assert!(slides[0].content.contains("Col A"));
        assert!(slides[1].content.contains("A1"));
        assert!(slides[2].content.contains("A2"));
        assert!(slides[3].content.contains("Col B"));
        assert!(slides[4].content.contains("B1"));
    }

    // ======================================================================
    // resolve_include_card_paths
    // ======================================================================

    fn include_source(raw_path: &str) -> IncludeSource {
        IncludeSource {
            raw_path: raw_path.to_string(),
            resolved_path: std::path::PathBuf::new(),
        }
    }

    #[test]
    fn resolve_include_paths_rewrites_images() {
        let src = include_source("./sub/slides.md");
        let content = "![photo](./photo.jpg)";
        let result = resolve_include_card_paths(content, &src);
        assert_eq!(result, "![photo](sub/photo.jpg)");
    }

    #[test]
    fn resolve_include_paths_rewrites_links() {
        let src = include_source("./sub/slides.md");
        let content = "[doc](./readme.md)";
        let result = resolve_include_card_paths(content, &src);
        assert_eq!(result, "[doc](sub/readme.md)");
    }

    #[test]
    fn resolve_include_paths_rewrites_nested_includes() {
        let src = include_source("./sub/slides.md");
        let content = "!!!include(./deeper/nested.md)!!!";
        let result = resolve_include_card_paths(content, &src);
        assert_eq!(result, "!!!include(sub/deeper/nested.md)!!!");
    }

    #[test]
    fn resolve_include_paths_leaves_absolute_paths() {
        let src = include_source("./sub/slides.md");
        let content = "![photo](/abs/photo.jpg)";
        let result = resolve_include_card_paths(content, &src);
        assert_eq!(result, "![photo](/abs/photo.jpg)");
    }

    #[test]
    fn resolve_include_paths_leaves_external_urls() {
        let src = include_source("./sub/slides.md");
        let content = "![logo](https://example.com/logo.png)";
        let result = resolve_include_card_paths(content, &src);
        assert_eq!(result, "![logo](https://example.com/logo.png)");
    }

    #[test]
    fn resolve_include_paths_no_include_source_dir() {
        let src = include_source("slides.md");
        let content = "![photo](./photo.jpg)";
        let result = resolve_include_card_paths(content, &src);
        // No parent dir to prepend, path unchanged
        assert_eq!(result, "![photo](./photo.jpg)");
    }

    #[test]
    fn resolve_include_paths_image_with_attrs() {
        let src = include_source("./sub/slides.md");
        let content = "![photo](./photo.jpg){width=300}";
        let result = resolve_include_card_paths(content, &src);
        assert_eq!(result, "![photo](sub/photo.jpg){width=300}");
    }

    #[test]
    fn resolve_include_paths_mixed_content() {
        let src = include_source("./root/mid/presentation.md");
        let content = "# Slide\n\n![img](./image.png)\n\nSome text [link](./doc.pdf)\n\n!!!include(./extra.md)!!!";
        let result = resolve_include_card_paths(content, &src);
        assert!(result.contains("![img](root/mid/image.png)"));
        assert!(result.contains("[link](root/mid/doc.pdf)"));
        assert!(result.contains("!!!include(root/mid/extra.md)!!!"));
    }

    #[test]
    fn resolve_include_paths_does_not_mangle_image_links() {
        let src = include_source("./sub/slides.md");
        let content = "![photo](./photo.jpg)\n[doc](./readme.md)";
        let result = resolve_include_card_paths(content, &src);
        assert!(result.contains("![photo](sub/photo.jpg)"));
        assert!(result.contains("[doc](sub/readme.md)"));
    }

    #[test]
    fn from_board_include_column_rewrites_paths() {
        let col = KanbanColumn {
            id: "col1".to_string(),
            title: "Slides".to_string(),
            cards: vec![card("![img](./photo.jpg)")],
            include_source: Some(include_source("./sub/slides.md")),
        };
        let b = board_with(vec![col]);
        let output = from_board(&b, &default_opts());
        assert!(output.contains("sub/photo.jpg"));
        assert!(!output.contains("./photo.jpg"));
    }

    #[test]
    fn to_document_include_column_rewrites_paths() {
        let col = KanbanColumn {
            id: "col1".to_string(),
            title: "Chapter".to_string(),
            cards: vec![card("![img](./image.png)")],
            include_source: Some(include_source("./deep/notes.md")),
        };
        let b = board_with(vec![col]);
        let output = to_document(&b, PageBreaks::Continuous, &default_opts());
        assert!(output.contains("deep/image.png"));
        assert!(!output.contains("./image.png"));
    }
}
