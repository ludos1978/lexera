use log::debug;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SpeakerNoteMode {
    Comment,
    Keep,
    Remove,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum HtmlCommentMode {
    Keep,
    Remove,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum HtmlContentMode {
    Keep,
    Remove,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Keep,
    Kanban,
    Presentation,
    Document,
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TransformOptions {
    pub speaker_note_mode: Option<SpeakerNoteMode>,
    pub html_comment_mode: Option<HtmlCommentMode>,
    pub html_content_mode: Option<HtmlContentMode>,
    pub format: ExportFormat,
}

// ---------------------------------------------------------------------------
// Compiled regex patterns (allocated once)
// ---------------------------------------------------------------------------

fn re_html_comment_all() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Matches all HTML comments (including multiline via (?s)).
        Regex::new(r"(?s)<!--(.*?)-->").unwrap()
    })
}

fn re_code_block() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Match fenced code blocks (``` ... ```) or inline code (` ... `).
        // (?s) so `.` matches newlines inside fenced blocks.
        Regex::new(r"(?s)```[\s\S]*?```|`[^`]+`").unwrap()
    })
}

fn re_html_tag_all() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Matches all `<...>` sequences (single-line only).
        Regex::new(r"<(.*?)>").unwrap()
    })
}

fn re_code_placeholder() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"___CODE_BLOCK_PLACEHOLDER___(\d+)___CODE_BLOCK_PLACEHOLDER___").unwrap()
    })
}

fn re_leading_whitespace() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\s*)").unwrap())
}

fn re_list_item() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Matches list items: `- `, `* `, `+ `, `1. `, `1) ` with optional leading whitespace.
        Regex::new(r"^([ \t]*)(?:[-*+]|\d+[.)]) ").unwrap()
    })
}

fn re_speaker_note_prefix() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\s*SPEAKER-NOTE:").unwrap())
}

// ---------------------------------------------------------------------------
// Individual transform functions
// ---------------------------------------------------------------------------

/// Transforms speaker-note lines (lines starting with `;;`).
///
/// - `Keep`: returns content unchanged.
/// - `Comment`: wraps consecutive `;;` lines in an HTML comment.
/// - `Remove`: strips `;;` lines entirely.
pub fn apply_speaker_note_transform(content: &str, mode: SpeakerNoteMode) -> String {
    if mode == SpeakerNoteMode::Keep {
        return content.to_string();
    }

    debug!("[export.content_transform.speaker_note] mode={:?}", mode);

    let lines: Vec<&str> = content.split('\n').collect();
    let mut result: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        if trimmed.starts_with(";;") {
            // Capture the indent of the first speaker-note line.
            let indent = re_leading_whitespace()
                .find(line)
                .map(|m| m.as_str())
                .unwrap_or("");

            let mut note_lines: Vec<&str> = Vec::new();

            // Collect consecutive `;;` lines.
            while i < lines.len() && lines[i].trim().starts_with(";;") {
                let note_content = lines[i].trim().strip_prefix(";;").unwrap().trim();
                note_lines.push(note_content);
                i += 1;
            }

            match mode {
                SpeakerNoteMode::Comment => {
                    let combined = note_lines.join("\n");
                    result.push(format!("{}<!-- {} -->", indent, combined));
                }
                SpeakerNoteMode::Remove => {
                    // Don't add anything.
                }
                SpeakerNoteMode::Keep => unreachable!(),
            }
        } else {
            result.push(line.to_string());
            i += 1;
        }
    }

    result.join("\n")
}

/// Removes HTML comments from content, preserving `SPEAKER-NOTE:` comments.
///
/// - `Keep`: returns content unchanged.
/// - `Remove`: strips non-speaker-note HTML comments.
pub fn apply_html_comment_transform(content: &str, mode: HtmlCommentMode) -> String {
    if mode == HtmlCommentMode::Keep {
        return content.to_string();
    }

    debug!("[export.content_transform.html_comment] removing HTML comments");

    // Match all HTML comments, but only remove those that are NOT speaker notes.
    re_html_comment_all()
        .replace_all(content, |caps: &regex::Captures| {
            let inner = &caps[1];
            if re_speaker_note_prefix().is_match(inner) {
                // Preserve SPEAKER-NOTE comments.
                caps[0].to_string()
            } else {
                String::new()
            }
        })
        .into_owned()
}

