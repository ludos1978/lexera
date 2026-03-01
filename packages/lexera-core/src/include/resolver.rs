/// Include path resolution and bidirectional mapping.
///
/// IncludeMap tracks:
/// - board_id → Vec<(col_index, absolute_path)>
/// - absolute_path → Vec<board_id>
///
/// Path resolution: raw include paths (may be URL-encoded, relative) are
/// resolved against the main board file's parent directory.
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::syntax::{decode_include_path, extract_include_path, is_include};

/// Bidirectional mapping between boards and their include files.
#[derive(Debug, Default)]
pub struct IncludeMap {
    /// board_id -> list of (column_index, resolved_absolute_path)
    board_to_includes: HashMap<String, Vec<(usize, PathBuf)>>,
    /// resolved_absolute_path -> list of board_ids that reference it
    include_to_boards: HashMap<PathBuf, Vec<String>>,
}

impl IncludeMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register includes for a board. Scans column titles for include directives.
    /// `board_dir` is the parent directory of the main board file.
    pub fn register_board(
        &mut self,
        board_id: &str,
        board_dir: &Path,
        column_titles: &[(usize, &str)],
    ) {
        // Remove old entries for this board
        self.remove_board(board_id);

        let mut includes = Vec::new();
        for &(col_idx, title) in column_titles {
            if let Some(raw_path) = extract_include_path(title) {
                let resolved = resolve_include_path(&raw_path, board_dir);
                includes.push((col_idx, resolved.clone()));

                self.include_to_boards
                    .entry(resolved)
                    .or_default()
                    .push(board_id.to_string());
            }
        }

        if !includes.is_empty() {
            self.board_to_includes
                .insert(board_id.to_string(), includes);
        }
    }

    /// Remove all mappings for a board.
    pub fn remove_board(&mut self, board_id: &str) {
        if let Some(includes) = self.board_to_includes.remove(board_id) {
            for (_, path) in &includes {
                if let Some(boards) = self.include_to_boards.get_mut(path) {
                    boards.retain(|id| id != board_id);
                    if boards.is_empty() {
                        self.include_to_boards.remove(path);
                    }
                }
            }
        }
    }

    /// Get all include files for a board.
    pub fn get_includes_for_board(&self, board_id: &str) -> Vec<(usize, PathBuf)> {
        self.board_to_includes
            .get(board_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Get all board IDs that reference a given include file path.
    pub fn get_boards_for_include(&self, include_path: &Path) -> Vec<String> {
        self.include_to_boards
            .get(include_path)
            .cloned()
            .unwrap_or_default()
    }

    /// Get all watched include file paths.
    pub fn all_include_paths(&self) -> Vec<PathBuf> {
        self.include_to_boards.keys().cloned().collect()
    }

    /// Check if a path is a tracked include file.
    pub fn is_include_file(&self, path: &Path) -> bool {
        self.include_to_boards.contains_key(path)
    }
}

/// Resolve a raw include path relative to the board's directory.
/// Handles URL-encoded paths (%20), `./` prefix, and relative paths.
pub fn resolve_include_path(raw_path: &str, board_dir: &Path) -> PathBuf {
    let decoded = decode_include_path(raw_path);

    // Strip leading ./ if present
    let cleaned = decoded.strip_prefix("./").unwrap_or(&decoded);

    let resolved = board_dir.join(cleaned);

    // Try to canonicalize, fall back to the joined path
    std::fs::canonicalize(&resolved).unwrap_or(resolved)
}

/// Scan column titles and detect which ones are includes.
/// Returns (column_index, raw_include_path) for each include column.
pub fn detect_includes(column_titles: &[&str]) -> Vec<(usize, String)> {
    column_titles
        .iter()
        .enumerate()
        .filter(|(_, title)| is_include(title))
        .filter_map(|(idx, title)| extract_include_path(title).map(|path| (idx, path)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_include_path_relative() {
        let board_dir = Path::new("/home/user/boards");
        let resolved = resolve_include_path("./root/file.md", board_dir);
        assert_eq!(resolved, PathBuf::from("/home/user/boards/root/file.md"));
    }

    #[test]
    fn test_resolve_include_path_no_dot_slash() {
        let board_dir = Path::new("/home/user/boards");
        let resolved = resolve_include_path("root/file.md", board_dir);
        assert_eq!(resolved, PathBuf::from("/home/user/boards/root/file.md"));
    }

    #[test]
    fn test_resolve_include_path_url_encoded() {
        let board_dir = Path::new("/home/user/boards");
        let resolved = resolve_include_path("folder%20with%20space/file.md", board_dir);
        assert_eq!(
            resolved,
            PathBuf::from("/home/user/boards/folder with space/file.md")
        );
    }

    #[test]
    fn test_resolve_include_path_literal_spaces() {
        let board_dir = Path::new("/home/user/boards");
        let resolved = resolve_include_path("./folder with space/file.md", board_dir);
        assert_eq!(
            resolved,
            PathBuf::from("/home/user/boards/folder with space/file.md")
        );
    }

    #[test]
    fn test_include_map_register_and_lookup() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![
            (0, "!!!include(./root/file1.md)!!!"),
            (1, "Normal Column"),
            (2, "!!!include(root/file2.md)!!! #stack"),
        ];

        map.register_board("board1", Path::new("/boards"), &titles);

        let includes = map.get_includes_for_board("board1");
        assert_eq!(includes.len(), 2);
        assert_eq!(includes[0].0, 0);
        assert_eq!(includes[1].0, 2);

        let boards = map.get_boards_for_include(&PathBuf::from("/boards/root/file1.md"));
        assert_eq!(boards, vec!["board1"]);
    }

    #[test]
    fn test_include_map_remove_board() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![(0, "!!!include(./file.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles);

        map.remove_board("board1");

        assert!(map.get_includes_for_board("board1").is_empty());
        assert!(map
            .get_boards_for_include(&PathBuf::from("/boards/file.md"))
            .is_empty());
    }

    #[test]
    fn test_include_map_multiple_boards_same_include() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![(0, "!!!include(./shared.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles);
        map.register_board("board2", Path::new("/boards"), &titles);

        let boards = map.get_boards_for_include(&PathBuf::from("/boards/shared.md"));
        assert_eq!(boards.len(), 2);
        assert!(boards.contains(&"board1".to_string()));
        assert!(boards.contains(&"board2".to_string()));
    }

    #[test]
    fn test_detect_includes() {
        let titles = vec![
            "!!!include(./root/file1.md)!!!",
            "Normal Column",
            "!!!include(root/file2.md)!!! #stack",
        ];
        let detected = detect_includes(&titles);
        assert_eq!(detected.len(), 2);
        assert_eq!(detected[0], (0, "./root/file1.md".to_string()));
        assert_eq!(detected[1], (2, "root/file2.md".to_string()));
    }

    // ======================================================================
    // Path normalization edge cases
    // ======================================================================

    #[test]
    fn test_resolve_include_path_nonexistent_falls_back_to_joined() {
        // When canonicalize fails (non-existent path), the joined path is returned
        let board_dir = Path::new("/nonexistent/board/dir");
        let resolved = resolve_include_path("some/file.md", board_dir);
        assert_eq!(
            resolved,
            PathBuf::from("/nonexistent/board/dir/some/file.md")
        );
    }

    #[test]
    fn test_resolve_include_path_with_parent_components() {
        // Paths with .. components — canonicalize won't work on non-existent paths,
        // so the raw joined path (including ..) is returned as fallback
        let board_dir = Path::new("/home/user/boards");
        let resolved = resolve_include_path("../shared/file.md", board_dir);
        assert_eq!(
            resolved,
            PathBuf::from("/home/user/boards/../shared/file.md")
        );
    }

    #[test]
    fn test_resolve_include_path_dot_slash_with_parent() {
        // The ./ prefix is stripped before joining
        let board_dir = Path::new("/home/user/boards");
        let resolved = resolve_include_path("./../up/file.md", board_dir);
        assert_eq!(
            resolved,
            PathBuf::from("/home/user/boards/../up/file.md")
        );
    }

    #[test]
    fn test_resolve_include_path_empty_after_decode() {
        // Empty path after decoding joins with board_dir to produce just the dir
        let board_dir = Path::new("/home/user/boards");
        let resolved = resolve_include_path("", board_dir);
        assert_eq!(resolved, PathBuf::from("/home/user/boards/"));
    }

    #[test]
    fn test_resolve_include_path_whitespace_only_after_decode() {
        // Whitespace-only path is kept as-is (no trimming in resolve_include_path)
        let board_dir = Path::new("/home/user/boards");
        let resolved = resolve_include_path("  ", board_dir);
        assert_eq!(resolved, PathBuf::from("/home/user/boards/  "));
    }

    #[test]
    fn test_resolve_include_path_url_encoded_special_chars() {
        // %23 = '#', which could be confused with tags
        let board_dir = Path::new("/boards");
        let resolved = resolve_include_path("file%23name.md", board_dir);
        assert_eq!(resolved, PathBuf::from("/boards/file#name.md"));
    }

    // ======================================================================
    // IncludeMap state transitions
    // ======================================================================

    #[test]
    fn test_re_register_board_with_different_includes() {
        let mut map = IncludeMap::new();
        let titles_v1: Vec<(usize, &str)> = vec![
            (0, "!!!include(./file_a.md)!!!"),
            (1, "!!!include(./file_b.md)!!!"),
        ];
        map.register_board("board1", Path::new("/boards"), &titles_v1);

        // Verify initial state
        assert_eq!(map.get_includes_for_board("board1").len(), 2);
        assert!(!map
            .get_boards_for_include(&PathBuf::from("/boards/file_a.md"))
            .is_empty());

        // Re-register with completely different includes
        let titles_v2: Vec<(usize, &str)> = vec![(0, "!!!include(./file_c.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles_v2);

        // Old includes should be gone
        assert_eq!(map.get_includes_for_board("board1").len(), 1);
        assert!(map
            .get_boards_for_include(&PathBuf::from("/boards/file_a.md"))
            .is_empty());
        assert!(map
            .get_boards_for_include(&PathBuf::from("/boards/file_b.md"))
            .is_empty());
        // New include should be present
        assert_eq!(
            map.get_boards_for_include(&PathBuf::from("/boards/file_c.md")),
            vec!["board1"]
        );
    }

    #[test]
    fn test_re_register_board_partial_overlap() {
        let mut map = IncludeMap::new();
        let titles_v1: Vec<(usize, &str)> = vec![
            (0, "!!!include(./shared.md)!!!"),
            (1, "!!!include(./old.md)!!!"),
        ];
        map.register_board("board1", Path::new("/boards"), &titles_v1);

        // Re-register keeping one include, changing the other
        let titles_v2: Vec<(usize, &str)> = vec![
            (0, "!!!include(./shared.md)!!!"),
            (1, "!!!include(./new.md)!!!"),
        ];
        map.register_board("board1", Path::new("/boards"), &titles_v2);

        assert_eq!(map.get_includes_for_board("board1").len(), 2);
        // shared.md should still map to board1
        assert_eq!(
            map.get_boards_for_include(&PathBuf::from("/boards/shared.md")),
            vec!["board1"]
        );
        // old.md should be gone
        assert!(map
            .get_boards_for_include(&PathBuf::from("/boards/old.md"))
            .is_empty());
        // new.md should be present
        assert_eq!(
            map.get_boards_for_include(&PathBuf::from("/boards/new.md")),
            vec!["board1"]
        );
    }

    #[test]
    fn test_re_register_board_with_no_includes() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![(0, "!!!include(./file.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles);
        assert_eq!(map.get_includes_for_board("board1").len(), 1);

        // Re-register with no include columns at all
        let titles_empty: Vec<(usize, &str)> = vec![(0, "Normal Column")];
        map.register_board("board1", Path::new("/boards"), &titles_empty);

        assert!(map.get_includes_for_board("board1").is_empty());
        assert!(map
            .get_boards_for_include(&PathBuf::from("/boards/file.md"))
            .is_empty());
        assert!(map.all_include_paths().is_empty());
    }

    // ======================================================================
    // Column index tracking
    // ======================================================================

    #[test]
    fn test_different_columns_pointing_to_same_file() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![
            (0, "!!!include(./shared.md)!!!"),
            (3, "!!!include(./shared.md)!!!"),
        ];
        map.register_board("board1", Path::new("/boards"), &titles);

        let includes = map.get_includes_for_board("board1");
        assert_eq!(includes.len(), 2);
        assert_eq!(includes[0].0, 0);
        assert_eq!(includes[1].0, 3);
        // Both should resolve to the same path
        assert_eq!(includes[0].1, includes[1].1);

        // The reverse mapping should list board1 twice (once per column)
        let boards = map.get_boards_for_include(&PathBuf::from("/boards/shared.md"));
        assert_eq!(boards.len(), 2);
        assert!(boards.iter().all(|b| b == "board1"));
    }

    #[test]
    fn test_non_sequential_column_indices() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![
            (5, "!!!include(./a.md)!!!"),
            (10, "!!!include(./b.md)!!!"),
            (100, "!!!include(./c.md)!!!"),
        ];
        map.register_board("board1", Path::new("/boards"), &titles);

        let includes = map.get_includes_for_board("board1");
        assert_eq!(includes.len(), 3);
        assert_eq!(includes[0].0, 5);
        assert_eq!(includes[1].0, 10);
        assert_eq!(includes[2].0, 100);
    }

    #[test]
    fn test_column_index_zero() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![(0, "!!!include(./only.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles);

        let includes = map.get_includes_for_board("board1");
        assert_eq!(includes.len(), 1);
        assert_eq!(includes[0].0, 0);
    }

    // ======================================================================
    // remove_board followed by re-register
    // ======================================================================

    #[test]
    fn test_remove_then_re_register_same_board() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![(0, "!!!include(./file.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles);

        map.remove_board("board1");
        assert!(map.get_includes_for_board("board1").is_empty());
        assert!(!map.is_include_file(&PathBuf::from("/boards/file.md")));

        // Re-register the same board with different includes
        let titles2: Vec<(usize, &str)> = vec![(0, "!!!include(./other.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles2);

        assert_eq!(map.get_includes_for_board("board1").len(), 1);
        assert_eq!(
            map.get_includes_for_board("board1")[0].1,
            PathBuf::from("/boards/other.md")
        );
        assert!(map.is_include_file(&PathBuf::from("/boards/other.md")));
        assert!(!map.is_include_file(&PathBuf::from("/boards/file.md")));
    }

    #[test]
    fn test_remove_board_preserves_other_boards() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![(0, "!!!include(./shared.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles);
        map.register_board("board2", Path::new("/boards"), &titles);

        map.remove_board("board1");

        // board2 should still be intact
        assert_eq!(map.get_includes_for_board("board2").len(), 1);
        assert_eq!(
            map.get_boards_for_include(&PathBuf::from("/boards/shared.md")),
            vec!["board2"]
        );
        assert!(map.is_include_file(&PathBuf::from("/boards/shared.md")));
    }

    #[test]
    fn test_remove_nonexistent_board_is_noop() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![(0, "!!!include(./file.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles);

        // Removing a board that doesn't exist should not affect anything
        map.remove_board("nonexistent");

        assert_eq!(map.get_includes_for_board("board1").len(), 1);
        assert!(map.is_include_file(&PathBuf::from("/boards/file.md")));
    }

    // ======================================================================
    // all_include_paths and is_include_file
    // ======================================================================

    #[test]
    fn test_all_include_paths_empty_map() {
        let map = IncludeMap::new();
        assert!(map.all_include_paths().is_empty());
    }

    #[test]
    fn test_all_include_paths_multiple_boards() {
        let mut map = IncludeMap::new();
        let titles1: Vec<(usize, &str)> = vec![(0, "!!!include(./a.md)!!!")];
        let titles2: Vec<(usize, &str)> = vec![(0, "!!!include(./b.md)!!!")];
        map.register_board("board1", Path::new("/boards"), &titles1);
        map.register_board("board2", Path::new("/boards"), &titles2);

        let paths = map.all_include_paths();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&PathBuf::from("/boards/a.md")));
        assert!(paths.contains(&PathBuf::from("/boards/b.md")));
    }

    #[test]
    fn test_is_include_file_with_nonexistent_path() {
        let map = IncludeMap::new();
        assert!(!map.is_include_file(Path::new("/not/tracked.md")));
    }

    // ======================================================================
    // detect_includes edge cases
    // ======================================================================

    #[test]
    fn test_detect_includes_empty_list() {
        let titles: Vec<&str> = vec![];
        let detected = detect_includes(&titles);
        assert!(detected.is_empty());
    }

    #[test]
    fn test_detect_includes_no_includes() {
        let titles = vec!["Normal", "Also Normal", "## Column"];
        let detected = detect_includes(&titles);
        assert!(detected.is_empty());
    }

    #[test]
    fn test_detect_includes_all_includes() {
        let titles = vec![
            "!!!include(a.md)!!!",
            "!!!include(b.md)!!!",
            "!!!include(c.md)!!!",
        ];
        let detected = detect_includes(&titles);
        assert_eq!(detected.len(), 3);
        assert_eq!(detected[0].0, 0);
        assert_eq!(detected[1].0, 1);
        assert_eq!(detected[2].0, 2);
    }

    // ======================================================================
    // register_board with mixed include/non-include columns
    // ======================================================================

    #[test]
    fn test_register_board_skips_non_include_columns() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![
            (0, "Normal Column"),
            (1, "!!!include(./inc.md)!!!"),
            (2, "Another Normal"),
            (3, "!!!include(./inc2.md)!!! #stack"),
            (4, "Yet Another"),
        ];
        map.register_board("board1", Path::new("/boards"), &titles);

        let includes = map.get_includes_for_board("board1");
        assert_eq!(includes.len(), 2);
        assert_eq!(includes[0].0, 1);
        assert_eq!(includes[1].0, 3);
    }

    #[test]
    fn test_register_board_with_only_non_include_columns() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![
            (0, "Todo"),
            (1, "In Progress"),
            (2, "Done"),
        ];
        map.register_board("board1", Path::new("/boards"), &titles);

        assert!(map.get_includes_for_board("board1").is_empty());
        assert!(map.all_include_paths().is_empty());
    }

    #[test]
    fn test_register_board_empty_columns() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![];
        map.register_board("board1", Path::new("/boards"), &titles);

        assert!(map.get_includes_for_board("board1").is_empty());
    }

    #[test]
    fn test_multiple_boards_different_dirs() {
        let mut map = IncludeMap::new();
        let titles: Vec<(usize, &str)> = vec![(0, "!!!include(./file.md)!!!")];

        map.register_board("board1", Path::new("/dir1"), &titles);
        map.register_board("board2", Path::new("/dir2"), &titles);

        // Each board resolves to a different absolute path
        let includes1 = map.get_includes_for_board("board1");
        let includes2 = map.get_includes_for_board("board2");
        assert_ne!(includes1[0].1, includes2[0].1);
        assert_eq!(includes1[0].1, PathBuf::from("/dir1/file.md"));
        assert_eq!(includes2[0].1, PathBuf::from("/dir2/file.md"));
    }
}
