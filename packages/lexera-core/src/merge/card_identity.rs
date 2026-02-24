/// Card identity management using persistent kid markers.
///
/// Cards are identified by `<!-- kid:XXXXXXXX -->` comments embedded at the
/// end of the first line (task summary) in markdown. The kid is 8 hex chars
/// (32-bit), generated once per card and preserved across edits.
///
/// HTML comments are invisible in Obsidian rendering.

use std::sync::LazyLock;
use regex::Regex;

static KID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"<!-- kid:([0-9a-f]{8}) -->").unwrap()
});

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
            format!("\n{}", lines[1..].join("\n"))
        } else {
            String::new()
        };
        return format!("{}{}", trimmed, rest);
    }
    content.to_string()
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

/// Generate a new random kid (8 hex chars).
pub fn generate_kid() -> String {
    use std::time::SystemTime;
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();

    // Mix timestamp with a simple hash for uniqueness
    let hash = ts.wrapping_mul(2654435761); // Knuth multiplicative hash
    format!("{:08x}", hash)
}

/// Ensure a card has a kid. If it doesn't have one, generate and inject one.
/// Returns (content_with_kid, kid).
pub fn ensure_kid(content: &str) -> (String, String) {
    if let Some(kid) = extract_kid(content) {
        (content.to_string(), kid)
    } else {
        let kid = generate_kid();
        (inject_kid(content, &kid), kid)
    }
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
        assert_eq!(result, content);
    }

    #[test]
    fn test_ensure_kid_missing() {
        let content = "Task without kid";
        let (result, kid) = ensure_kid(content);
        assert_eq!(kid.len(), 8);
        assert!(result.contains(&format!("<!-- kid:{} -->", kid)));
    }
}
