/// Local filesystem storage backend.
///
/// Manages board files on disk with:
/// - SHA-256 board ID hashing (first 12 hex chars of file path)
/// - Atomic writes (write to .tmp, rename)
/// - Self-write suppression for file watcher
/// - Mutex-guarded writes to prevent concurrent modification
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;

use sha2::{Digest, Sha256};

use super::{BoardStorage, StorageError};
use crate::crdt::bridge::CrdtStore;
use crate::include::resolver::IncludeMap;
use crate::include::slide_parser;
use crate::include::syntax;
use crate::merge::card_identity;
use crate::merge::merge as card_merge;
use crate::parser;
use crate::search::{SearchCardMeta, SearchDocument, SearchEngine, SearchOptions};
use crate::types::*;
use crate::watcher::self_write::SelfWriteTracker;

/// State for a single tracked board.
#[derive(Debug)]
pub struct BoardState {
    pub file_path: PathBuf,
    pub board: KanbanBoard,
    pub last_modified: SystemTime,
    /// SHA-256 of the last read/written content
    pub content_hash: String,
    /// Monotonic version counter, incremented on every change
    pub version: u64,
    /// CRDT document for collaborative merge (Phase 1: initialized on load)
    pub crdt: Option<CrdtStore>,
}

impl Clone for BoardState {
    fn clone(&self) -> Self {
        Self {
            file_path: self.file_path.clone(),
            board: self.board.clone(),
            last_modified: self.last_modified,
            content_hash: self.content_hash.clone(),
            version: self.version,
            crdt: None, // CRDT is not cloned — reconstructed when needed
        }
    }
}

#[derive(Clone, Copy)]
struct SearchColumnRef<'a> {
    column: &'a KanbanColumn,
    flat_index: usize,
    row_index: Option<usize>,
    stack_index: Option<usize>,
    col_local_index: Option<usize>,
}

/// Local filesystem board storage.
pub struct LocalStorage {
    /// board_id -> BoardState
    boards: RwLock<HashMap<String, BoardState>>,
    /// Per-file write mutex to prevent concurrent modification
    write_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// SHA-256 fingerprint tracker for self-write detection
    self_write_tracker: Mutex<SelfWriteTracker>,
    /// Bidirectional mapping between boards and include files
    include_map: RwLock<IncludeMap>,
    /// Global version counter (monotonic, shared across all boards)
    next_version: std::sync::atomic::AtomicU64,
}

impl LocalStorage {
    pub fn new() -> Self {
        Self {
            boards: RwLock::new(HashMap::new()),
            write_locks: Mutex::new(HashMap::new()),
            self_write_tracker: Mutex::new(SelfWriteTracker::new()),
            include_map: RwLock::new(IncludeMap::new()),
            next_version: std::sync::atomic::AtomicU64::new(1),
        }
    }

    /// Get the next version number.
    fn next_version(&self) -> u64 {
        self.next_version
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    /// Compute SHA-256 hash of content (for change detection).
    fn content_hash(content: &str) -> String {
        use sha2::Digest;
        let mut hasher = Sha256::new();
        hasher.update(content.replace("\r\n", "\n").as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Deterministic board ID from file path: SHA-256 first 12 hex chars.
    pub fn board_id_from_path(file_path: &Path) -> String {
        let mut hasher = Sha256::new();
        hasher.update(file_path.to_string_lossy().as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..6])
    }

    /// Add a board file to tracking. Reads and parses it immediately.
    /// Detects include columns and loads their content from include files.
    pub fn add_board(&self, file_path: &Path) -> Result<String, StorageError> {
        let file_path = fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf());
        let board_id = Self::board_id_from_path(&file_path);

        let content = fs::read_to_string(&file_path)?;

        // First parse to check validity and detect includes
        let preliminary = parser::parse_markdown(&content);
        if !preliminary.valid {
            return Err(StorageError::InvalidBoard(
                file_path.to_string_lossy().to_string(),
            ));
        }

        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let board = self.parse_with_includes(&content, &board_id, &board_dir)?;

        let metadata = fs::metadata(&file_path)?;
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());

        // Initialize CRDT: load from .crdt file or create from board
        let crdt_path = file_path.with_extension("md.crdt");
        let crdt = if crdt_path.exists() {
            match CrdtStore::load_from_file(&crdt_path) {
                Ok(mut c) => {
                    c.set_metadata(
                        board.yaml_header.clone(),
                        board.kanban_footer.clone(),
                        board.board_settings.clone(),
                    );
                    Some(c)
                }
                Err(e) => {
                    log::warn!("[lexera.crdt] Failed to load .crdt file: {}", e);
                    let c = CrdtStore::from_board(&board);
                    let _ = c.save_to_file(&crdt_path);
                    Some(c)
                }
            }
        } else {
            let c = CrdtStore::from_board(&board);
            let _ = c.save_to_file(&crdt_path);
            Some(c)
        };

        let state = BoardState {
            file_path,
            board,
            last_modified,
            content_hash: Self::content_hash(&content),
            version: self.next_version(),
            crdt,
        };

        self.boards.write().unwrap().insert(board_id.clone(), state);
        Ok(board_id)
    }

