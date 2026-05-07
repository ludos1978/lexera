//! YAML front-matter parsing for board settings + generation metadata.
//!
//! Split out of `parser.rs` so the YAML-specific logic (read/write
//! board settings keys, read/write generation metadata, body-hash
//! over the body-after-front-matter) lives next to the unit tests
//! that exercise it. External callers reach this through
//! `crate::parser::*` via the re-exports in `parser.rs`.

use crate::types::{BoardSettings, GenerationMeta, BOARD_SETTING_KEYS, GENERATION_META_KEYS};

/// Parse board settings from a YAML header block.
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

    #[test]
    fn test_parse_board_settings() {
        let settings = parse_board_settings(
            "---\nkanban-plugin: board\ncolumnWidth: 450px\nlayoutRows: 3\n---",
        );
        assert_eq!(settings.column_width.as_deref(), Some("450px"));
        assert_eq!(settings.layout_rows, Some(3));
    }

    #[test]
    fn test_update_yaml_no_existing_header() {
        let settings = BoardSettings {
            column_width: Some("300px".to_string()),
            ..Default::default()
        };
        let yaml = update_yaml_with_board_settings(None, settings);
        assert!(yaml.contains("kanban-plugin: board"));
        assert!(yaml.contains("columnWidth: 300px"));
    }

    #[test]
    fn test_update_yaml_existing_header() {
        let header = "---\nkanban-plugin: board\ncolumnWidth: 450px\n---";
        let settings = BoardSettings {
            column_width: Some("300px".to_string()),
            ..Default::default()
        };
        let updated = update_yaml_with_board_settings(Some(header), settings);
        assert!(updated.contains("columnWidth: 300px"));
        assert!(!updated.contains("columnWidth: 450px"));
    }
}
