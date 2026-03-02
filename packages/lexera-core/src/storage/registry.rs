/// Board registry for custom ordering, access tracking, and pinning.
///
/// Stored as a JSON file alongside boards. Provides:
/// - Custom display ordering
/// - Pin/unpin boards
/// - Access history (last accessed, access count)
/// - Custom labels for user-friendly board names
/// - Sync with storage to discover new boards
use std::fs;
use std::io::Write;
use std::path::Path;

use chrono::Local;
use serde::{Deserialize, Serialize};

/// A single board entry in the registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardRegistryEntry {
    pub board_id: String,
    pub display_order: i32,
    pub pinned: bool,
    pub last_accessed: Option<String>,
    pub access_count: u32,
    pub custom_label: Option<String>,
}

/// Registry holding all board entries with ordering and metadata.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BoardRegistry {
    pub entries: Vec<BoardRegistryEntry>,
}

impl BoardRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Load a registry from a JSON file. Returns an empty registry if the file
    /// does not exist.
    pub fn load(path: &Path) -> Result<Self, std::io::Error> {
        if !path.exists() {
            return Ok(Self::new());
        }
        let content = fs::read_to_string(path)?;
        serde_json::from_str(&content).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Failed to parse board registry: {}", e),
            )
        })
    }

    /// Save the registry to a JSON file using atomic write (tmp + rename).
    pub fn save(&self, path: &Path) -> Result<(), std::io::Error> {
        let json = serde_json::to_string_pretty(self).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Failed to serialize board registry: {}", e),
            )
        })?;

        let tmp_path = path.with_extension("registry.tmp");
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(json.as_bytes())?;
        file.sync_all()?;
        fs::rename(&tmp_path, path)?;

        // fsync directory for rename durability
        if let Some(dir) = path.parent() {
            if let Ok(d) = fs::File::open(dir) {
                let _ = d.sync_all();
            }
        }
        Ok(())
    }

    /// Add a board if not already registered. Default order is max(existing) + 1.
    pub fn register_board(&mut self, board_id: &str) {
        if self.entries.iter().any(|e| e.board_id == board_id) {
            return;
        }
        let max_order = self
            .entries
            .iter()
            .map(|e| e.display_order)
            .max()
            .unwrap_or(-1);
        self.entries.push(BoardRegistryEntry {
            board_id: board_id.to_string(),
            display_order: max_order + 1,
            pinned: false,
            last_accessed: None,
            access_count: 0,
            custom_label: None,
        });
    }

    /// Remove a board from the registry.
    pub fn unregister_board(&mut self, board_id: &str) {
        self.entries.retain(|e| e.board_id != board_id);
    }

    /// Update last_accessed timestamp and increment access_count.
    /// Auto-registers the board if it is not yet in the registry.
    pub fn record_access(&mut self, board_id: &str) {
        if !self.entries.iter().any(|e| e.board_id == board_id) {
            self.register_board(board_id);
        }
        if let Some(entry) = self.entries.iter_mut().find(|e| e.board_id == board_id) {
            entry.last_accessed = Some(Local::now().to_rfc3339());
            entry.access_count += 1;
        }
    }

    /// Set the pinned state for a board.
    pub fn set_pinned(&mut self, board_id: &str, pinned: bool) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.board_id == board_id) {
            entry.pinned = pinned;
        }
    }

    /// Set the display order for a board.
    pub fn set_order(&mut self, board_id: &str, order: i32) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.board_id == board_id) {
            entry.display_order = order;
        }
    }

    /// Set or clear the custom label for a board.
    pub fn set_label(&mut self, board_id: &str, label: Option<String>) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.board_id == board_id) {
            entry.custom_label = label;
        }
    }

    /// Set display_order based on position in the given slice.
    /// Boards not in the slice keep their current order.
    pub fn reorder(&mut self, board_ids: &[String]) {
        for (i, id) in board_ids.iter().enumerate() {
            if let Some(entry) = self.entries.iter_mut().find(|e| e.board_id == *id) {
                entry.display_order = i as i32;
            }
        }
    }

    /// Return entries sorted: pinned first, then by display_order (ascending),
    /// then by last_accessed (most recent first).
    pub fn sorted_boards(&self) -> Vec<&BoardRegistryEntry> {
        let mut sorted: Vec<&BoardRegistryEntry> = self.entries.iter().collect();
        sorted.sort_by(|a, b| {
            // Pinned first
            b.pinned
                .cmp(&a.pinned)
                .then_with(|| a.display_order.cmp(&b.display_order))
                .then_with(|| {
                    // Most recent first (reverse order)
                    let a_time = a.last_accessed.as_deref().unwrap_or("");
                    let b_time = b.last_accessed.as_deref().unwrap_or("");
                    b_time.cmp(a_time)
                })
        });
        sorted
    }

    /// Return the N most recently accessed boards (by last_accessed, most recent first).
    /// Boards that have never been accessed are excluded.
    pub fn recent_boards(&self, limit: usize) -> Vec<&BoardRegistryEntry> {
        let mut with_access: Vec<&BoardRegistryEntry> = self
            .entries
            .iter()
            .filter(|e| e.last_accessed.is_some())
            .collect();
        with_access.sort_by(|a, b| {
            let a_time = a.last_accessed.as_deref().unwrap_or("");
            let b_time = b.last_accessed.as_deref().unwrap_or("");
            b_time.cmp(a_time)
        });
        with_access.truncate(limit);
        with_access
    }

    /// Return the N most accessed boards (by access_count, highest first).
    pub fn most_used_boards(&self, limit: usize) -> Vec<&BoardRegistryEntry> {
        let mut sorted: Vec<&BoardRegistryEntry> = self.entries.iter().collect();
        sorted.sort_by(|a, b| b.access_count.cmp(&a.access_count));
        sorted.truncate(limit);
        sorted
    }

    /// Sync registry with known board IDs from storage.
    /// Adds missing boards but never removes existing entries (boards on external
    /// drives may be temporarily unavailable).
    pub fn sync_with_storage(&mut self, known_board_ids: &[String]) {
        for id in known_board_ids {
            if !self.entries.iter().any(|e| e.board_id == *id) {
                self.register_board(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn register_board_adds_entry() {
        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        assert_eq!(reg.entries.len(), 1);
        assert_eq!(reg.entries[0].board_id, "board-1");
        assert_eq!(reg.entries[0].display_order, 0);
        assert!(!reg.entries[0].pinned);
        assert_eq!(reg.entries[0].access_count, 0);
        assert!(reg.entries[0].last_accessed.is_none());
        assert!(reg.entries[0].custom_label.is_none());
    }

    #[test]
    fn register_board_no_duplicate() {
        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        reg.register_board("board-1");
        assert_eq!(reg.entries.len(), 1);
    }

    #[test]
    fn register_board_default_order_increments() {
        let mut reg = BoardRegistry::new();
        reg.register_board("a");
        reg.register_board("b");
        reg.register_board("c");
        assert_eq!(reg.entries[0].display_order, 0);
        assert_eq!(reg.entries[1].display_order, 1);
        assert_eq!(reg.entries[2].display_order, 2);
    }

    #[test]
    fn unregister_removes_board() {
        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        reg.register_board("board-2");
        reg.unregister_board("board-1");
        assert_eq!(reg.entries.len(), 1);
        assert_eq!(reg.entries[0].board_id, "board-2");
    }

    #[test]
    fn unregister_nonexistent_is_noop() {
        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        reg.unregister_board("nonexistent");
        assert_eq!(reg.entries.len(), 1);
    }

    #[test]
    fn record_access_updates_timestamp_and_count() {
        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        reg.record_access("board-1");
        let entry = &reg.entries[0];
        assert_eq!(entry.access_count, 1);
        assert!(entry.last_accessed.is_some());

        reg.record_access("board-1");
        let entry = &reg.entries[0];
        assert_eq!(entry.access_count, 2);
    }

    #[test]
    fn record_access_auto_registers() {
        let mut reg = BoardRegistry::new();
        reg.record_access("new-board");
        assert_eq!(reg.entries.len(), 1);
        assert_eq!(reg.entries[0].board_id, "new-board");
        assert_eq!(reg.entries[0].access_count, 1);
        assert!(reg.entries[0].last_accessed.is_some());
    }

    #[test]
    fn set_pinned() {
        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        reg.set_pinned("board-1", true);
        assert!(reg.entries[0].pinned);
        reg.set_pinned("board-1", false);
        assert!(!reg.entries[0].pinned);
    }

    #[test]
    fn set_order() {
        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        reg.set_order("board-1", 42);
        assert_eq!(reg.entries[0].display_order, 42);
    }

    #[test]
    fn set_label() {
        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        reg.set_label("board-1", Some("My Board".to_string()));
        assert_eq!(reg.entries[0].custom_label, Some("My Board".to_string()));
        reg.set_label("board-1", None);
        assert!(reg.entries[0].custom_label.is_none());
    }

    #[test]
    fn sorted_boards_pinned_first_then_order() {
        let mut reg = BoardRegistry::new();
        reg.register_board("a");
        reg.register_board("b");
        reg.register_board("c");
        reg.set_order("a", 2);
        reg.set_order("b", 0);
        reg.set_order("c", 1);
        reg.set_pinned("c", true);

        let sorted = reg.sorted_boards();
        // c is pinned so first, then b (order 0), then a (order 2)
        assert_eq!(sorted[0].board_id, "c");
        assert_eq!(sorted[1].board_id, "b");
        assert_eq!(sorted[2].board_id, "a");
    }

    #[test]
    fn sorted_boards_empty_registry() {
        let reg = BoardRegistry::new();
        let sorted = reg.sorted_boards();
        assert!(sorted.is_empty());
    }

    #[test]
    fn recent_boards_returns_most_recent_first() {
        let mut reg = BoardRegistry::new();
        reg.register_board("a");
        reg.register_board("b");
        reg.register_board("c");

        // Access in order: a, then b, then c
        // We set timestamps manually to ensure deterministic ordering
        reg.entries[0].last_accessed = Some("2024-01-01T00:00:00+00:00".to_string());
        reg.entries[0].access_count = 1;
        reg.entries[1].last_accessed = Some("2024-06-01T00:00:00+00:00".to_string());
        reg.entries[1].access_count = 1;
        reg.entries[2].last_accessed = Some("2024-12-01T00:00:00+00:00".to_string());
        reg.entries[2].access_count = 1;

        let recent = reg.recent_boards(2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].board_id, "c"); // Most recent
        assert_eq!(recent[1].board_id, "b");
    }

    #[test]
    fn recent_boards_excludes_never_accessed() {
        let mut reg = BoardRegistry::new();
        reg.register_board("a");
        reg.register_board("b");
        reg.record_access("a");

        let recent = reg.recent_boards(10);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].board_id, "a");
    }

    #[test]
    fn most_used_boards_returns_highest_count_first() {
        let mut reg = BoardRegistry::new();
        reg.register_board("a");
        reg.register_board("b");
        reg.register_board("c");
        reg.entries[0].access_count = 5;
        reg.entries[1].access_count = 20;
        reg.entries[2].access_count = 10;

        let used = reg.most_used_boards(2);
        assert_eq!(used.len(), 2);
        assert_eq!(used[0].board_id, "b"); // 20 accesses
        assert_eq!(used[1].board_id, "c"); // 10 accesses
    }

    #[test]
    fn reorder_sets_correct_display_order() {
        let mut reg = BoardRegistry::new();
        reg.register_board("a");
        reg.register_board("b");
        reg.register_board("c");

        reg.reorder(&["c".to_string(), "a".to_string(), "b".to_string()]);

        let find = |id: &str| -> i32 {
            reg.entries
                .iter()
                .find(|e| e.board_id == id)
                .map(|e| e.display_order)
                .expect("entry not found")
        };
        assert_eq!(find("c"), 0);
        assert_eq!(find("a"), 1);
        assert_eq!(find("b"), 2);
    }

    #[test]
    fn load_save_roundtrip() {
        let dir = TempDir::new().expect("create temp dir");
        let path = dir.path().join(".lexera-registry.json");

        let mut reg = BoardRegistry::new();
        reg.register_board("board-1");
        reg.register_board("board-2");
        reg.set_pinned("board-1", true);
        reg.set_label("board-2", Some("My Label".to_string()));
        reg.record_access("board-1");

        reg.save(&path).expect("save registry");

        let loaded = BoardRegistry::load(&path).expect("load registry");
        assert_eq!(loaded.entries.len(), 2);

        let e1 = loaded
            .entries
            .iter()
            .find(|e| e.board_id == "board-1")
            .expect("board-1");
        assert!(e1.pinned);
        assert_eq!(e1.access_count, 1);
        assert!(e1.last_accessed.is_some());

        let e2 = loaded
            .entries
            .iter()
            .find(|e| e.board_id == "board-2")
            .expect("board-2");
        assert!(!e2.pinned);
        assert_eq!(e2.custom_label, Some("My Label".to_string()));
    }

    #[test]
    fn load_nonexistent_returns_empty() {
        let dir = TempDir::new().expect("create temp dir");
        let path = dir.path().join("does-not-exist.json");
        let reg = BoardRegistry::load(&path).expect("load from nonexistent");
        assert!(reg.entries.is_empty());
    }

    #[test]
    fn sync_adds_missing_keeps_existing() {
        let mut reg = BoardRegistry::new();
        reg.register_board("existing");
        reg.set_pinned("existing", true);
        reg.entries[0].access_count = 5;

        reg.sync_with_storage(&["existing".to_string(), "new-board".to_string()]);

        assert_eq!(reg.entries.len(), 2);

        // Existing board keeps its metadata
        let existing = reg
            .entries
            .iter()
            .find(|e| e.board_id == "existing")
            .expect("existing board");
        assert!(existing.pinned);
        assert_eq!(existing.access_count, 5);

        // New board is added with defaults
        let new_board = reg
            .entries
            .iter()
            .find(|e| e.board_id == "new-board")
            .expect("new board");
        assert!(!new_board.pinned);
        assert_eq!(new_board.access_count, 0);
    }

    #[test]
    fn sync_does_not_remove_missing_boards() {
        let mut reg = BoardRegistry::new();
        reg.register_board("permanent");
        reg.register_board("on-external-drive");

        // Only "permanent" is known to storage now
        reg.sync_with_storage(&["permanent".to_string()]);

        // "on-external-drive" is kept (may be temporarily unavailable)
        assert_eq!(reg.entries.len(), 2);
        assert!(reg
            .entries
            .iter()
            .any(|e| e.board_id == "on-external-drive"));
    }

    #[test]
    fn default_new_entry_order_is_max_plus_one() {
        let mut reg = BoardRegistry::new();
        reg.register_board("a");
        reg.set_order("a", 10);
        reg.register_board("b");
        assert_eq!(
            reg.entries
                .iter()
                .find(|e| e.board_id == "b")
                .expect("b")
                .display_order,
            11
        );
    }
}
