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
            self.board_to_includes.insert(board_id.to_string(), includes);
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
        .filter_map(|(idx, title)| {
            extract_include_path(title).map(|path| (idx, path))
        })
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
        assert!(map.get_boards_for_include(&PathBuf::from("/boards/file.md")).is_empty());
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
}