    /// Reload a board from disk (e.g. after file watcher event).
    /// Re-resolves includes and reloads include file contents.
    pub fn reload_board(&self, board_id: &str) -> Result<(), StorageError> {
        // Take the file_path and CRDT out of the existing state
        let (file_path, old_crdt) = {
            let mut boards = self.boards.write().unwrap();
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            (state.file_path.clone(), state.crdt.take())
        };

        let content = fs::read_to_string(&file_path)?;
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let board = self.parse_with_includes(&content, board_id, &board_dir)?;

        let metadata = fs::metadata(&file_path)?;
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());

        // Update CRDT with changes from disk
        let crdt_path = file_path.with_extension("md.crdt");
        let crdt = if let Some(mut c) = old_crdt {
            let old_board = c.to_board();
            c.apply_board(&board, &old_board);
            c.set_metadata(
                board.yaml_header.clone(),
                board.kanban_footer.clone(),
                board.board_settings.clone(),
            );
            let _ = c.save_to_file(&crdt_path);
            Some(c)
        } else {
            let c = CrdtStore::from_board(&board);
            let _ = c.save_to_file(&crdt_path);
            Some(c)
        };

        let new_state = BoardState {
            file_path,
            board,
            last_modified,
            content_hash: Self::content_hash(&content),
            version: self.next_version(),
            crdt,
        };

