/// Include syntax detection and extraction.
///
/// Handles the `!!!include(path)!!!` pattern used in column headers.
/// Supports URL-encoded paths (%20), literal spaces, and tags after the closing `!!!`.
use regex::Regex;
use std::sync::LazyLock;

static INCLUDE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"!!!include\(([^)]+)\)!!!").unwrap());

/// Check if a column title contains an include directive.
pub fn is_include(title: &str) -> bool {
    INCLUDE_RE.is_match(title)
}

/// Extract the raw path from an include directive.
/// Returns None if the title doesn't contain an include.
pub fn extract_include_path(title: &str) -> Option<String> {
    INCLUDE_RE.captures(title).map(|caps| caps[1].to_string())
}

/// Strip the include directive from a title, returning the remaining text (tags etc).
/// For example: `!!!include(path)!!! #stack` -> ` #stack`
pub fn strip_include(title: &str) -> String {
    INCLUDE_RE.replace(title, "").to_string()
}

/// Decode URL-encoded path components (%20 -> space, etc).
pub fn decode_include_path(raw: &str) -> String {
    percent_encoding::percent_decode_str(raw)
        .decode_utf8_lossy()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_include() {
        assert!(is_include("!!!include(./root/file.md)!!!"));
        assert!(is_include("!!!include(root/file.md)!!! #stack"));
        assert!(!is_include("## Normal column"));
        assert!(!is_include("!!!include(broken"));
    }

    #[test]
    fn test_extract_include_path() {
        assert_eq!(
            extract_include_path("!!!include(./root/root-include-1.md)!!!"),
            Some("./root/root-include-1.md".to_string())
        );
        assert_eq!(
            extract_include_path("!!!include(root/root-include-2.md)!!! #stack"),
            Some("root/root-include-2.md".to_string())
        );
        assert_eq!(
            extract_include_path("!!!include(./folder with space/file.md)!!!"),
            Some("./folder with space/file.md".to_string())
        );
        assert_eq!(
            extract_include_path("!!!include(folder%20with%20space%202/file.md)!!! #stack"),
            Some("folder%20with%20space%202/file.md".to_string())
        );
        assert_eq!(extract_include_path("Normal title"), None);
    }

    #[test]
    fn test_strip_include() {
        assert_eq!(strip_include("!!!include(path.md)!!! #stack"), " #stack");
        assert_eq!(strip_include("!!!include(path.md)!!!"), "");
    }

    #[test]
    fn test_decode_include_path() {
        assert_eq!(
            decode_include_path("folder%20with%20space%202/file.md"),
            "folder with space 2/file.md"
        );
        assert_eq!(decode_include_path("./root/file.md"), "./root/file.md");
        assert_eq!(
            decode_include_path("folder with space/file.md"),
            "folder with space/file.md"
        );
    }
}