/// Removes HTML tags from content while preserving code blocks, HTML comments,
/// and `<http(s)://...>` URL references.
///
/// - `Keep`: returns content unchanged.
/// - `Remove`: strips HTML tags outside code blocks.
pub fn apply_html_content_transform(content: &str, mode: HtmlContentMode) -> String {
    if mode == HtmlContentMode::Keep {
        return content.to_string();
    }

    debug!("[export.content_transform.html_content] removing HTML tags");

    // Step 1: Protect code blocks by replacing them with placeholders.
    let mut code_blocks: Vec<String> = Vec::new();
    let protected = re_code_block()
        .replace_all(content, |caps: &regex::Captures| {
            let idx = code_blocks.len();
            code_blocks.push(caps[0].to_string());
            format!("___CODE_BLOCK_PLACEHOLDER___{}___CODE_BLOCK_PLACEHOLDER___", idx)
        })
        .into_owned();

    // Step 2: Remove HTML tags but preserve <!-- comments --> and <http(s):// URLs>.
    let cleaned = re_html_tag_all()
        .replace_all(&protected, |caps: &regex::Captures| {
            let full = &caps[0];
            let inner = &caps[1];
            // Preserve HTML comments (start with `!--`)
            if inner.starts_with("!--") {
                return full.to_string();
            }
            // Preserve URL references like <https://...> or </https://...>
            let check = inner.trim_start_matches('/');
            if check.starts_with("http://") || check.starts_with("https://") {
                return full.to_string();
            }
            // Remove all other tags.
            String::new()
        })
        .into_owned();

    // Step 3: Restore code blocks from placeholders.
    let restored = re_code_placeholder()
        .replace_all(&cleaned, |caps: &regex::Captures| {
            let idx: usize = caps[1].parse().unwrap_or(0);
            code_blocks.get(idx).cloned().unwrap_or_default()
        })
        .into_owned();

    restored
}

/// Inserts `<!-- -->` comment separators between list blocks that are separated
/// by blank lines but would otherwise be merged into a single list by Markdown
/// renderers (e.g. Marp/reveal.js).
pub fn apply_list_split_transform(content: &str) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut result: Vec<String> = Vec::with_capacity(lines.len());
    let mut in_list_context = false;
    let mut list_indent: usize = 0;
    let mut blank_buffer: Vec<&str> = Vec::new();

    for line in &lines {
        let is_blank = line.trim().is_empty();

        if is_blank {
            blank_buffer.push(line);
            continue;
        }

        let item_match = re_list_item().captures(line);
        let is_list_item = item_match.is_some();

        if is_list_item && in_list_context && !blank_buffer.is_empty() {
            let item_indent = item_match.as_ref().unwrap()[1].len();
            if item_indent <= list_indent {
                // Blank lines between same-level (or less-indented) list items:
                // insert a comment to break the list.
                for b in &blank_buffer {
                    result.push(b.to_string());
                }
                result.push("<!-- -->".to_string());
            } else {
                for b in &blank_buffer {
                    result.push(b.to_string());
                }
            }
        } else {
            for b in &blank_buffer {
                result.push(b.to_string());
            }
        }

        blank_buffer.clear();
        result.push(line.to_string());

        if is_list_item {
            in_list_context = true;
            list_indent = item_match.unwrap()[1].len();
        } else {
            let line_indent = re_leading_whitespace()
                .find(line)
                .map(|m| m.as_str().len())
                .unwrap_or(0);
            if !in_list_context || line_indent <= list_indent {
                in_list_context = false;
            }
        }
    }

    // Flush remaining blank lines.
    for b in &blank_buffer {
        result.push(b.to_string());
    }

    result.join("\n")
}

// ---------------------------------------------------------------------------
// Master transform
// ---------------------------------------------------------------------------

