use regex::Regex;
use std::sync::atomic::{AtomicU64, Ordering};
/// Card identity helpers.
///
/// Older markdown may contain `<!-- kid:XXXXXXXX -->` comments at the end of
/// the first line. Those markers are accepted as migration input, but the kid
/// is now kept as internal metadata instead of being serialized into content.
use std::sync::LazyLock;

static KID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!-- kid:([0-9a-f]{8}) -->").unwrap());

/// Extract kid from card content (looks in the first line).
pub fn extract_kid(content: &str) -> Option<String> {
    let first_line = content.lines().next().unwrap_or("");
    KID_RE.captures(first_line).map(|caps| caps[1].to_string())
}

/// Strip kid marker from content (removes it from the first line).
pub fn strip_kid(content: &str) -> String {
    let mut lines: Vec<&str> = content.split('\n').collect();
    if let Some(first) = lines.first_mut() {
        let stripped = KID_RE.replace(first, "");
        let trimmed = stripped.trim_end().to_string();
        let rest = if lines.len() > 1 {
            lines[1..].join("\n")
        } else {
            String::new()
        };
        return if trimmed.is_empty() {
            rest
        } else if rest.is_empty() {
            trimmed
        } else {
            format!("{}\n{}", trimmed, rest)
        };
    }
    content.to_string()
}

/// Resolve a card's kid from existing metadata or a legacy content marker.
/// Generates a new kid when neither source is available.
pub fn resolve_kid(content: &str, existing: Option<&str>) -> String {
    existing
        .map(ToOwned::to_owned)
        .or_else(|| extract_kid(content))
        .unwrap_or_else(generate_kid)
}

/// Inject kid marker into content (appends to the first line).
pub fn inject_kid(content: &str, kid: &str) -> String {
    // First strip any existing kid
    let cleaned = strip_kid(content);
    let mut lines: Vec<&str> = cleaned.split('\n').collect();
    if let Some(first) = lines.first_mut() {
        let new_first = format!("{} <!-- kid:{} -->", first, kid);
        let rest = if lines.len() > 1 {
            format!("\n{}", lines[1..].join("\n"))
        } else {
            String::new()
        };
        return format!("{}{}", new_first, rest);
    }
    format!("{} <!-- kid:{} -->", content, kid)
}

static KID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generate a new random kid (8 hex chars).
/// Uses an atomic counter for intra-process uniqueness combined with a
/// nanosecond timestamp, hashed via SHA-256 for uniform distribution.
pub fn generate_kid() -> String {
    use sha2::{Digest, Sha256};
    let seq = KID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut hasher = Sha256::new();
    hasher.update(seq.to_le_bytes());
    hasher.update(ts.to_le_bytes());
    let hash = hasher.finalize();
    format!(
        "{:02x}{:02x}{:02x}{:02x}",
        hash[0], hash[1], hash[2], hash[3]
    )
}

/// Ensure a card has an internal kid while stripping any legacy marker from
/// the content. Returns (clean_content, kid).
pub fn ensure_kid(content: &str) -> (String, String) {
    (strip_kid(content), resolve_kid(content, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_kid() {
        assert_eq!(
            extract_kid("Buy groceries <!-- kid:a1b2c3d4 -->"),
            Some("a1b2c3d4".to_string())
        );
        assert_eq!(
            extract_kid("Buy groceries <!-- kid:a1b2c3d4 -->\ndescription here"),
            Some("a1b2c3d4".to_string())
        );
        assert_eq!(extract_kid("Buy groceries"), None);
        assert_eq!(extract_kid(""), None);
    }

    #[test]
    fn test_strip_kid() {
        assert_eq!(
            strip_kid("Buy groceries <!-- kid:a1b2c3d4 -->"),
            "Buy groceries"
        );
        assert_eq!(
            strip_kid("Buy groceries <!-- kid:a1b2c3d4 -->\nmore text"),
            "Buy groceries\nmore text"
        );
        assert_eq!(strip_kid("No kid here"), "No kid here");
        assert_eq!(strip_kid("<!-- kid:a1b2c3d4 -->\nmore text"), "more text");
    }

    #[test]
    fn test_inject_kid() {
        assert_eq!(
            inject_kid("Buy groceries", "a1b2c3d4"),
            "Buy groceries <!-- kid:a1b2c3d4 -->"
        );
        assert_eq!(
            inject_kid("Buy groceries\ndescription", "a1b2c3d4"),
            "Buy groceries <!-- kid:a1b2c3d4 -->\ndescription"
        );
    }

    #[test]
    fn test_inject_kid_replaces_existing() {
        assert_eq!(
            inject_kid("Buy groceries <!-- kid:00000000 -->", "a1b2c3d4"),
            "Buy groceries <!-- kid:a1b2c3d4 -->"
        );
    }

    #[test]
    fn test_generate_kid_format() {
        let kid = generate_kid();
        assert_eq!(kid.len(), 8);
        assert!(kid.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_ensure_kid_existing() {
        let content = "Task <!-- kid:a1b2c3d4 -->";
        let (result, kid) = ensure_kid(content);
        assert_eq!(kid, "a1b2c3d4");
        assert_eq!(result, "Task");
    }

    #[test]
    fn test_ensure_kid_missing() {
        let content = "Task without kid";
        let (result, kid) = ensure_kid(content);
        assert_eq!(kid.len(), 8);
        assert_eq!(result, content);
    }

    #[test]
    fn test_resolve_kid_prefers_existing_metadata() {
        assert_eq!(
            resolve_kid("Task <!-- kid:a1b2c3d4 -->", Some("deadbeef")),
            "deadbeef"
        );
    }
}
