//! Inline `{key:value, ...}` parameter parsing for headings + task lines.
//!
//! Split out of `parser.rs` so the param-block extraction (used in
//! row / stack / column / card lines) lives next to the unit tests
//! that exercise its parser invariants. External callers reach this
//! through `crate::parser::*` via the re-exports in `parser.rs`.

use std::collections::HashMap;

use crate::merge::card_identity;
use crate::types::KanbanCard;

use super::generate_id;

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
pub fn parse_task_line(line: &str) -> Option<KanbanCard> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