        self.boards
            .write()
            .unwrap()
            .insert(board_id.to_string(), new_state);
        Ok(())
    }

    /// Check if a file change at `path` is a self-write by comparing content fingerprint.
    /// If matched, the fingerprint is consumed and true is returned (suppress event).
    /// If no match, returns false (external change, propagate event).
    pub fn check_self_write(&self, path: &Path) -> bool {
        if let Ok(content) = fs::read_to_string(path) {
            self.self_write_tracker
                .lock()
                .unwrap()
                .check_and_consume(path, &content)
        } else {
            false
        }
    }

    /// Run periodic cleanup of expired fingerprints.
    pub fn cleanup_expired_fingerprints(&self) {
        self.self_write_tracker.lock().unwrap().cleanup_expired();
    }

    /// Remove a board from tracking. Does not delete the file on disk.
    pub fn remove_board(&self, board_id: &str) -> Result<(), StorageError> {
        let mut boards = self.boards.write().unwrap();
        if boards.remove(board_id).is_none() {
            return Err(StorageError::BoardNotFound(board_id.to_string()));
        }
        drop(boards);

        // Clean up write lock
        self.write_locks.lock().unwrap().remove(board_id);

        // Clean up include map
        self.include_map.write().unwrap().remove_board(board_id);

        Ok(())
    }

    /// Get the file path for a board ID.
    pub fn get_board_path(&self, board_id: &str) -> Option<PathBuf> {
        self.boards
            .read()
            .unwrap()
            .get(board_id)
            .map(|s| s.file_path.clone())
    }

    /// Get the version number for a board (for ETag support).
    pub fn get_board_version(&self, board_id: &str) -> Option<u64> {
        self.boards.read().unwrap().get(board_id).map(|s| s.version)
    }

    /// Get the content hash for a board (for conflict detection).
    pub fn get_board_content_hash(&self, board_id: &str) -> Option<String> {
        self.boards
            .read()
            .unwrap()
            .get(board_id)
            .map(|s| s.content_hash.clone())
    }

    /// Get the include map (read access).
    pub fn include_map(&self) -> std::sync::RwLockReadGuard<'_, IncludeMap> {
        self.include_map.read().unwrap()
    }

    /// Parse markdown content with include support.
    /// Detects include columns, loads their files, and updates the include map.
    fn parse_with_includes(
        &self,
        content: &str,
        board_id: &str,
        board_dir: &Path,
    ) -> Result<KanbanBoard, StorageError> {
        // First pass: parse to detect include columns
        let preliminary = parser::parse_markdown(content);

        // Check if any columns have includes (check both formats)
        let all_cols = preliminary.all_columns();
        let has_includes = all_cols.iter().any(|c| syntax::is_include(&c.title));

        if !has_includes {
            // No includes — clean up map and return simple parse
            self.include_map.write().unwrap().remove_board(board_id);
            return Ok(preliminary);
        }

        // Build include contents map by reading include files
        let mut include_contents = std::collections::HashMap::new();
        let column_titles: Vec<(usize, &str)> = all_cols
            .iter()
            .enumerate()
            .map(|(i, c)| (i, c.title.as_str()))
            .collect();

        for (_, title) in &column_titles {
            if let Some(raw_path) = syntax::extract_include_path(title) {
                let resolved = crate::include::resolver::resolve_include_path(&raw_path, board_dir);
                match fs::read_to_string(&resolved) {
                    Ok(file_content) => {
                        include_contents.insert(raw_path, file_content);
                    }
                    Err(e) => {
                        log::warn!(
                            "[lexera.storage.include] Failed to read include file {:?}: {}",
                            resolved,
                            e
                        );
                    }
                }
            }
        }

        // Update include map
        self.include_map
            .write()
            .unwrap()
            .register_board(board_id, board_dir, &column_titles);

        // Parse with include context
        let ctx = parser::ParseContext {
            include_contents,
            board_dir: board_dir.to_path_buf(),
        };
        Ok(parser::parse_markdown_with_includes(content, &ctx))
    }

    /// Write cards to an include file in slide format.
    /// Used when cards in an include column are modified.
    pub fn write_include_file(&self, board_id: &str, col_index: usize) -> Result<(), StorageError> {
        let boards = self.boards.read().unwrap();
        let state = boards
            .get(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        let all_cols = state.board.all_columns();
        let column = all_cols
            .get(col_index)
            .ok_or(StorageError::ColumnOutOfRange {
                index: col_index,
                max: all_cols.len().saturating_sub(1),
            })?;

        let include_source = column.include_source.as_ref().ok_or_else(|| {
            StorageError::InvalidBoard(format!("Column {} is not an include column", col_index))
        })?;

        let resolved_path = include_source.resolved_path.clone();
        let slide_content = slide_parser::generate_slides(&column.cards);
        drop(boards);

        // Register fingerprint for self-write detection
        self.self_write_tracker
            .lock()
            .unwrap()
            .register(&resolved_path, &slide_content);

        Self::atomic_write(&resolved_path, &slide_content)?;
        Ok(())
    }

    /// Get a write lock for a specific board.
    fn get_write_lock(&self, board_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.write_locks.lock().unwrap();
        locks
            .entry(board_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Atomic write with fsync: write to .tmp, fsync, rename, fsync directory.
    /// Refuses to write empty content over a non-empty file (data safety).
    fn atomic_write(path: &Path, content: &str) -> Result<(), std::io::Error> {
        // Non-empty-to-empty protection
        if content.trim().is_empty() {
            if let Ok(existing) = fs::read_to_string(path) {
                if !existing.trim().is_empty() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "Refusing to overwrite non-empty file with empty content",
                    ));
                }
            }
        }

        let tmp_path = path.with_extension("lexera-sync.tmp");
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(content.as_bytes())?;
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

    fn collect_search_columns(board: &KanbanBoard) -> Vec<SearchColumnRef<'_>> {
        if board.rows.is_empty() {
            return board
                .columns
                .iter()
                .enumerate()
                .map(|(index, column)| SearchColumnRef {
                    column,
                    flat_index: index,
                    row_index: None,
                    stack_index: None,
                    col_local_index: None,
                })
                .collect();
        }

        let mut refs = Vec::new();
        let mut flat_index = 0usize;
        for (row_index, row) in board.rows.iter().enumerate() {
            for (stack_index, stack) in row.stacks.iter().enumerate() {
                for (col_local_index, column) in stack.columns.iter().enumerate() {
                    refs.push(SearchColumnRef {
                        column,
                        flat_index,
                        row_index: Some(row_index),
                        stack_index: Some(stack_index),
                        col_local_index: Some(col_local_index),
                    });
                    flat_index += 1;
                }
            }
        }
        refs
    }

    pub fn search_with_options(&self, query: &str, options: SearchOptions) -> Vec<SearchResult> {
        let engine = SearchEngine::compile(query, options);
        if engine.is_empty() {
            return Vec::new();
        }

        let boards = self.boards.read().unwrap();
        let mut results = Vec::new();

        for (board_id, state) in boards.iter() {
            let col_refs = Self::collect_search_columns(&state.board);
            for col_ref in col_refs {
                if is_archived_or_deleted(&col_ref.column.title) {
                    continue;
                }
                for card in &col_ref.column.cards {
                    if is_archived_or_deleted(&card.content) {
                        continue;
                    }

                    let meta = SearchCardMeta::from_card(&card.content, card.checked);
                    let doc = SearchDocument {
                        board_title: &state.board.title,
                        column_title: &col_ref.column.title,
                        card_content: &card.content,
                        checked: card.checked,
                        meta: &meta,
                    };
                    if !engine.matches(&doc) {
                        continue;
                    }

                    results.push(SearchResult {
                        board_id: board_id.clone(),
                        board_title: state.board.title.clone(),
                        column_title: col_ref.column.title.clone(),
                        column_index: col_ref.flat_index,
                        row_index: col_ref.row_index,
                        stack_index: col_ref.stack_index,
                        col_local_index: col_ref.col_local_index,
                        card_id: card.id.clone(),
                        card_content: card.content.clone(),
                        checked: card.checked,
                        hash_tags: meta.hash_tags.clone(),
                        temporal_tags: meta.temporal_tags.clone(),
                        due_date: meta.due_date.map(|d| d.to_string()),
                        is_overdue: meta.is_overdue,
                    });
                }
            }
        }

        results.sort_by(|a, b| {
            a.board_title
                .to_ascii_lowercase()
                .cmp(&b.board_title.to_ascii_lowercase())
                .then_with(|| a.board_id.cmp(&b.board_id))
                .then_with(|| a.column_index.cmp(&b.column_index))
                .then_with(|| {
                    a.card_content
                        .to_ascii_lowercase()
                        .cmp(&b.card_content.to_ascii_lowercase())
                })
        });

        results
    }
}

