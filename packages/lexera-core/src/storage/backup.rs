/// Backup manager for board files.
///
/// Creates timestamped backups in a `.lexera-backups/` directory alongside
/// each board file and rotates old backups beyond a configurable keep count.
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;

/// Default number of backups to retain per board file.
pub const DEFAULT_KEEP_COUNT: usize = 5;

/// Name of the backup directory created next to each board file.
const BACKUP_DIR_NAME: &str = ".lexera-backups";

/// A single backup entry returned by [`BackupManager::list_backups`].
#[derive(Debug, Clone)]
pub struct BackupEntry {
    /// Full path to the backup file.
    pub path: PathBuf,
    /// Filename of the backup (e.g. `board.md.2026-03-02T10-30-00`).
    pub filename: String,
    /// Timestamp string extracted from the filename suffix.
    pub timestamp: String,
    /// Size of the backup file in bytes.
    pub size: u64,
}

/// Manages creation, rotation, listing, and restoration of board backups.
pub struct BackupManager {
    /// Maximum number of backups to keep per board file.
    keep: usize,
}

impl BackupManager {
    /// Create a new `BackupManager` with the default keep count.
    pub fn new() -> Self {
        Self {
            keep: DEFAULT_KEEP_COUNT,
        }
    }

    /// Create a new `BackupManager` with a custom keep count.
    pub fn with_keep(keep: usize) -> Self {
        Self { keep }
    }

    /// Return the backup directory for a given board file.
    ///
    /// The directory is `.lexera-backups/` as a sibling to the board file.
    fn backup_dir(board_path: &Path) -> PathBuf {
        let parent = board_path.parent().unwrap_or(Path::new("."));
        parent.join(BACKUP_DIR_NAME)
    }

    /// Generate a timestamp string suitable for use as a filename suffix.
    ///
    /// Format: `YYYY-MM-DDTHH-MM-SS` (colons replaced with hyphens for
    /// cross-platform filename safety).
    fn timestamp_now() -> String {
        Local::now().format("%Y-%m-%dT%H-%M-%S").to_string()
    }

    /// Build the backup filename for a board file with the given timestamp.
    ///
    /// Example: `board.md` + `2026-03-02T10-30-00` -> `board.md.2026-03-02T10-30-00`
    fn backup_filename(board_path: &Path, timestamp: &str) -> String {
        let file_name = board_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "board.md".to_string());
        format!("{}.{}", file_name, timestamp)
    }

    /// Extract the timestamp suffix from a backup filename, given the original
    /// board filename as a prefix.
    fn extract_timestamp(backup_filename: &str, board_filename: &str) -> Option<String> {
        let prefix = format!("{}.", board_filename);
        backup_filename
            .strip_prefix(&prefix)
            .map(|ts| ts.to_string())
    }

    /// Create a backup of the board file at `board_path`.
    ///
    /// The backup is stored in `.lexera-backups/` alongside the original file,
    /// with a timestamp suffix appended to the filename.
    ///
    /// Returns the path to the newly created backup file.
    pub fn create_backup(&self, board_path: &Path) -> Result<PathBuf, std::io::Error> {
        if !board_path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Board file not found: {}", board_path.display()),
            ));
        }

        let backup_dir = Self::backup_dir(board_path);
        if !backup_dir.exists() {
            fs::create_dir_all(&backup_dir)?;
        }

        let timestamp = Self::timestamp_now();
        let backup_name = Self::backup_filename(board_path, &timestamp);
        let backup_path = backup_dir.join(&backup_name);

        fs::copy(board_path, &backup_path)?;

        Ok(backup_path)
    }

    /// Rotate backups for the given board file, keeping only the `keep` most
    /// recent ones.  Older backups are deleted.
    pub fn rotate_backups(&self, board_path: &Path) -> Result<(), std::io::Error> {
        let mut entries = self.list_backups(board_path)?;

        if entries.len() <= self.keep {
            return Ok(());
        }

        // `list_backups` returns entries sorted newest-first.
        // Everything beyond `keep` should be deleted.
        let to_delete = entries.split_off(self.keep);
        for entry in to_delete {
            if let Err(e) = fs::remove_file(&entry.path) {
                log::warn!(
                    "[lexera.backup] Failed to remove old backup {:?}: {}",
                    entry.path,
                    e
                );
            }
        }

        Ok(())
    }

    /// List all backups for the given board file, sorted newest first.
    pub fn list_backups(&self, board_path: &Path) -> Result<Vec<BackupEntry>, std::io::Error> {
        let backup_dir = Self::backup_dir(board_path);
        if !backup_dir.exists() {
            return Ok(Vec::new());
        }

        let board_filename = board_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let prefix = format!("{}.", board_filename);

        let mut entries: Vec<BackupEntry> = Vec::new();

        for dir_entry in fs::read_dir(&backup_dir)? {
            let dir_entry = dir_entry?;
            let name = dir_entry.file_name().to_string_lossy().to_string();

            if !name.starts_with(&prefix) {
                continue;
            }

            let timestamp = match Self::extract_timestamp(&name, &board_filename) {
                Some(ts) => ts,
                None => continue,
            };

            let metadata = dir_entry.metadata()?;
            if !metadata.is_file() {
                continue;
            }

            entries.push(BackupEntry {
                path: dir_entry.path(),
                filename: name,
                timestamp,
                size: metadata.len(),
            });
        }

        // Sort by timestamp descending (newest first).
        // The timestamp format is lexicographically sortable.
        entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        Ok(entries)
    }

    /// Restore a backup by copying it back to the original board location.
    ///
    /// `backup_path` is the full path to the backup file.
    /// `board_path` is the target board file to overwrite.
    pub fn restore_backup(
        &self,
        backup_path: &Path,
        board_path: &Path,
    ) -> Result<(), std::io::Error> {
        if !backup_path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Backup file not found: {}", backup_path.display()),
            ));
        }

        fs::copy(backup_path, board_path)?;
        Ok(())
    }
}