/// Applies all content transformations for presentation export.
///
/// Transforms are only applied when `options.format` is `Presentation`.
/// The order is: speaker notes -> HTML comments -> HTML tags -> list splits.
pub fn apply_transforms(content: &str, options: &TransformOptions) -> String {
    if options.format != ExportFormat::Presentation {
        return content.to_string();
    }

    debug!("[export.content_transform.apply_transforms] applying presentation transforms");

    let mut result = content.to_string();

    if let Some(mode) = options.speaker_note_mode {
        result = apply_speaker_note_transform(&result, mode);
    }

    if let Some(mode) = options.html_comment_mode {
        result = apply_html_comment_transform(&result, mode);
    }

    if let Some(mode) = options.html_content_mode {
        result = apply_html_content_transform(&result, mode);
    }

    result = apply_list_split_transform(&result);

    result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // SpeakerNoteMode
    // -----------------------------------------------------------------------

    #[test]
    fn speaker_note_keep_returns_unchanged() {
        let input = "line1\n;; note\nline2";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Keep);
        assert_eq!(out, input);
    }

    #[test]
    fn speaker_note_remove_strips_lines() {
        let input = "line1\n;; note A\n;; note B\nline2";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Remove);
        assert_eq!(out, "line1\nline2");
    }

    #[test]
    fn speaker_note_comment_wraps_in_html() {
        let input = "line1\n;; note A\n;; note B\nline2";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Comment);
        assert_eq!(out, "line1\n<!-- note A\nnote B -->\nline2");
    }

    #[test]
    fn speaker_note_preserves_indent() {
        let input = "    ;; indented note";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Comment);
        assert_eq!(out, "    <!-- indented note -->");
    }

    #[test]
    fn speaker_note_empty_note_content() {
        let input = ";;";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Comment);
        assert_eq!(out, "<!--  -->");
    }

    #[test]
    fn speaker_note_no_notes_returns_unchanged() {
        let input = "just plain text\nno notes here";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Remove);
        assert_eq!(out, input);
    }

    // -----------------------------------------------------------------------
    // HtmlCommentMode
    // -----------------------------------------------------------------------

    #[test]
    fn html_comment_keep_returns_unchanged() {
        let input = "text <!-- comment --> more";
        let out = apply_html_comment_transform(input, HtmlCommentMode::Keep);
        assert_eq!(out, input);
    }

    #[test]
    fn html_comment_remove_strips_comments() {
        let input = "before <!-- gone --> after";
        let out = apply_html_comment_transform(input, HtmlCommentMode::Remove);
        assert_eq!(out, "before  after");
    }

    #[test]
    fn html_comment_preserves_speaker_note_comments() {
        let input = "<!-- SPEAKER-NOTE: keep me -->";
        let out = apply_html_comment_transform(input, HtmlCommentMode::Remove);
        assert_eq!(out, input);
    }

    #[test]
    fn html_comment_removes_multiline() {
        let input = "a\n<!-- multi\nline\ncomment -->b";
        let out = apply_html_comment_transform(input, HtmlCommentMode::Remove);
        assert_eq!(out, "a\nb");
    }

    #[test]
    fn html_comment_multiple_comments() {
        let input = "<!-- a -->text<!-- b -->end";
        let out = apply_html_comment_transform(input, HtmlCommentMode::Remove);
        assert_eq!(out, "textend");
    }

    // -----------------------------------------------------------------------
    // HtmlContentMode
    // -----------------------------------------------------------------------

    #[test]
    fn html_content_keep_returns_unchanged() {
        let input = "text <b>bold</b> end";
        let out = apply_html_content_transform(input, HtmlContentMode::Keep);
        assert_eq!(out, input);
    }

    #[test]
    fn html_content_removes_tags() {
        let input = "text <b>bold</b> end";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "text bold end");
    }

    #[test]
    fn html_content_preserves_comments() {
        let input = "text <!-- keep --> end";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "text <!-- keep --> end");
    }

    #[test]
    fn html_content_preserves_url_refs() {
        let input = "see <https://example.com> for details";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, input);
    }

    #[test]
    fn html_content_preserves_code_blocks() {
        let input = "text `<b>inline</b>` end";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "text `<b>inline</b>` end");
    }

    #[test]
    fn html_content_preserves_fenced_code() {
        let input = "before\n```html\n<div>keep</div>\n```\nafter <span>remove</span>";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(
            out,
            "before\n```html\n<div>keep</div>\n```\nafter remove"
        );
    }

    #[test]
    fn html_content_no_tags_returns_unchanged() {
        let input = "plain text without tags";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, input);
    }

    // -----------------------------------------------------------------------
    // ListSplitTransform
    // -----------------------------------------------------------------------

    #[test]
    fn list_split_no_lists_unchanged() {
        let input = "line1\n\nline2";
        let out = apply_list_split_transform(input);
        assert_eq!(out, input);
    }

    #[test]
    fn list_split_inserts_separator() {
        let input = "- item1\n\n- item2";
        let out = apply_list_split_transform(input);
        assert_eq!(out, "- item1\n\n<!-- -->\n- item2");
    }

    #[test]
    fn list_split_numbered_list() {
        let input = "1. first\n\n2. second";
        let out = apply_list_split_transform(input);
        assert_eq!(out, "1. first\n\n<!-- -->\n2. second");
    }

    #[test]
    fn list_split_no_separator_without_blank() {
        let input = "- item1\n- item2";
        let out = apply_list_split_transform(input);
        assert_eq!(out, input);
    }

    #[test]
    fn list_split_indented_sublist_no_separator() {
        // A deeper-indented list item after a blank should not get a separator.
        let input = "- item1\n\n  - subitem";
        let out = apply_list_split_transform(input);
        assert_eq!(out, input);
    }

    #[test]
    fn list_split_multiple_blanks() {
        let input = "- a\n\n\n- b";
        let out = apply_list_split_transform(input);
        assert_eq!(out, "- a\n\n\n<!-- -->\n- b");
    }

    #[test]
    fn list_split_non_list_between_lists() {
        let input = "- a\n\nparagraph\n\n- b";
        let out = apply_list_split_transform(input);
        // The paragraph breaks the list context, so no separator before `- b`.
        assert_eq!(out, input);
    }

    #[test]
    fn list_split_plus_and_star_markers() {
        let input = "+ a\n\n* b";
        let out = apply_list_split_transform(input);
        assert_eq!(out, "+ a\n\n<!-- -->\n* b");
    }

    // -----------------------------------------------------------------------
    // apply_transforms (master)
    // -----------------------------------------------------------------------

    #[test]
    fn transforms_skips_non_presentation() {
        let input = ";; note\n<b>bold</b>";
        let opts = TransformOptions {
            speaker_note_mode: Some(SpeakerNoteMode::Remove),
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: Some(HtmlContentMode::Remove),
            format: ExportFormat::Kanban,
        };
        let out = apply_transforms(input, &opts);
        assert_eq!(out, input);
    }

    #[test]
    fn transforms_applies_all_for_presentation() {
        let input = ";; speaker note\ntext <!-- comment --> <b>bold</b>\n- a\n\n- b";
        let opts = TransformOptions {
            speaker_note_mode: Some(SpeakerNoteMode::Remove),
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: Some(HtmlContentMode::Remove),
            format: ExportFormat::Presentation,
        };
        let out = apply_transforms(input, &opts);
        assert_eq!(out, "text  bold\n- a\n\n<!-- -->\n- b");
    }

    #[test]
    fn transforms_speaker_comment_then_keep_html() {
        let input = ";; my note\ntext <b>bold</b>";
        let opts = TransformOptions {
            speaker_note_mode: Some(SpeakerNoteMode::Comment),
            html_comment_mode: None,
            html_content_mode: Some(HtmlContentMode::Keep),
            format: ExportFormat::Presentation,
        };
        let out = apply_transforms(input, &opts);
        assert_eq!(out, "<!-- my note -->\ntext <b>bold</b>");
    }

    #[test]
    fn transforms_none_modes_keep_content() {
        let input = ";; note\n<!-- comment -->\n<b>bold</b>";
        let opts = TransformOptions {
            speaker_note_mode: None,
            html_comment_mode: None,
            html_content_mode: None,
            format: ExportFormat::Presentation,
        };
        let out = apply_transforms(input, &opts);
        // Only list-split runs (but there are no lists), so content is unchanged.
        assert_eq!(out, input);
    }

    // -----------------------------------------------------------------------
    // Serde round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn serde_export_format_camel_case() {
        let json = serde_json::to_string(&ExportFormat::Presentation).unwrap();
        assert_eq!(json, "\"presentation\"");
        let parsed: ExportFormat = serde_json::from_str("\"presentation\"").unwrap();
        assert_eq!(parsed, ExportFormat::Presentation);
    }

    #[test]
    fn serde_speaker_note_mode_camel_case() {
        let json = serde_json::to_string(&SpeakerNoteMode::Comment).unwrap();
        assert_eq!(json, "\"comment\"");
    }

    #[test]
    fn serde_transform_options_round_trip() {
        let opts = TransformOptions {
            speaker_note_mode: Some(SpeakerNoteMode::Remove),
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: None,
            format: ExportFormat::Document,
        };
        let json = serde_json::to_string(&opts).unwrap();
        let parsed: TransformOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.format, ExportFormat::Document);
        assert_eq!(parsed.speaker_note_mode, Some(SpeakerNoteMode::Remove));
        assert_eq!(parsed.html_content_mode, None);
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn empty_string_all_transforms() {
        let opts = TransformOptions {
            speaker_note_mode: Some(SpeakerNoteMode::Remove),
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: Some(HtmlContentMode::Remove),
            format: ExportFormat::Presentation,
        };
        let out = apply_transforms("", &opts);
        assert_eq!(out, "");
    }

    #[test]
    fn speaker_note_at_end_of_file() {
        let input = "content\n;; trailing note";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Remove);
        assert_eq!(out, "content");
    }

    #[test]
    fn speaker_note_at_start_of_file() {
        let input = ";; leading note\ncontent";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Remove);
        assert_eq!(out, "content");
    }

    #[test]
    fn html_content_nested_tags() {
        let input = "<div><span>text</span></div>";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "text");
    }

    #[test]
    fn html_content_self_closing_tag() {
        let input = "before <br/> after";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "before  after");
    }

    #[test]
    fn list_split_trailing_blank_lines() {
        let input = "- item\n\n";
        let out = apply_list_split_transform(input);
        assert_eq!(out, input);
    }

    #[test]
    fn html_comment_and_content_combined() {
        // HTML comments should be removed first, then HTML tags.
        let input = "<!-- comment --><b>bold</b>";
        let opts = TransformOptions {
            speaker_note_mode: None,
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: Some(HtmlContentMode::Remove),
            format: ExportFormat::Presentation,
        };
        let out = apply_transforms(input, &opts);
        assert_eq!(out, "bold");
    }

    #[test]
    fn list_split_paren_numbered() {
        let input = "1) first\n\n2) second";
        let out = apply_list_split_transform(input);
        assert_eq!(out, "1) first\n\n<!-- -->\n2) second");
    }

    // -----------------------------------------------------------------------
    // Transform chaining: speaker notes -> HTML comments
    // -----------------------------------------------------------------------

    #[test]
    fn speaker_note_comment_then_html_comment_remove_strips_generated_comments() {
        // When speaker notes are converted to HTML comments (Comment mode),
        // and then HTML comment removal runs, the generated speaker-note
        // comments should be removed (they lack SPEAKER-NOTE: prefix).
        let input = "text\n;; my speaker note\nmore text";
        let opts = TransformOptions {
            speaker_note_mode: Some(SpeakerNoteMode::Comment),
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: None,
            format: ExportFormat::Presentation,
        };
        let out = apply_transforms(input, &opts);
        // The speaker note was wrapped as <!-- my speaker note -->
        // then the HTML comment removal should strip it
        assert!(!out.contains("speaker note"));
        assert!(out.contains("text"));
        assert!(out.contains("more text"));
    }

    #[test]
    fn speaker_note_comment_preserves_speaker_note_prefix_comments() {
        // If content already has a SPEAKER-NOTE: comment, html_comment_mode Remove
        // should preserve it.
        let input = "text\n<!-- SPEAKER-NOTE: important -->\nmore";
        let opts = TransformOptions {
            speaker_note_mode: None,
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: None,
            format: ExportFormat::Presentation,
        };
        let out = apply_transforms(input, &opts);
        assert!(out.contains("<!-- SPEAKER-NOTE: important -->"));
    }

    // -----------------------------------------------------------------------
    // Speaker note edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn speaker_note_multiple_separate_blocks() {
        let input = ";; block1\ntext\n;; block2a\n;; block2b\nend";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Comment);
        assert_eq!(out, "<!-- block1 -->\ntext\n<!-- block2a\nblock2b -->\nend");
    }

    #[test]
    fn speaker_note_remove_only_note_lines() {
        let input = ";; note1\n;; note2\n;; note3";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Remove);
        assert_eq!(out, "");
    }

    #[test]
    fn speaker_note_with_special_chars() {
        let input = ";; note with <html> & \"quotes\"";
        let out = apply_speaker_note_transform(input, SpeakerNoteMode::Comment);
        assert_eq!(out, "<!-- note with <html> & \"quotes\" -->");
    }

    // -----------------------------------------------------------------------
    // HTML content transform edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn html_content_preserves_http_url_ref() {
        let input = "see <http://example.com> for info";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "see <http://example.com> for info");
    }

    #[test]
    fn html_content_closing_tags_removed() {
        let input = "</div></span></p>";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "");
    }

    #[test]
    fn html_content_mixed_tags_and_comments() {
        let input = "<div>text</div> <!-- keep --> <span>more</span>";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "text <!-- keep --> more");
    }

    #[test]
    fn html_content_multiple_code_blocks_restored_correctly() {
        let input = "`<b>one</b>` text `<i>two</i>` <b>remove</b>";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert_eq!(out, "`<b>one</b>` text `<i>two</i>` remove");
    }

    #[test]
    fn html_content_fenced_code_with_multiple_tags() {
        let input = "```\n<div><span>inside</span></div>\n```\n<b>outside</b>";
        let out = apply_html_content_transform(input, HtmlContentMode::Remove);
        assert!(out.contains("<div><span>inside</span></div>"));
        assert!(!out.contains("<b>outside</b>"));
        assert!(out.contains("outside"));
    }

    // -----------------------------------------------------------------------
    // HTML comment edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn html_comment_nested_speaker_note_prefix() {
        // SPEAKER-NOTE: with extra leading whitespace should still be preserved
        let input = "<!--   SPEAKER-NOTE: keep me -->";
        let out = apply_html_comment_transform(input, HtmlCommentMode::Remove);
        assert_eq!(out, input);
    }

    #[test]
    fn html_comment_empty_comment() {
        let input = "before<!---->after";
        let out = apply_html_comment_transform(input, HtmlCommentMode::Remove);
        assert_eq!(out, "beforeafter");
    }

    #[test]
    fn html_comment_adjacent_comments() {
        let input = "<!-- a --><!-- b -->text";
        let out = apply_html_comment_transform(input, HtmlCommentMode::Remove);
        assert_eq!(out, "text");
    }

    // -----------------------------------------------------------------------
    // List split edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn list_split_empty_input() {
        let out = apply_list_split_transform("");
        assert_eq!(out, "");
    }

    #[test]
    fn list_split_single_item() {
        let input = "- only item";
        let out = apply_list_split_transform(input);
        assert_eq!(out, input);
    }

    #[test]
    fn list_split_indented_same_level_gets_separator() {
        let input = "  - item1\n\n  - item2";
        let out = apply_list_split_transform(input);
        assert_eq!(out, "  - item1\n\n<!-- -->\n  - item2");
    }

    #[test]
    fn list_split_different_marker_types_mixed() {
        let input = "- dash\n\n* star\n\n+ plus";
        let out = apply_list_split_transform(input);
        // All are list items at the same level, so separators should be inserted
        assert!(out.contains("<!-- -->"));
    }

    #[test]
    fn list_split_heading_between_lists_breaks_context() {
        let input = "- a\n\n## Heading\n\n- b";
        let out = apply_list_split_transform(input);
        // The heading breaks the list context, so no separator
        assert!(!out.contains("<!-- -->"));
    }

    // -----------------------------------------------------------------------
    // apply_transforms format gating
    // -----------------------------------------------------------------------

    #[test]
    fn transforms_skips_document_format() {
        let input = ";; note\n<b>bold</b>";
        let opts = TransformOptions {
            speaker_note_mode: Some(SpeakerNoteMode::Remove),
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: Some(HtmlContentMode::Remove),
            format: ExportFormat::Document,
        };
        let out = apply_transforms(input, &opts);
        assert_eq!(out, input);
    }

    #[test]
    fn transforms_skips_keep_format() {
        let input = ";; note\n<b>bold</b>";
        let opts = TransformOptions {
            speaker_note_mode: Some(SpeakerNoteMode::Remove),
            html_comment_mode: Some(HtmlCommentMode::Remove),
            html_content_mode: Some(HtmlContentMode::Remove),
            format: ExportFormat::Keep,
        };
        let out = apply_transforms(input, &opts);
        assert_eq!(out, input);
    }

    // -----------------------------------------------------------------------
    // Serde edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn serde_html_comment_mode() {
        let json = serde_json::to_string(&HtmlCommentMode::Remove).unwrap();
        assert_eq!(json, "\"remove\"");
        let parsed: HtmlCommentMode = serde_json::from_str("\"keep\"").unwrap();
        assert_eq!(parsed, HtmlCommentMode::Keep);
    }

    #[test]
    fn serde_html_content_mode() {
        let json = serde_json::to_string(&HtmlContentMode::Keep).unwrap();
        assert_eq!(json, "\"keep\"");
        let parsed: HtmlContentMode = serde_json::from_str("\"remove\"").unwrap();
        assert_eq!(parsed, HtmlContentMode::Remove);
    }

    #[test]
    fn serde_export_format_all_variants() {
        assert_eq!(
            serde_json::to_string(&ExportFormat::Keep).unwrap(),
            "\"keep\""
        );
        assert_eq!(
            serde_json::to_string(&ExportFormat::Kanban).unwrap(),
            "\"kanban\""
        );
        assert_eq!(
            serde_json::to_string(&ExportFormat::Document).unwrap(),
            "\"document\""
        );
    }
}