impl BoardStorage for LocalStorage {
    fn list_boards(&self) -> Vec<BoardInfo> {
        let boards = self.boards.read().unwrap();
        boards
            .iter()
            .map(|(id, state)| {
                let columns = state
                    .board
                    .all_columns()
                    .iter()
                    .enumerate()
                    .filter(|(_, col)| !is_archived_or_deleted(&col.title))
                    .map(|(index, col)| ColumnSummary {
                        index,
                        title: col.title.clone(),
                        card_count: col
                            .cards
                            .iter()
                            .filter(|c| !is_archived_or_deleted(&c.content))
                            .count(),
                    })
                    .collect();

                let last_modified = state
                    .last_modified
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                BoardInfo {
                    id: id.clone(),
                    title: state.board.title.clone(),
                    file_path: state.file_path.to_string_lossy().to_string(),
                    last_modified: format!("{}Z", last_modified),
                    columns,
                }
            })
            .collect()
    }

    fn read_board(&self, board_id: &str) -> Option<KanbanBoard> {
        self.boards
            .read()
            .unwrap()
            .get(board_id)
            .map(|s| s.board.clone())
    }

    fn write_board(
        &self,
        board_id: &str,
        board: &KanbanBoard,
    ) -> Result<Option<card_merge::MergeResult>, StorageError> {
        let lock = self.get_write_lock(board_id);
        let _guard = lock.lock().unwrap();

        let file_path = self
            .get_board_path(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        // Take the CRDT out for mutation
        let mut crdt = {
            let mut boards = self.boards.write().unwrap();
            boards.get_mut(board_id).and_then(|s| s.crdt.take())
        };

        // Read current disk content to check for conflicts
        let stored_hash = self.get_board_content_hash(board_id).unwrap_or_default();
        let disk_content = fs::read_to_string(&file_path)?;
        let disk_hash = Self::content_hash(&disk_content);

        let (board_to_write, merge_result) = if let Some(ref mut c) = crdt {
            // CRDT path: apply incoming board as CRDT operations
            let current = c.to_board();
            c.apply_board(board, &current);
            let merged = c.to_board();
            (merged, None) // CRDT = no conflicts
        } else if disk_hash != stored_hash && !stored_hash.is_empty() {
            // Legacy fallback: three-way merge (no CRDT available)
            log::info!(
                "[lexera.storage.merge] Conflict detected on board {}, attempting merge",
                board_id
            );

            let base_board = self
                .boards
                .read()
                .unwrap()
                .get(board_id)
                .map(|s| s.board.clone())
                .unwrap_or_else(|| parser::parse_markdown(""));

            let theirs = parser::parse_markdown(&disk_content);
            let result = card_merge::three_way_merge(&base_board, &theirs, board);

            if !result.conflicts.is_empty() {
                // Save user's version as conflict backup
                let timestamp = SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                let backup_path = file_path.with_extension(format!("conflict-{}.md", timestamp));
                let user_markdown = parser::generate_markdown(board);
                let _ = Self::atomic_write(&backup_path, &user_markdown);
                log::warn!(
                    "[lexera.storage.merge] {} conflicts, backup saved to {:?}",
                    result.conflicts.len(),
                    backup_path
                );
            }

            (result.board.clone(), Some(result))
        } else {
            // No conflict — direct write
            (board.clone(), None)
        };

        let markdown = parser::generate_markdown(&board_to_write);

        // Register fingerprint for self-write detection
        self.self_write_tracker
            .lock()
            .unwrap()
            .register(&file_path, &markdown);

        Self::atomic_write(&file_path, &markdown)?;

        // Save CRDT state alongside the markdown file
        if let Some(ref c) = crdt {
            let crdt_path = file_path.with_extension("md.crdt");
            let _ = c.save_to_file(&crdt_path);
        }

        let metadata = fs::metadata(&file_path)?;
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());

        let state = BoardState {
            file_path,
            board: board_to_write,
            last_modified,
            content_hash: Self::content_hash(&markdown),
            version: self.next_version(),
            crdt,
        };

        self.boards
            .write()
            .unwrap()
            .insert(board_id.to_string(), state);

        Ok(merge_result)
    }