impl Default for BackupManager {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    /// Helper: write a minimal board file and return its path.
    fn write_board(dir: &Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn test_create_backup_creates_file() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "# My Board\n## Todo\n- [ ] Task\n");

        let mgr = BackupManager::new();
        let backup_path = mgr.create_backup(&board).unwrap();

        assert!(backup_path.exists(), "Backup file should exist on disk");
        assert!(
            backup_path
                .to_string_lossy()
                .contains(".lexera-backups"),
            "Backup should be inside .lexera-backups/"
        );

        // Content should match the original
        let original = fs::read_to_string(&board).unwrap();
        let backed_up = fs::read_to_string(&backup_path).unwrap();
        assert_eq!(original, backed_up);
    }

    #[test]
    fn test_create_backup_nonexistent_file_returns_error() {
        let dir = tempdir().unwrap();
        let fake_path = dir.path().join("nonexistent.md");

        let mgr = BackupManager::new();
        let result = mgr.create_backup(&fake_path);
        assert!(result.is_err(), "Should return error for missing file");
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn test_list_backups_returns_sorted_entries() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "content");

        let backup_dir = dir.path().join(BACKUP_DIR_NAME);
        fs::create_dir_all(&backup_dir).unwrap();

        // Create backups with known timestamps (out of order on disk)
        let timestamps = [
            "2026-01-01T10-00-00",
            "2026-03-01T12-00-00",
            "2026-02-15T08-30-00",
        ];
        for ts in &timestamps {
            let name = format!("board.md.{}", ts);
            fs::write(backup_dir.join(&name), "backup content").unwrap();
        }

        let mgr = BackupManager::new();
        let entries = mgr.list_backups(&board).unwrap();

        assert_eq!(entries.len(), 3);
        // Should be sorted newest first
        assert_eq!(entries[0].timestamp, "2026-03-01T12-00-00");
        assert_eq!(entries[1].timestamp, "2026-02-15T08-30-00");
        assert_eq!(entries[2].timestamp, "2026-01-01T10-00-00");
    }

    #[test]
    fn test_list_backups_includes_size() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "test.md", "hello");

        let mgr = BackupManager::new();
        mgr.create_backup(&board).unwrap();

        let entries = mgr.list_backups(&board).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].size, 5); // "hello" = 5 bytes
    }

    #[test]
    fn test_list_backups_empty_when_no_dir() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "content");

        let mgr = BackupManager::new();
        let entries = mgr.list_backups(&board).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_list_backups_ignores_unrelated_files() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "content");

        let backup_dir = dir.path().join(BACKUP_DIR_NAME);
        fs::create_dir_all(&backup_dir).unwrap();

        // A backup for a different board file
        fs::write(
            backup_dir.join("other.md.2026-01-01T10-00-00"),
            "other",
        )
        .unwrap();
        // A matching backup
        fs::write(
            backup_dir.join("board.md.2026-01-01T10-00-00"),
            "mine",
        )
        .unwrap();

        let mgr = BackupManager::new();
        let entries = mgr.list_backups(&board).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].timestamp, "2026-01-01T10-00-00");
    }

    #[test]
    fn test_rotate_keeps_only_n() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "content");

        let backup_dir = dir.path().join(BACKUP_DIR_NAME);
        fs::create_dir_all(&backup_dir).unwrap();

        // Create 7 backups
        let timestamps = [
            "2026-01-01T01-00-00",
            "2026-01-02T01-00-00",
            "2026-01-03T01-00-00",
            "2026-01-04T01-00-00",
            "2026-01-05T01-00-00",
            "2026-01-06T01-00-00",
            "2026-01-07T01-00-00",
        ];
        for ts in &timestamps {
            let name = format!("board.md.{}", ts);
            fs::write(backup_dir.join(&name), "backup").unwrap();
        }

        let mgr = BackupManager::with_keep(3);
        mgr.rotate_backups(&board).unwrap();

        let remaining = mgr.list_backups(&board).unwrap();
        assert_eq!(remaining.len(), 3, "Should keep exactly 3 backups");
        // The 3 newest should remain
        assert_eq!(remaining[0].timestamp, "2026-01-07T01-00-00");
        assert_eq!(remaining[1].timestamp, "2026-01-06T01-00-00");
        assert_eq!(remaining[2].timestamp, "2026-01-05T01-00-00");
    }

    #[test]
    fn test_rotate_with_fewer_than_keep_does_nothing() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "content");

        let backup_dir = dir.path().join(BACKUP_DIR_NAME);
        fs::create_dir_all(&backup_dir).unwrap();

        // Only 2 backups, keep is 5
        fs::write(
            backup_dir.join("board.md.2026-01-01T01-00-00"),
            "backup",
        )
        .unwrap();
        fs::write(
            backup_dir.join("board.md.2026-01-02T01-00-00"),
            "backup",
        )
        .unwrap();

        let mgr = BackupManager::new(); // keep = 5
        mgr.rotate_backups(&board).unwrap();

        let remaining = mgr.list_backups(&board).unwrap();
        assert_eq!(remaining.len(), 2, "Should not delete anything when under the limit");
    }

    #[test]
    fn test_rotate_with_no_backups_is_noop() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "content");

        let mgr = BackupManager::new();
        // Should not error even with no backup directory
        mgr.rotate_backups(&board).unwrap();
    }

    #[test]
    fn test_restore_backup() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "original content");

        let mgr = BackupManager::new();
        let backup_path = mgr.create_backup(&board).unwrap();

        // Overwrite the original
        fs::write(&board, "modified content").unwrap();
        assert_eq!(fs::read_to_string(&board).unwrap(), "modified content");

        // Restore from backup
        mgr.restore_backup(&backup_path, &board).unwrap();
        assert_eq!(fs::read_to_string(&board).unwrap(), "original content");
    }

    #[test]
    fn test_restore_nonexistent_backup_returns_error() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "content");
        let fake_backup = dir.path().join(".lexera-backups/nonexistent.md.2026-01-01T00-00-00");

        let mgr = BackupManager::new();
        let result = mgr.restore_backup(&fake_backup, &board);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn test_create_and_rotate_integration() {
        let dir = tempdir().unwrap();
        let board = write_board(dir.path(), "board.md", "v1");

        let backup_dir = dir.path().join(BACKUP_DIR_NAME);
        fs::create_dir_all(&backup_dir).unwrap();

        // Manually create 4 backups with distinct timestamps (sub-second
        // execution would otherwise produce identical names)
        let timestamps = [
            "2026-01-01T01-00-00",
            "2026-01-02T01-00-00",
            "2026-01-03T01-00-00",
            "2026-01-04T01-00-00",
        ];
        for (i, ts) in timestamps.iter().enumerate() {
            let content = format!("v{}", i + 1);
            let name = format!("board.md.{}", ts);
            fs::write(backup_dir.join(&name), content).unwrap();
        }

        let mgr = BackupManager::with_keep(2);

        // Before rotation, all 4 should exist
        let before = mgr.list_backups(&board).unwrap();
        assert_eq!(before.len(), 4);

        // Rotate
        mgr.rotate_backups(&board).unwrap();

        // After rotation, only 2 should remain (the newest two)
        let after = mgr.list_backups(&board).unwrap();
        assert_eq!(after.len(), 2);
        assert_eq!(after[0].timestamp, "2026-01-04T01-00-00");
        assert_eq!(after[1].timestamp, "2026-01-03T01-00-00");
    }

    #[test]
    fn test_backup_dir_is_sibling_to_board() {
        let board_path = Path::new("/some/dir/my-board.md");
        let backup_dir = BackupManager::backup_dir(board_path);
        assert_eq!(backup_dir, PathBuf::from("/some/dir/.lexera-backups"));
    }

    #[test]
    fn test_backup_filename_format() {
        let board_path = Path::new("/tmp/board.md");
        let name = BackupManager::backup_filename(board_path, "2026-03-02T10-30-00");
        assert_eq!(name, "board.md.2026-03-02T10-30-00");
    }

    #[test]
    fn test_extract_timestamp() {
        let ts = BackupManager::extract_timestamp("board.md.2026-03-02T10-30-00", "board.md");
        assert_eq!(ts, Some("2026-03-02T10-30-00".to_string()));

        // Non-matching prefix
        let ts = BackupManager::extract_timestamp("other.md.2026-03-02T10-30-00", "board.md");
        assert_eq!(ts, None);
    }

    #[test]
    fn test_default_keep_count() {
        let mgr = BackupManager::new();
        assert_eq!(mgr.keep, DEFAULT_KEEP_COUNT);
        assert_eq!(DEFAULT_KEEP_COUNT, 5);
    }
}
