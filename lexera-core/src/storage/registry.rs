/// Board registry for custom ordering, access tracking, pinning, and search history.
///
/// Stored as a JSON file alongside boards. Provides:
/// - Custom display ordering
/// - Pin/unpin boards
/// - Access history (last accessed, access count)
/// - Custom labels for user-friendly board names
/// - Sync with storage to discover new boards
/// - Recent/pinned search history
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

use chrono::Local;
use serde::{Deserialize, Serialize};

/// Maximum number of unpinned searches to retain.
const MAX_UNPINNED_SEARCHES: usize = 3;

/// A persisted search entry (recent or pinned).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchEntry {
    pub query: String,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_regex: Option<bool>,
}

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
    /// Recent and pinned search history. Pinned entries are never trimmed;
    /// unpinned entries are capped at `MAX_UNPINNED_SEARCHES`.
    #[serde(default)]
    pub search_history: Vec<SearchEntry>,
}

impl BoardRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            search_history: Vec::new(),
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

    // ── Search history ────────────────────────────────────────────────────

    /// Add or promote a search entry.
    ///
    /// Behaviour:
    /// - If the same query already exists and is pinned, it stays pinned and
    ///   is moved to the front of the pinned block.
    /// - If the same query already exists and is unpinned, it is moved to the
    ///   front of the unpinned block.
    /// - New queries are inserted unpinned at the front of the unpinned block.
    /// - Excess unpinned entries beyond `MAX_UNPINNED_SEARCHES` are removed
    ///   (oldest first, from the tail).
    pub fn add_search(&mut self, query: &str, use_regex: Option<bool>) {
        // Capture pin state of any existing entry then remove it
        let was_pinned = self
            .search_history
            .iter()
            .position(|s| s.query == query)
            .map(|i| {
                let pinned = self.search_history[i].pinned;
                self.search_history.remove(i);
                pinned
            })
            .unwrap_or(false);

        // Insert at the front of pinned or unpinned block
        let insert_pos = if was_pinned {
            0
        } else {
            // After the last pinned entry
            self.search_history
                .iter()
                .position(|s| !s.pinned)
                .unwrap_or(self.search_history.len())
        };

        self.search_history.insert(
            insert_pos,
            SearchEntry {
                query: query.to_string(),
                pinned: was_pinned,
                use_regex,
            },
        );

        // Trim unpinned to MAX_UNPINNED_SEARCHES: iterate from tail (oldest) and
        // remove entries until the unpinned count is within the limit.
        let mut unpinned_count = self.search_history.iter().filter(|s| !s.pinned).count();
        let mut i = self.search_history.len();
        while i > 0 && unpinned_count > MAX_UNPINNED_SEARCHES {
            i -= 1;
            if !self.search_history[i].pinned {
                self.search_history.remove(i);
                unpinned_count -= 1;
            }
        }
    }

    /// Toggle the pinned state of a search entry.
    /// Returns `true` if the entry was found and toggled.
    pub fn toggle_pin_search(&mut self, query: &str) -> bool {
        if let Some(entry) = self.search_history.iter_mut().find(|s| s.query == query) {
            entry.pinned = !entry.pinned;
            return true;
        }
        false
    }

    /// Remove a search entry by query string.
    pub fn remove_search(&mut self, query: &str) {
        self.search_history.retain(|s| s.query != query);
    }

    /// Return only the pinned search entries.
    pub fn pinned_searches(&self) -> Vec<&SearchEntry> {
        self.search_history.iter().filter(|s| s.pinned).collect()
    }
}

/// Thread-safe registry owner used by storage backends.
///
/// Keeps registry persistence and lock handling out of `LocalStorage` so the
/// board index can be swapped independently from markdown/CRDT persistence.
#[derive(Debug, Default)]
pub struct BoardRegistryStore {
    registry: RwLock<BoardRegistry>,
    path: Mutex<Option<PathBuf>>,
}

impl BoardRegistryStore {
    pub fn new() -> Self {
        Self {
            registry: RwLock::new(BoardRegistry::new()),
            path: Mutex::new(None),
        }
    }