    fn add_card(
        &self,
        board_id: &str,
        col_index: usize,
        content: &str,
    ) -> Result<(), StorageError> {
        let lock = self.get_write_lock(board_id);
        let _guard = lock.lock().unwrap();

        let file_path = self
            .get_board_path(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        // Take CRDT from state for mutation
        let mut crdt = {
            let mut boards = self.boards.write().unwrap();
            boards.get_mut(board_id).and_then(|s| s.crdt.take())
        };

        // Read fresh from disk
        let file_content = fs::read_to_string(&file_path)?;
        let mut board = parser::parse_markdown(&file_content);

        if !board.valid {
            // Put CRDT back before returning error
            if let Some(c) = crdt {
                if let Some(state) = self.boards.write().unwrap().get_mut(board_id) {
                    state.crdt = Some(c);
                }
            }
            return Err(StorageError::InvalidBoard(
                file_path.to_string_lossy().to_string(),
            ));
        }

        let mut all_cols = board.all_columns_mut();
        if col_index >= all_cols.len() {
            // Put CRDT back before returning error
            if let Some(c) = crdt {
                if let Some(state) = self.boards.write().unwrap().get_mut(board_id) {
                    state.crdt = Some(c);
                }
            }
            return Err(StorageError::ColumnOutOfRange {
                index: col_index,
                max: all_cols.len().saturating_sub(1),
            });
        }

        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let (content_with_kid, kid) = card_identity::ensure_kid(content);
        let new_card = KanbanCard {
            id: format!("task-{:x}-{:06x}", ts, rand_u24()),
            content: content_with_kid,
            checked: false,
            kid: Some(kid),
        };

        all_cols[col_index].cards.push(new_card);

        // Update CRDT with the new card
        if let Some(ref mut c) = crdt {
            let old_board = c.to_board();
            c.apply_board(&board, &old_board);
        }

        let markdown = parser::generate_markdown(&board);

        // Register fingerprint for self-write detection
        self.self_write_tracker
            .lock()
            .unwrap()
            .register(&file_path, &markdown);

        Self::atomic_write(&file_path, &markdown)?;

        // Save CRDT state
        if let Some(ref c) = crdt {
            let crdt_path = file_path.with_extension("md.crdt");
            let _ = c.save_to_file(&crdt_path);
        }

        let metadata = fs::metadata(&file_path)?;
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());

        self.boards.write().unwrap().insert(
            board_id.to_string(),
            BoardState {
                file_path,
                board,
                last_modified,
                content_hash: Self::content_hash(&markdown),
                version: self.next_version(),
                crdt,
            },
        );

        Ok(())
    }

    fn search(&self, query: &str) -> Vec<SearchResult> {
        LocalStorage::search_with_options(self, query, SearchOptions::default())
    }

    fn search_with_options(&self, query: &str, options: SearchOptions) -> Vec<SearchResult> {
        LocalStorage::search_with_options(self, query, options)
    }
}

/// Simple pseudo-random 24-bit value for card ID uniqueness.
fn rand_u24() -> u32 {
    let t = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    t & 0x00FF_FFFF
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    const TEST_BOARD: &str = "\
---
kanban-plugin: board
---

## Todo
- [ ] Buy groceries
- [ ] Walk the dog

## Done
- [x] Laundry
";

    const TEST_BOARD_ADVANCED: &str = "\
---
kanban-plugin: board
---

## Todo
- [ ] File taxes #finance @2000-01-01
- [ ] Sprint planning #team @2026w09

## Done
- [x] Archive receipts #finance @2000-01-01
";

    const TEST_BOARD_NESTED: &str = "\
---
kanban-plugin: board
---

# Work

## Frontend

### Todo
- [ ] Build UI #ux @2000-01-01

## Backend

### Done
- [x] Setup DB #infra @2000-01-01
";

    #[test]
    fn test_board_id_deterministic() {
        let p = Path::new("/tmp/test.md");
        let id1 = LocalStorage::board_id_from_path(p);
        let id2 = LocalStorage::board_id_from_path(p);
        assert_eq!(id1, id2);
        assert_eq!(id1.len(), 12);
    }

    #[test]
    fn test_add_and_list_boards() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        let boards = storage.list_boards();
        assert_eq!(boards.len(), 1);
        assert_eq!(boards[0].id, id);
        assert_eq!(boards[0].columns.len(), 2);
    }

    #[test]
    fn test_read_board() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        let board = storage.read_board(&id).unwrap();
        assert!(board.valid);
        assert_eq!(board.columns.len(), 2);
    }

    #[test]
    fn test_add_card() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        storage.add_card(&id, 0, "New task").unwrap();

        let board = storage.read_board(&id).unwrap();
        assert_eq!(board.columns[0].cards.len(), 3);
        assert!(board.columns[0].cards[2].content.starts_with("New task"));
        assert!(board.columns[0].cards[2].kid.is_some());

        // Verify it was written to disk
        let on_disk = fs::read_to_string(tmp.path()).unwrap();
        assert!(on_disk.contains("New task"));
    }

    #[test]
    fn test_search() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        storage.add_board(tmp.path()).unwrap();

        let results = storage.search("groceries");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].card_content, "Buy groceries");
        assert!(!results[0].checked);

        let results = storage.search("laundry");
        assert_eq!(results.len(), 1);
        assert!(results[0].checked);

        let results = storage.search("nonexistent");
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_advanced_filters() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD_ADVANCED).unwrap();

        let storage = LocalStorage::new();
        storage.add_board(tmp.path()).unwrap();

        let results =
            storage.search_with_options("#finance is:open due:overdue", SearchOptions::default());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].card_content, "File taxes #finance @2000-01-01");
        assert!(!results[0].checked);
        assert!(results[0].hash_tags.contains(&"#finance".to_string()));
        assert_eq!(results[0].due_date.as_deref(), Some("2000-01-01"));
        assert!(results[0].is_overdue);

        let results = storage.search_with_options("is:done #finance", SearchOptions::default());
        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].card_content,
            "Archive receipts #finance @2000-01-01"
        );
        assert!(results[0].checked);

        let results = storage.search_with_options("col:todo #team", SearchOptions::default());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].card_content, "Sprint planning #team @2026w09");
    }

    #[test]
    fn test_search_nested_indices() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD_NESTED).unwrap();

        let storage = LocalStorage::new();
        storage.add_board(tmp.path()).unwrap();

        let ux = storage.search_with_options("#ux", SearchOptions::default());
        assert_eq!(ux.len(), 1);
        assert_eq!(ux[0].row_index, Some(0));
        assert_eq!(ux[0].stack_index, Some(0));
        assert_eq!(ux[0].col_local_index, Some(0));
        assert_eq!(ux[0].column_index, 0);

        let infra = storage.search_with_options("#infra", SearchOptions::default());
        assert_eq!(infra.len(), 1);
        assert_eq!(infra[0].row_index, Some(0));
        assert_eq!(infra[0].stack_index, Some(1));
        assert_eq!(infra[0].col_local_index, Some(0));
        assert_eq!(infra[0].column_index, 1);
    }

    #[test]
    fn test_add_card_invalid_column() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        let result = storage.add_card(&id, 99, "Bad card");
        assert!(result.is_err());
    }
}