    /// Load (or create) the registry from `path`, sync it to known board IDs,
    /// persist the sync result, and make it the active registry.
    pub fn init(&self, path: PathBuf, known_ids: &[String]) {
        let mut registry = match BoardRegistry::load(&path) {
            Ok(registry) => registry,
            Err(error) => {
                log::warn!(
                    "[lexera.registry] Failed to load registry from {}: {}",
                    path.display(),
                    error
                );
                BoardRegistry::new()
            }
        };
        registry.sync_with_storage(known_ids);
        if let Err(error) = registry.save(&path) {
            log::warn!(
                "[lexera.registry] Failed to save registry after sync: {}",
                error
            );
        }
        *self.path.lock().unwrap_or_else(|error| error.into_inner()) = Some(path);
        *self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner()) = registry;
    }

    fn save(&self, registry: &BoardRegistry) {
        let guard = self.path.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(path) = guard.as_ref() {
            if let Err(error) = registry.save(path) {
                log::warn!("[lexera.registry] Failed to save: {}", error);
            }
        }
    }

    pub fn register_board(&self, board_id: &str) {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        registry.register_board(board_id);
        self.save(&registry);
    }

    pub fn unregister_board(&self, board_id: &str) {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        registry.unregister_board(board_id);
        self.save(&registry);
    }

    pub fn sorted_boards(&self) -> Vec<BoardRegistryEntry> {
        self.registry
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .sorted_boards()
            .into_iter()
            .cloned()
            .collect()
    }

    pub fn record_access(&self, board_id: &str) {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        registry.record_access(board_id);
        self.save(&registry);
    }

    pub fn reorder(&self, board_ids: &[String]) {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        registry.reorder(board_ids);
        self.save(&registry);
    }

    pub fn set_pinned(&self, board_id: &str, pinned: bool) -> bool {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        if !registry
            .entries
            .iter()
            .any(|entry| entry.board_id == board_id)
        {
            return false;
        }
        registry.set_pinned(board_id, pinned);
        self.save(&registry);
        true
    }

    pub fn set_label(&self, board_id: &str, label: Option<String>) -> bool {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        if !registry
            .entries
            .iter()
            .any(|entry| entry.board_id == board_id)
        {
            return false;
        }
        registry.set_label(board_id, label);
        self.save(&registry);
        true
    }

    pub fn searches(&self) -> Vec<SearchEntry> {
        self.registry
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .search_history
            .clone()
    }

    pub fn add_search(&self, query: &str, use_regex: Option<bool>) {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        registry.add_search(query, use_regex);
        self.save(&registry);
    }

    pub fn toggle_pin_search(&self, query: &str) -> bool {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        let toggled = registry.toggle_pin_search(query);
        if toggled {
            self.save(&registry);
        }
        toggled
    }

    pub fn remove_search(&self, query: &str) {
        let mut registry = self
            .registry
            .write()
            .unwrap_or_else(|error| error.into_inner());
        registry.remove_search(query);
        self.save(&registry);
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

    // ── Search history tests ──────────────────────────────────────────────

    #[test]
    fn add_search_inserts_new_entry() {
        let mut reg = BoardRegistry::new();
        reg.add_search("kanban", None);
        assert_eq!(reg.search_history.len(), 1);
        assert_eq!(reg.search_history[0].query, "kanban");
        assert!(!reg.search_history[0].pinned);
    }

    #[test]
    fn add_search_deduplicates_and_moves_to_front() {
        let mut reg = BoardRegistry::new();
        reg.add_search("a", None);
        reg.add_search("b", None);
        reg.add_search("a", None); // re-add "a"
        assert_eq!(reg.search_history.len(), 2);
        // "a" should now be at the front of unpinned block
        let unpinned: Vec<_> = reg.search_history.iter().filter(|s| !s.pinned).collect();
        assert_eq!(unpinned[0].query, "a");
    }

    #[test]
    fn add_search_trims_unpinned_to_max() {
        let mut reg = BoardRegistry::new();
        reg.add_search("a", None);
        reg.add_search("b", None);
        reg.add_search("c", None);
        reg.add_search("d", None); // 4th unpinned → "a" should be removed
        assert_eq!(reg.search_history.iter().filter(|s| !s.pinned).count(), 3);
        assert!(!reg.search_history.iter().any(|s| s.query == "a"));
    }

    #[test]
    fn pinned_searches_not_trimmed() {
        let mut reg = BoardRegistry::new();
        reg.add_search("pinned-one", None);
        reg.toggle_pin_search("pinned-one");
        reg.add_search("a", None);
        reg.add_search("b", None);
        reg.add_search("c", None);
        reg.add_search("d", None); // triggers trim of unpinned
                                   // "pinned-one" must still be present
        assert!(reg
            .search_history
            .iter()
            .any(|s| s.query == "pinned-one" && s.pinned));
    }

    #[test]
    fn toggle_pin_search() {
        let mut reg = BoardRegistry::new();
        reg.add_search("q", None);
        assert!(!reg.search_history[0].pinned);
        let toggled = reg.toggle_pin_search("q");
        assert!(toggled);
        assert!(reg.search_history[0].pinned);
        reg.toggle_pin_search("q");
        assert!(!reg.search_history[0].pinned);
    }

    #[test]
    fn toggle_pin_nonexistent_returns_false() {
        let mut reg = BoardRegistry::new();
        assert!(!reg.toggle_pin_search("does-not-exist"));
    }

    #[test]
    fn remove_search() {
        let mut reg = BoardRegistry::new();
        reg.add_search("a", None);
        reg.add_search("b", None);
        reg.remove_search("a");
        assert_eq!(reg.search_history.len(), 1);
        assert_eq!(reg.search_history[0].query, "b");
    }

    #[test]
    fn pinned_searches_returns_only_pinned() {
        let mut reg = BoardRegistry::new();
        reg.add_search("pinned", None);
        reg.toggle_pin_search("pinned");
        reg.add_search("unpinned", None);
        let pinned = reg.pinned_searches();
        assert_eq!(pinned.len(), 1);
        assert_eq!(pinned[0].query, "pinned");
    }

    #[test]
    fn search_history_survives_roundtrip() {
        let dir = TempDir::new().expect("create temp dir");
        let path = dir.path().join(".lexera-registry.json");

        let mut reg = BoardRegistry::new();
        reg.add_search("foo", Some(true));
        reg.add_search("bar", None);
        reg.toggle_pin_search("foo");
        reg.save(&path).expect("save");

        let loaded = BoardRegistry::load(&path).expect("load");
        assert_eq!(loaded.search_history.len(), 2);
        let foo = loaded
            .search_history
            .iter()
            .find(|s| s.query == "foo")
            .unwrap();
        assert!(foo.pinned);
        assert_eq!(foo.use_regex, Some(true));
    }
}
