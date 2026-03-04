/// Local filesystem storage backend.
///
/// Manages board files on disk with:
/// - SHA-256 board ID hashing (first 12 hex chars of file path)
/// - Atomic writes (write to .tmp, rename)
/// - Self-write suppression for file watcher
/// - Mutex-guarded writes to prevent concurrent modification
use std::collections::{HashMap, HashSet};
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
    /// Persisted generation counter from YAML front matter (staleness detection)
    pub generation: u64,
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
            generation: self.generation,
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
    /// Board IDs that are synced from remote servers (not backed by a local file)
    remote_boards: RwLock<HashSet<String>>,
    /// Per-process unique writer identifier for generation metadata
    writer_id: String,
}

/// Check if two boards have different row/stack/column structure (count or IDs).
/// Card-level differences are intentionally ignored — the CRDT handles card merging fine.
///
/// A board with no rows but flat columns (legacy format) is considered structurally
/// equivalent to a board with a single "Default" row / "Default" stack containing
/// the same columns (new format produced by the parser).
fn has_structural_mismatch(a: &KanbanBoard, b: &KanbanBoard) -> bool {
    /// Return the effective flat column IDs for a board, normalizing implicit
    /// Default row/stack to the legacy flat representation.
    fn effective_columns(board: &KanbanBoard) -> Vec<&str> {
        if board.rows.is_empty() {
            board.columns.iter().map(|c| c.id.as_str()).collect()
        } else if board.rows.len() == 1
            && board.rows[0].title == "Default"
            && board.rows[0].stacks.len() == 1
            && board.rows[0].stacks[0].title == "Default"
        {
            // Single Default row with single Default stack — treat as flat columns
            board.rows[0].stacks[0]
                .columns
                .iter()
                .map(|c| c.id.as_str())
                .collect()
        } else {
            // Multi-row or non-default structure — no normalization
            Vec::new()
        }
    }

    let a_is_implicit = a.rows.is_empty()
        || (a.rows.len() == 1
            && a.rows[0].title == "Default"
            && a.rows[0].stacks.len() == 1
            && a.rows[0].stacks[0].title == "Default");
    let b_is_implicit = b.rows.is_empty()
        || (b.rows.len() == 1
            && b.rows[0].title == "Default"
            && b.rows[0].stacks.len() == 1
            && b.rows[0].stacks[0].title == "Default");

    if a_is_implicit && b_is_implicit {
        // Both are implicit Default structures — compare effective flat columns
        let ac = effective_columns(a);
        let bc = effective_columns(b);
        return ac.len() != bc.len() || ac.iter().zip(bc.iter()).any(|(a, b)| a != b);
    }

    // Both have explicit row/stack structure — compare row by row
    if a.rows.len() != b.rows.len() {
        return true;
    }
    for (ar, br) in a.rows.iter().zip(b.rows.iter()) {
        if ar.id != br.id || ar.stacks.len() != br.stacks.len() {
            return true;
        }
        for (as_, bs) in ar.stacks.iter().zip(br.stacks.iter()) {
            if as_.id != bs.id || as_.columns.len() != bs.columns.len() {
                return true;
            }
            for (ac, bc) in as_.columns.iter().zip(bs.columns.iter()) {
                if ac.id != bc.id {
                    return true;
                }
            }
        }
    }
    // Also check legacy flat columns
    if a.columns.len() != b.columns.len() {
        return true;
    }
    for (ac, bc) in a.columns.iter().zip(b.columns.iter()) {
        if ac.id != bc.id {
            return true;
        }
    }
    false
}

impl LocalStorage {
    fn board_has_missing_kids(board: &KanbanBoard) -> bool {
        board.all_columns().iter().any(|column| {
            column.cards.iter().any(|card| {
                card.kid.is_none() && card_identity::extract_kid(&card.content).is_none()
            })
        })
    }

    fn ensure_board_card_kids(board: &KanbanBoard) -> KanbanBoard {
        let mut normalized = board.clone();
        for column in normalized.all_columns_mut() {
            for card in &mut column.cards {
                let original_content = card.content.clone();
                card.content = card_identity::strip_kid(&original_content);
                if card.kid.is_none() {
                    card.kid = Some(card_identity::resolve_kid(&original_content, None));
                }
            }
        }
        normalized
    }

    fn sync_board_include_sources(board: &mut KanbanBoard, board_dir: &Path) {
        for column in board.all_columns_mut() {
            if let Some(raw_path) = syntax::extract_include_path(&column.title) {
                column.include_source = Some(IncludeSource {
                    raw_path: raw_path.clone(),
                    resolved_path: crate::include::resolver::resolve_include_path(
                        &raw_path, board_dir,
                    ),
                });
            } else {
                column.include_source = None;
            }
        }
    }

    fn normalize_board_for_write(board: &KanbanBoard, board_dir: &Path) -> KanbanBoard {
        let mut normalized = Self::ensure_board_card_kids(board);
        Self::sync_board_include_sources(&mut normalized, board_dir);
        normalized.reconcile_format_hint();
        normalized
    }

    fn restore_include_sources(target: &mut KanbanBoard, source: &KanbanBoard) {
        let source_cols = source.all_columns();
        let mut target_cols = target.all_columns_mut();

        if target_cols.len() != source_cols.len() {
            return;
        }

        for (target_col, source_col) in target_cols.iter_mut().zip(source_cols.iter()) {
            target_col.include_source = source_col.include_source.clone();
        }
    }

    fn finalize_merge_result(
        mut result: card_merge::MergeResult,
        board: KanbanBoard,
    ) -> Option<card_merge::MergeResult> {
        if result.conflicts.is_empty() && result.auto_merged == 0 {
            return None;
        }
        result.board = board;
        Some(result)
    }

    fn save_conflict_backup(
        &self,
        file_path: &Path,
        board: &KanbanBoard,
    ) -> Result<(), StorageError> {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup_path = file_path.with_extension(format!("conflict-{}.md", timestamp));
        let user_markdown = parser::generate_markdown(board);
        Self::atomic_write(&backup_path, &user_markdown)?;
        log::warn!(
            "[lexera.storage.merge] Conflict backup saved to {:?}",
            backup_path
        );
        Ok(())
    }

    fn write_board_internal(
        &self,
        board_id: &str,
        board: &KanbanBoard,
        base_board: Option<&KanbanBoard>,
    ) -> Result<Option<card_merge::MergeResult>, StorageError> {
        let lock = self.get_write_lock(board_id)?;
        let _guard = lock.lock().map_err(|e| {
            StorageError::LockPoisoned(format!("write lock for board {}: {}", board_id, e))
        })?;

        let file_path = self
            .get_board_path(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let normalized_board = Self::normalize_board_for_write(board, &board_dir);
        let normalized_base =
            base_board.map(|base| Self::normalize_board_for_write(base, &board_dir));

        // Take the CRDT out for mutation
        let mut crdt = {
            let mut boards = self
                .boards
                .write()
                .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?;
            boards.get_mut(board_id).and_then(|s| s.crdt.take())
        };

        // Read current disk content to check for conflicts
        let stored_hash = self.get_board_content_hash(board_id).unwrap_or_default();
        let disk_content = fs::read_to_string(&file_path)?;
        let disk_hash = Self::content_hash(&disk_content);

        let (mut board_to_write, merge_result) = if let Some(ref mut c) = crdt {
            let mut current = Self::normalize_board_for_write(&c.to_board(), &board_dir);
            if Self::board_has_missing_kids(&current) {
                log::info!(
                    "[lexera.storage.crdt] Missing card identity on board {}, rebuilding CRDT",
                    board_id
                );
                current = Self::ensure_board_card_kids(&current);
                *c = crate::crdt::bridge::CrdtStore::from_board(&current)?;
            }

            if let Some(ref base) = normalized_base {
                let merge = card_merge::three_way_merge(base, &current, &normalized_board);
                let desired_board = Self::normalize_board_for_write(&merge.board, &board_dir);
                c.apply_board(&desired_board, &current)?;
                let mut merged = c.to_board();
                Self::restore_include_sources(&mut merged, &desired_board);

                if has_structural_mismatch(&merged, &desired_board) {
                    log::info!(
                        "[lexera.storage.crdt] Structural mismatch after base-aware merge on board {}, rebuilding CRDT",
                        board_id
                    );
                    *c = crate::crdt::bridge::CrdtStore::from_board(&desired_board)?;
                    let board_to_write = desired_board.clone();
                    (
                        board_to_write.clone(),
                        Self::finalize_merge_result(merge, board_to_write),
                    )
                } else {
                    let board_to_write = merged.clone();
                    (
                        board_to_write.clone(),
                        Self::finalize_merge_result(merge, board_to_write),
                    )
                }
            } else {
                c.apply_board(&normalized_board, &current)?;
                let mut merged = c.to_board();
                Self::restore_include_sources(&mut merged, &normalized_board);

                if has_structural_mismatch(&merged, &normalized_board) {
                    log::info!(
                        "[lexera.storage.crdt] Structural mismatch after CRDT merge on board {}, rebuilding CRDT",
                        board_id
                    );
                    *c = crate::crdt::bridge::CrdtStore::from_board(&normalized_board)?;
                    (normalized_board.clone(), None)
                } else {
                    (merged, None)
                }
            }
        } else if let Some(ref base) = normalized_base {
            let current = Self::normalize_board_for_write(
                &self.parse_with_includes(&disk_content, board_id, &board_dir, &file_path)?,
                &board_dir,
            );
            let merge = card_merge::three_way_merge(base, &current, &normalized_board);

            if !merge.conflicts.is_empty() {
                self.save_conflict_backup(&file_path, &normalized_board)?;
                log::warn!(
                    "[lexera.storage.merge] {} conflicts during base-aware save on board {}",
                    merge.conflicts.len(),
                    board_id
                );
            }

            let board_to_write = Self::normalize_board_for_write(&merge.board, &board_dir);
            (
                board_to_write.clone(),
                Self::finalize_merge_result(merge, board_to_write),
            )
        } else if disk_hash != stored_hash && !stored_hash.is_empty() {
            // Legacy fallback: three-way merge (no CRDT available)
            log::info!(
                "[lexera.storage.merge] Conflict detected on board {}, attempting merge",
                board_id
            );

            let base_board = self
                .boards
                .read()
                .map_err(|e| StorageError::LockPoisoned(format!("boards read: {}", e)))?
                .get(board_id)
                .map(|s| s.board.clone())
                .unwrap_or_else(|| parser::parse_markdown(""));

            let theirs = parser::parse_markdown(&disk_content);
            let result = card_merge::three_way_merge(&base_board, &theirs, &normalized_board);

            if !result.conflicts.is_empty() {
                self.save_conflict_backup(&file_path, &normalized_board)?;
                log::warn!(
                    "[lexera.storage.merge] {} conflicts on board {}",
                    result.conflicts.len(),
                    board_id
                );
            }

            let board_to_write = Self::normalize_board_for_write(&result.board, &board_dir);
            (
                board_to_write.clone(),
                Self::finalize_merge_result(result, board_to_write),
            )
        } else {
            // No conflict — direct write
            (normalized_board.clone(), None)
        };

        // Bump generation counter and set generation metadata
        let current_gen = self
            .boards
            .read()
            .ok()
            .and_then(|b| b.get(board_id).map(|s| s.generation))
            .unwrap_or(0);
        let new_gen = current_gen + 1;

        // Compute body hash from a preview render (body is stable across YAML changes)
        let preview_md = parser::generate_markdown(&board_to_write);
        let content_hash_body = parser::body_hash(&preview_md);

        board_to_write.generation_meta = Some(crate::types::GenerationMeta {
            generation: Some(new_gen),
            content_hash: Some(content_hash_body),
            writer_id: Some(self.writer_id.clone()),
        });

        // Create a backup of the current file before overwriting
        if file_path.exists() {
            let backup_mgr = super::backup::BackupManager::new();
            if let Err(e) = backup_mgr.create_backup(&file_path) {
                log::warn!(
                    "[lexera.storage.backup] Failed to create backup for board {}: {}",
                    board_id,
                    e
                );
            }
        }

        let markdown = self.persist_board_files(board_id, &file_path, &board_to_write)?;

        // Rotate old backups after successful write
        if file_path.exists() {
            let backup_mgr = super::backup::BackupManager::new();
            if let Err(e) = backup_mgr.rotate_backups(&file_path) {
                log::warn!(
                    "[lexera.storage.backup] Failed to rotate backups for board {}: {}",
                    board_id,
                    e
                );
            }
        }

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
            generation: new_gen,
            crdt,
        };

        self.boards
            .write()
            .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?
            .insert(board_id.to_string(), state);

        Ok(merge_result)
    }

    pub fn write_board_from_base(
        &self,
        board_id: &str,
        base_board: &KanbanBoard,
        board: &KanbanBoard,
    ) -> Result<Option<card_merge::MergeResult>, StorageError> {
        self.write_board_internal(board_id, board, Some(base_board))
    }

    pub fn new() -> Self {
        Self {
            boards: RwLock::new(HashMap::new()),
            write_locks: Mutex::new(HashMap::new()),
            self_write_tracker: Mutex::new(SelfWriteTracker::new()),
            include_map: RwLock::new(IncludeMap::new()),
            next_version: std::sync::atomic::AtomicU64::new(1),
            remote_boards: RwLock::new(HashSet::new()),
            writer_id: uuid::Uuid::new_v4().to_string(),
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
        let board = Self::normalize_board_for_write(
            &self.parse_with_includes(&content, &board_id, &board_dir, &file_path)?,
            &board_dir,
        );

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
                    match CrdtStore::from_board(&board) {
                        Ok(c) => {
                            let _ = c.save_to_file(&crdt_path);
                            Some(c)
                        }
                        Err(e) => {
                            log::error!("[lexera.crdt] Failed to build CRDT from board: {}", e);
                            None
                        }
                    }
                }
            }
        } else {
            match CrdtStore::from_board(&board) {
                Ok(c) => {
                    let _ = c.save_to_file(&crdt_path);
                    Some(c)
                }
                Err(e) => {
                    log::error!("[lexera.crdt] Failed to build CRDT from board: {}", e);
                    None
                }
            }
        };

        let generation = board
            .generation_meta
            .as_ref()
            .and_then(|m| m.generation)
            .unwrap_or(0);
        let state = BoardState {
            file_path,
            board,
            last_modified,
            content_hash: Self::content_hash(&content),
            version: self.next_version(),
            generation,
            crdt,
        };

        self.boards
            .write()
            .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?
            .insert(board_id.clone(), state);
        Ok(board_id)
    }

    /// Reload a board from disk (e.g. after file watcher event).
    /// Re-resolves includes and reloads include file contents.
    pub fn reload_board(&self, board_id: &str) -> Result<(), StorageError> {
        // Take the file_path and CRDT out of the existing state
        let (file_path, old_crdt) = {
            let mut boards = self
                .boards
                .write()
                .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?;
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            (state.file_path.clone(), state.crdt.take())
        };

        let content = fs::read_to_string(&file_path)?;
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let board = Self::normalize_board_for_write(
            &self.parse_with_includes(&content, board_id, &board_dir, &file_path)?,
            &board_dir,
        );

        // Staleness check: reject loads with a lower generation than what we have in memory
        let new_gen = board
            .generation_meta
            .as_ref()
            .and_then(|m| m.generation)
            .unwrap_or(0);
        let current_gen = self
            .boards
            .read()
            .ok()
            .and_then(|b| b.get(board_id).map(|s| s.generation))
            .unwrap_or(0);
        if new_gen < current_gen {
            log::warn!(
                "[lexera.storage.reload] Stale file for board {} (gen {} < {}), skipping reload",
                board_id,
                new_gen,
                current_gen
            );
            // Put the CRDT back before returning
            if let Some(crdt) = old_crdt {
                if let Ok(mut boards) = self.boards.write() {
                    if let Some(state) = boards.get_mut(board_id) {
                        state.crdt = Some(crdt);
                    }
                }
            }
            return Ok(());
        }
        if new_gen == current_gen && new_gen > 0 {
            let new_body_hash = parser::body_hash(&content);
            let existing_body_hash = self
                .boards
                .read()
                .ok()
                .and_then(|b| {
                    b.get(board_id)?
                        .board
                        .generation_meta
                        .as_ref()?
                        .content_hash
                        .clone()
                });
            if existing_body_hash.as_deref() == Some(&new_body_hash) {
                // Same generation, same content — no real change
                if let Some(crdt) = old_crdt {
                    if let Ok(mut boards) = self.boards.write() {
                        if let Some(state) = boards.get_mut(board_id) {
                            state.crdt = Some(crdt);
                        }
                    }
                }
                return Ok(());
            }
            log::warn!(
                "[lexera.storage.reload] Same generation ({}) but different content for board {}, accepting external edit",
                new_gen,
                board_id
            );
        }

        let metadata = fs::metadata(&file_path)?;
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());

        // Update CRDT with changes from disk
        let crdt_path = file_path.with_extension("md.crdt");
        let crdt = if let Some(mut c) = old_crdt {
            let old_board = c.to_board();
            if let Err(e) = c.apply_board(&board, &old_board) {
                log::error!("[lexera.crdt] Failed to apply board to CRDT: {}", e);
            }
            c.set_metadata(
                board.yaml_header.clone(),
                board.kanban_footer.clone(),
                board.board_settings.clone(),
            );
            let _ = c.save_to_file(&crdt_path);
            Some(c)
        } else {
            match CrdtStore::from_board(&board) {
                Ok(c) => {
                    let _ = c.save_to_file(&crdt_path);
                    Some(c)
                }
                Err(e) => {
                    log::error!("[lexera.crdt] Failed to build CRDT from board: {}", e);
                    None
                }
            }
        };

        let new_generation = board
            .generation_meta
            .as_ref()
            .and_then(|m| m.generation)
            .unwrap_or(0);
        let new_state = BoardState {
            file_path,
            board,
            last_modified,
            content_hash: Self::content_hash(&content),
            version: self.next_version(),
            generation: new_generation,
            crdt,
        };

        self.boards
            .write()
            .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?
            .insert(board_id.to_string(), new_state);
        Ok(())
    }

    /// Check if a file change at `path` is a self-write by comparing content fingerprint.
    /// If matched, the fingerprint is consumed and true is returned (suppress event).
    /// If no match, returns false (external change, propagate event).
    pub fn check_self_write(&self, path: &Path) -> bool {
        if let Ok(content) = fs::read_to_string(path) {
            match self.self_write_tracker.lock() {
                Ok(mut tracker) => tracker.check_and_consume(path, &content),
                Err(e) => {
                    log::error!(
                        "[lexera.storage.self_write] Self-write tracker lock poisoned: {}",
                        e
                    );
                    false
                }
            }
        } else {
            false
        }
    }

    /// Run periodic cleanup of expired fingerprints.
    pub fn cleanup_expired_fingerprints(&self) {
        match self.self_write_tracker.lock() {
            Ok(mut tracker) => tracker.cleanup_expired(),
            Err(e) => {
                log::error!(
                    "[lexera.storage.cleanup] Self-write tracker lock poisoned: {}",
                    e
                );
            }
        }
    }

    /// Remove a board from tracking. Does not delete the file on disk.
    pub fn remove_board(&self, board_id: &str) -> Result<(), StorageError> {
        let mut boards = self
            .boards
            .write()
            .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?;
        if boards.remove(board_id).is_none() {
            return Err(StorageError::BoardNotFound(board_id.to_string()));
        }
        drop(boards);

        // Clean up write lock
        if let Ok(mut locks) = self.write_locks.lock() {
            locks.remove(board_id);
        }

        // Clean up include map
        if let Ok(mut imap) = self.include_map.write() {
            imap.remove_board(board_id);
        }

        Ok(())
    }

    /// Add a remote board (synced from another server, not backed by a local file).
    pub fn add_remote_board(&self, board_id: &str, board: KanbanBoard) {
        let version = self.next_version();
        let state = BoardState {
            file_path: PathBuf::from(format!("<remote>/{}", board_id)),
            board,
            last_modified: SystemTime::now(),
            content_hash: String::new(),
            version,
            generation: 0,
            crdt: None,
        };
        match self.boards.write() {
            Ok(mut boards) => {
                boards.insert(board_id.to_string(), state);
            }
            Err(e) => {
                log::error!("[lexera.storage.remote] Boards lock poisoned: {}", e);
                return;
            }
        }
        match self.remote_boards.write() {
            Ok(mut remote) => {
                remote.insert(board_id.to_string());
            }
            Err(e) => {
                log::error!("[lexera.storage.remote] Remote boards lock poisoned: {}", e);
            }
        }
    }

    /// Check if a board is a remote board.
    pub fn is_remote_board(&self, board_id: &str) -> bool {
        self.remote_boards
            .read()
            .map(|r| r.contains(board_id))
            .unwrap_or(false)
    }

    /// List all remote board IDs with their titles.
    pub fn list_remote_boards(&self) -> Vec<(String, String, usize)> {
        let remote_ids = match self.remote_boards.read() {
            Ok(r) => r,
            Err(e) => {
                log::error!("[lexera.storage.remote] Remote boards lock poisoned: {}", e);
                return Vec::new();
            }
        };
        let boards = match self.boards.read() {
            Ok(b) => b,
            Err(e) => {
                log::error!("[lexera.storage.remote] Boards lock poisoned: {}", e);
                return Vec::new();
            }
        };
        remote_ids
            .iter()
            .filter_map(|id| {
                boards.get(id).map(|state| {
                    let card_count: usize = state
                        .board
                        .all_columns()
                        .iter()
                        .map(|c| c.cards.len())
                        .sum();
                    (id.clone(), state.board.title.clone(), card_count)
                })
            })
            .collect()
    }

    /// Remove a remote board from tracking.
    pub fn remove_remote_board(&self, board_id: &str) {
        if let Ok(mut remote) = self.remote_boards.write() {
            remote.remove(board_id);
        } else {
            log::error!("[lexera.storage.remote] Remote boards lock poisoned during remove");
        }
        if let Ok(mut boards) = self.boards.write() {
            boards.remove(board_id);
        } else {
            log::error!("[lexera.storage.remote] Boards lock poisoned during remove");
        }
    }

    /// Get the file path for a board ID.
    pub fn get_board_path(&self, board_id: &str) -> Option<PathBuf> {
        self.boards
            .read()
            .ok()?
            .get(board_id)
            .map(|s| s.file_path.clone())
    }

    /// Get the version number for a board (for ETag support).
    pub fn get_board_version(&self, board_id: &str) -> Option<u64> {
        self.boards.read().ok()?.get(board_id).map(|s| s.version)
    }

    /// Get the persisted generation counter for a board (for staleness detection).
    pub fn get_board_generation(&self, board_id: &str) -> Option<u64> {
        self.boards
            .read()
            .ok()?
            .get(board_id)
            .map(|s| s.generation)
    }

    /// Get the content hash for a board (for conflict detection).
    pub fn get_board_content_hash(&self, board_id: &str) -> Option<String> {
        self.boards
            .read()
            .ok()?
            .get(board_id)
            .map(|s| s.content_hash.clone())
    }

    /// Get the include map (read access).
    pub fn include_map(&self) -> Option<std::sync::RwLockReadGuard<'_, IncludeMap>> {
        self.include_map.read().ok()
    }

    /// Parse markdown content with include support.
    /// Detects include columns, loads their files, and updates the include map.
    /// `board_file_path` is the canonical path of the board file itself, used to
    /// seed the visited set so a board cannot include itself.
    fn parse_with_includes(
        &self,
        content: &str,
        board_id: &str,
        board_dir: &Path,
        board_file_path: &Path,
    ) -> Result<KanbanBoard, StorageError> {
        // Seed the visited set with the board file's canonical path
        let mut visited = HashSet::new();
        let canonical =
            fs::canonicalize(board_file_path).unwrap_or_else(|_| board_file_path.to_path_buf());
        visited.insert(canonical);
        self.parse_with_includes_inner(content, board_id, board_dir, &mut visited)
    }

    /// Inner include parser with cycle detection via a visited-path set.
    /// `visited` contains canonical paths that must not be included (the board
    /// file itself, and any ancestor include files in a recursive chain).
    fn parse_with_includes_inner(
        &self,
        content: &str,
        board_id: &str,
        board_dir: &Path,
        visited: &HashSet<PathBuf>,
    ) -> Result<KanbanBoard, StorageError> {
        // First pass: parse to detect include columns
        let preliminary = parser::parse_markdown(content);

        // Check if any columns have includes (check both formats)
        let all_cols = preliminary.all_columns();
        let has_includes = all_cols.iter().any(|c| syntax::is_include(&c.title));

        if !has_includes {
            // No includes — clean up map and return simple parse
            if let Ok(mut map) = self.include_map.write() {
                map.remove_board(board_id);
            } else {
                log::error!("[lexera.storage.include] Include map lock poisoned during remove");
            }
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
                // Skip if already loaded (multiple columns referencing same file)
                if include_contents.contains_key(&raw_path) {
                    continue;
                }

                let resolved = crate::include::resolver::resolve_include_path(&raw_path, board_dir);
                let canonical = fs::canonicalize(&resolved).unwrap_or_else(|_| resolved.clone());

                // Cycle detection: skip if this path is the board file itself
                // or any ancestor in the include chain
                if visited.contains(&canonical) {
                    log::warn!(
                        "[include.resolver] Cycle detected: {} already included",
                        canonical.display()
                    );
                    continue;
                }

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
        if let Ok(mut map) = self.include_map.write() {
            map.register_board(board_id, board_dir, &column_titles);
        } else {
            log::error!("[lexera.storage.include] Include map lock poisoned during register");
        }

        // Parse with include context
        let ctx = parser::ParseContext {
            include_contents,
            board_dir: board_dir.to_path_buf(),
        };
        Ok(parser::parse_markdown_with_includes(content, &ctx))
    }

    fn sync_include_map_for_board(&self, board_id: &str, board: &KanbanBoard, board_dir: &Path) {
        let all_cols = board.all_columns();
        let column_titles: Vec<(usize, &str)> = all_cols
            .iter()
            .enumerate()
            .map(|(i, c)| (i, c.title.as_str()))
            .collect();

        if column_titles
            .iter()
            .any(|(_, title)| syntax::is_include(title))
        {
            if let Ok(mut map) = self.include_map.write() {
                map.register_board(board_id, board_dir, &column_titles);
            } else {
                log::error!(
                    "[lexera.storage.include] Include map lock poisoned during sync register"
                );
            }
        } else {
            if let Ok(mut map) = self.include_map.write() {
                map.remove_board(board_id);
            } else {
                log::error!(
                    "[lexera.storage.include] Include map lock poisoned during sync remove"
                );
            }
        }
    }

    fn write_include_column(&self, column: &KanbanColumn) -> Result<(), StorageError> {
        let include_source = column.include_source.as_ref().ok_or_else(|| {
            StorageError::InvalidBoard("Column is not an include column".to_string())
        })?;

        let resolved_path = include_source.resolved_path.clone();
        let slide_content = slide_parser::generate_slides(&column.cards);

        match self.self_write_tracker.lock() {
            Ok(mut tracker) => tracker.register(&resolved_path, &slide_content),
            Err(e) => log::error!(
                "[lexera.storage.write] Self-write tracker lock poisoned: {}",
                e
            ),
        }

        Self::atomic_write(&resolved_path, &slide_content)?;
        Ok(())
    }

    fn persist_board_files(
        &self,
        board_id: &str,
        file_path: &Path,
        board: &KanbanBoard,
    ) -> Result<String, StorageError> {
        let markdown = parser::generate_markdown(board);

        match self.self_write_tracker.lock() {
            Ok(mut tracker) => tracker.register(file_path, &markdown),
            Err(e) => log::error!(
                "[lexera.storage.write] Self-write tracker lock poisoned: {}",
                e
            ),
        }

        Self::atomic_write(file_path, &markdown)?;

        for column in board.all_columns() {
            if column.include_source.is_some() {
                self.write_include_column(column)?;
            }
        }

        let board_dir = file_path.parent().unwrap_or(Path::new("."));
        self.sync_include_map_for_board(board_id, board, board_dir);

        Ok(markdown)
    }

    /// Write cards to an include file in slide format.
    /// Used when cards in an include column are modified.
    pub fn write_include_file(&self, board_id: &str, col_index: usize) -> Result<(), StorageError> {
        let boards = self.boards.read().map_err(|e| {
            StorageError::LockPoisoned(format!("boards read in write_include_file: {}", e))
        })?;
        let state = boards
            .get(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        let all_cols = state.board.all_columns();
        let column = all_cols
            .get(col_index)
            .copied()
            .ok_or(StorageError::ColumnOutOfRange {
                index: col_index,
                max: all_cols.len().saturating_sub(1),
            })?
            .clone();

        drop(boards);

        if column.include_source.is_none() {
            return Err(StorageError::InvalidBoard(format!(
                "Column {} is not an include column",
                col_index
            )));
        }

        self.write_include_column(&column)
    }

    /// Get a write lock for a specific board.
    fn get_write_lock(&self, board_id: &str) -> Result<Arc<Mutex<()>>, StorageError> {
        let mut locks = self.write_locks.lock().map_err(|e| {
            StorageError::LockPoisoned(format!("write_locks in get_write_lock: {}", e))
        })?;
        Ok(locks
            .entry(board_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
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

    // ── CRDT Sync Methods ────────────────────────────────────────────────

    /// Get the encoded version vector for a board's CRDT (for sync handshake).
    /// Acquires the per-board write lock to avoid reading while CRDT is taken out.
    pub fn get_crdt_vv(&self, board_id: &str) -> Option<Vec<u8>> {
        let lock = self.get_write_lock(board_id).ok()?;
        let _guard = lock.lock().ok()?;
        let boards = self.boards.read().ok()?;
        let state = boards.get(board_id)?;
        let crdt = state.crdt.as_ref()?;
        Some(crdt.oplog_vv().encode())
    }

    /// Export CRDT updates since a given version vector (for sync delta).
    /// `vv_bytes` is the encoded VersionVector from the remote peer.
    /// An empty `vv_bytes` slice is treated as an empty VersionVector (export all).
    /// Acquires the per-board write lock to avoid reading while CRDT is taken out.
    pub fn export_crdt_updates_since(&self, board_id: &str, vv_bytes: &[u8]) -> Option<Vec<u8>> {
        let lock = self.get_write_lock(board_id).ok()?;
        let _guard = lock.lock().ok()?;
        let boards = self.boards.read().ok()?;
        let state = boards.get(board_id)?;
        let crdt = state.crdt.as_ref()?;
        let vv = if vv_bytes.is_empty() {
            loro::VersionVector::default()
        } else {
            loro::VersionVector::decode(vv_bytes).ok()?
        };
        crdt.export_updates_since(&vv).ok()
    }

    pub fn export_crdt_snapshot(&self, board_id: &str) -> Option<Vec<u8>> {
        let lock = self.get_write_lock(board_id).ok()?;
        let _guard = lock.lock().ok()?;
        let boards = self.boards.read().ok()?;
        let state = boards.get(board_id)?;
        let crdt = state.crdt.as_ref()?;
        crdt.save().ok()
    }

    /// Import remote CRDT updates, rebuild the board from CRDT, and persist.
    pub fn import_crdt_updates(&self, board_id: &str, bytes: &[u8]) -> Result<(), StorageError> {
        let lock = self.get_write_lock(board_id)?;
        let _guard = lock.lock().map_err(|e| {
            StorageError::LockPoisoned(format!(
                "write lock for board {} in import_crdt: {}",
                board_id, e
            ))
        })?;

        let file_path = self
            .get_board_path(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        // Take CRDT and current board from state for mutation
        let (mut crdt, current_board) = {
            let mut boards = self.boards.write().map_err(|e| {
                StorageError::LockPoisoned(format!("boards write in import_crdt (take): {}", e))
            })?;
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            (
                state
                    .crdt
                    .take()
                    .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?,
                state.board.clone(),
            )
        };

        if let Err(e) = crdt.import_updates(bytes) {
            // Put CRDT back on failure
            if let Ok(mut boards) = self.boards.write() {
                if let Some(state) = boards.get_mut(board_id) {
                    state.crdt = Some(crdt);
                }
            } else {
                log::error!(
                    "[lexera.crdt] Boards lock poisoned while restoring CRDT after import failure"
                );
            }
            return Err(StorageError::Io(e));
        }

        // Rebuild board from CRDT state
        let mut board = crdt.to_board();
        Self::restore_include_sources(&mut board, &current_board);
        let markdown = self.persist_board_files(board_id, &file_path, &board)?;

        // Save CRDT snapshot
        let crdt_path = file_path.with_extension("md.crdt");
        let _ = crdt.save_to_file(&crdt_path);

        let metadata = fs::metadata(&file_path)?;
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());

        let state = BoardState {
            file_path,
            board,
            last_modified,
            content_hash: Self::content_hash(&markdown),
            version: self.next_version(),
            generation: 0,
            crdt: Some(crdt),
        };

        self.boards
            .write()
            .map_err(|e| {
                StorageError::LockPoisoned(format!("boards write in import_crdt (save): {}", e))
            })?
            .insert(board_id.to_string(), state);

        Ok(())
    }

    pub fn search_with_options(&self, query: &str, options: SearchOptions) -> Vec<SearchResult> {
        let engine = SearchEngine::compile(query, options);
        if engine.is_empty() {
            return Vec::new();
        }

        let boards = match self.boards.read() {
            Ok(b) => b,
            Err(e) => {
                log::error!("[lexera.storage.search] Boards lock poisoned: {}", e);
                return Vec::new();
            }
        };
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
        let boards = match self.boards.read() {
            Ok(b) => b,
            Err(e) => {
                log::error!("[lexera.storage.list] Boards lock poisoned: {}", e);
                return Vec::new();
            }
        };
        let remote_ids = match self.remote_boards.read() {
            Ok(r) => r,
            Err(e) => {
                log::error!("[lexera.storage.list] Remote boards lock poisoned: {}", e);
                return Vec::new();
            }
        };
        boards
            .iter()
            .filter(|(id, _)| !remote_ids.contains(*id))
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
                    board_settings: state.board.board_settings.clone(),
                }
            })
            .collect()
    }

    fn read_board(&self, board_id: &str) -> Option<KanbanBoard> {
        self.boards
            .read()
            .ok()?
            .get(board_id)
            .map(|s| s.board.clone())
    }

    fn write_board(
        &self,
        board_id: &str,
        board: &KanbanBoard,
    ) -> Result<Option<card_merge::MergeResult>, StorageError> {
        self.write_board_internal(board_id, board, None)
    }

    fn add_card(
        &self,
        board_id: &str,
        col_index: usize,
        content: &str,
    ) -> Result<(), StorageError> {
        let lock = self.get_write_lock(board_id)?;
        let _guard = lock.lock().map_err(|e| {
            StorageError::LockPoisoned(format!(
                "write lock for board {} in add_card: {}",
                board_id, e
            ))
        })?;

        let file_path = self
            .get_board_path(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        // Take CRDT from state for mutation
        let mut crdt = {
            let mut boards = self.boards.write().map_err(|e| {
                StorageError::LockPoisoned(format!("boards write in add_card (take crdt): {}", e))
            })?;
            boards.get_mut(board_id).and_then(|s| s.crdt.take())
        };

        // Read fresh from disk
        let file_content = fs::read_to_string(&file_path)?;
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let mut board = Self::normalize_board_for_write(
            &self.parse_with_includes(&file_content, board_id, &board_dir, &file_path)?,
            &board_dir,
        );

        if !board.valid {
            // Put CRDT back before returning error
            if let Some(c) = crdt {
                if let Ok(mut boards) = self.boards.write() {
                    if let Some(state) = boards.get_mut(board_id) {
                        state.crdt = Some(c);
                    }
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
                if let Ok(mut boards) = self.boards.write() {
                    if let Some(state) = boards.get_mut(board_id) {
                        state.crdt = Some(c);
                    }
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
        let kid = card_identity::resolve_kid(content, None);
        let new_card = KanbanCard {
            id: format!("task-{:x}-{:06x}", ts, rand_u24()),
            content: card_identity::strip_kid(content),
            checked: false,
            kid: Some(kid),
        };

        all_cols[col_index].cards.push(new_card);

        // Update CRDT with the new card
        if let Some(ref mut c) = crdt {
            let old_board = c.to_board();
            if let Err(e) = c.apply_board(&board, &old_board) {
                log::error!("[lexera.crdt] Failed to apply card addition to CRDT: {}", e);
            }
        }

        let markdown = self.persist_board_files(board_id, &file_path, &board)?;

        // Save CRDT state
        if let Some(ref c) = crdt {
            let crdt_path = file_path.with_extension("md.crdt");
            let _ = c.save_to_file(&crdt_path);
        }

        let metadata = fs::metadata(&file_path)?;
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());

        self.boards
            .write()
            .map_err(|e| {
                StorageError::LockPoisoned(format!("boards write in add_card (save): {}", e))
            })?
            .insert(
                board_id.to_string(),
                BoardState {
                    file_path,
                    board,
                    last_modified,
                    content_hash: Self::content_hash(&markdown),
                    version: self.next_version(),
                    generation: 0,
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
    use tempfile::{tempdir, NamedTempFile};

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
        assert_eq!(board.all_columns().len(), 2);
    }

    #[test]
    fn test_add_card() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        storage.add_card(&id, 0, "New task").unwrap();

        let board = storage.read_board(&id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols[0].cards.len(), 3);
        assert!(cols[0].cards[2].content.starts_with("New task"));
        assert!(cols[0].cards[2].kid.is_some());

        // Verify it was written to disk
        let on_disk = fs::read_to_string(tmp.path()).unwrap();
        assert!(on_disk.contains("New task"));
        assert!(!on_disk.contains("<!-- kid:"));
    }

    #[test]
    fn test_write_board_strips_legacy_kid_marker_from_disk() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(
            tmp,
            "---\nkanban-plugin: board\n---\n\n## Todo\n- [ ] Existing <!-- kid:a1b2c3d4 -->\n"
        )
        .unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        let board = storage.read_board(&id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols[0].cards[0].content, "Existing");
        assert_eq!(cols[0].cards[0].kid, Some("a1b2c3d4".to_string()));

        storage.write_board(&id, &board).unwrap();

        let on_disk = fs::read_to_string(tmp.path()).unwrap();
        assert!(on_disk.contains("- [ ] Existing\n"));
        assert!(!on_disk.contains("<!-- kid:"));
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

    #[test]
    fn test_write_board_persists_include_column_cards() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        let include_path = dir.path().join("slides.md");

        fs::write(
            &board_path,
            "---\nkanban-plugin: board\n---\n\n## !!!include(./slides.md)!!!\n",
        )
        .unwrap();
        fs::write(&include_path, "# Slide 1\n\nExisting content\n").unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let mut board = storage.read_board(&id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].cards.len(), 1);
        drop(cols);

        let mut cols_mut = board.all_columns_mut();
        cols_mut[0].cards[0].content = "# Slide 1\n\nUpdated content".to_string();
        cols_mut[0].cards.push(KanbanCard {
            id: "slide-added".to_string(),
            content: "# Slide 2\n\nSecond slide".to_string(),
            checked: false,
            kid: None,
        });

        storage.write_board(&id, &board).unwrap();

        let on_disk_board = fs::read_to_string(&board_path).unwrap();
        assert!(on_disk_board.contains("## !!!include(./slides.md)!!!"));
        assert!(!on_disk_board.contains("Updated content"));
        assert!(!on_disk_board.contains("Second slide"));

        let on_disk_include = fs::read_to_string(&include_path).unwrap();
        assert!(on_disk_include.contains("Updated content"));
        assert!(on_disk_include.contains("# Slide 2"));
        assert!(on_disk_include.contains("Second slide"));
        assert!(on_disk_include.contains("\n\n---\n\n"));
    }

    #[test]
    fn test_add_card_persists_into_include_file() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        let include_path = dir.path().join("slides.md");

        fs::write(
            &board_path,
            "---\nkanban-plugin: board\n---\n\n## !!!include(./slides.md)!!!\n",
        )
        .unwrap();
        fs::write(&include_path, "# Slide 1\n\nExisting content\n").unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        storage
            .add_card(&id, 0, "# Slide 2\n\nAdded from API")
            .unwrap();

        let on_disk_board = fs::read_to_string(&board_path).unwrap();
        assert!(on_disk_board.contains("## !!!include(./slides.md)!!!"));
        assert!(!on_disk_board.contains("Added from API"));

        let on_disk_include = fs::read_to_string(&include_path).unwrap();
        assert!(on_disk_include.contains("Existing content"));
        assert!(on_disk_include.contains("# Slide 2"));
        assert!(on_disk_include.contains("Added from API"));
    }

    #[test]
    fn test_write_board_resolves_include_source_from_title_syntax() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        let include_path = dir.path().join("slides.md");

        fs::write(
            &board_path,
            "---\nkanban-plugin: board\n---\n\n## Todo\n- [ ] Task 1\n",
        )
        .unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let mut board = storage.read_board(&id).unwrap();
        {
            let mut cols_mut = board.all_columns_mut();
            cols_mut[0].title = "Todo !!!include(./slides.md)!!!".to_string();
            cols_mut[0].include_source = None;
        }

        storage.write_board(&id, &board).unwrap();

        let on_disk_board = fs::read_to_string(&board_path).unwrap();
        assert!(on_disk_board.contains("## Todo !!!include(./slides.md)!!!"));
        assert!(!on_disk_board.contains("- [ ] Task 1"));

        let on_disk_include = fs::read_to_string(&include_path).unwrap();
        assert!(on_disk_include.contains("Task 1"));
    }

    #[test]
    fn test_write_board_from_base_preserves_remote_cards() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        let base = storage.read_board(&id).unwrap();

        let mut remote = base.clone();
        remote.all_columns_mut()[0].cards.push(KanbanCard {
            id: "remote-card".to_string(),
            content: "Remote addition".to_string(),
            checked: false,
            kid: None,
        });
        storage.write_board(&id, &remote).unwrap();

        let mut ours = base.clone();
        ours.all_columns_mut()[0].cards[0].content = "Buy groceries and fruit".to_string();
        storage.write_board_from_base(&id, &base, &ours).unwrap();

        let merged = storage.read_board(&id).unwrap();
        let merged_cols = merged.all_columns();
        let contents: Vec<String> = merged_cols[0]
            .cards
            .iter()
            .map(|card| card.content.clone())
            .collect();

        assert!(contents.contains(&"Buy groceries and fruit".to_string()));
        assert!(contents.contains(&"Remote addition".to_string()));
        assert_eq!(merged_cols[0].cards.len(), 3);
    }

    #[test]
    fn test_add_board_accepts_presentation_fixture() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/kanban-presentation-tests/kanban-presentation.md");
        assert!(fixture.exists(), "missing fixture: {}", fixture.display());

        let storage = LocalStorage::new();
        let board_id = storage.add_board(&fixture).unwrap();
        let board = storage.read_board(&board_id).unwrap();

        assert!(board.valid);
        assert!(!board.rows.is_empty());
        assert!(
            board.all_columns().len() >= 4,
            "expected multiple columns in fixture board"
        );
    }

    #[test]
    fn test_include_cycle_detection_self_include() {
        // Board file includes itself — cycle detection should skip it
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");

        fs::write(
            &board_path,
            "---\nkanban-plugin: board\n---\n\n## !!!include(./board.md)!!!\n",
        )
        .unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let board = storage.read_board(&id).unwrap();
        assert!(board.valid);
        // The self-including column should have no cards (cycle was skipped)
        let cols = board.all_columns();
        assert_eq!(cols.len(), 1);
        assert!(
            cols[0].cards.is_empty(),
            "self-including column should have no cards due to cycle detection"
        );
    }

    #[test]
    fn test_crdt_recovery_from_corrupt_file() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");

        fs::write(&board_path, TEST_BOARD).unwrap();

        // Write corrupt data to the .crdt file
        let crdt_path = dir.path().join("board.md.crdt");
        fs::write(&crdt_path, b"this is not valid crdt data at all!!!").unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        // Board should load successfully despite corrupt .crdt
        let board = storage.read_board(&id).unwrap();
        assert!(board.valid);

        // CRDT should have been rebuilt (check it exists in state)
        let boards = storage.boards.read().unwrap();
        let state = boards.get(&id).unwrap();
        assert!(
            state.crdt.is_some(),
            "CRDT should be rebuilt from .md after corrupt .crdt"
        );

        // The rebuilt CRDT should produce a board matching the .md
        let crdt_board = state.crdt.as_ref().unwrap().to_board();
        let crdt_cols = crdt_board.all_columns();
        assert_eq!(crdt_cols.len(), 2);
        assert_eq!(crdt_cols[0].title, "Todo");
        assert_eq!(crdt_cols[1].title, "Done");
    }

    #[test]
    fn test_crdt_recovery_missing_crdt_file() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");

        fs::write(&board_path, TEST_BOARD).unwrap();

        // No .crdt file exists at all
        let crdt_path = dir.path().join("board.md.crdt");
        assert!(!crdt_path.exists());

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let board = storage.read_board(&id).unwrap();
        assert!(board.valid);

        // CRDT should have been created fresh
        let boards = storage.boards.read().unwrap();
        let state = boards.get(&id).unwrap();
        assert!(
            state.crdt.is_some(),
            "CRDT should be created fresh when .crdt file is missing"
        );

        // .crdt file should now exist on disk (saved during add_board)
        assert!(
            crdt_path.exists(),
            ".crdt file should be written to disk after creation"
        );
    }

    #[test]
    fn test_crdt_recovery_preserves_board_content() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");

        fs::write(&board_path, TEST_BOARD).unwrap();

        // Write corrupt .crdt to force recovery
        let crdt_path = dir.path().join("board.md.crdt");
        fs::write(&crdt_path, &[0xFF, 0xFE, 0x00, 0x01, 0x02]).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let board = storage.read_board(&id).unwrap();
        assert!(board.valid);
        let cols = board.all_columns();
        assert_eq!(cols.len(), 2);

        // Verify column titles
        assert_eq!(cols[0].title, "Todo");
        assert_eq!(cols[1].title, "Done");

        // Verify card contents
        assert_eq!(cols[0].cards.len(), 2);
        assert_eq!(cols[0].cards[0].content, "Buy groceries");
        assert!(!cols[0].cards[0].checked);
        assert_eq!(cols[0].cards[1].content, "Walk the dog");
        assert!(!cols[0].cards[1].checked);

        assert_eq!(cols[1].cards.len(), 1);
        assert_eq!(cols[1].cards[0].content, "Laundry");
        assert!(cols[1].cards[0].checked);

        // Verify the CRDT also produces the same content
        let boards = storage.boards.read().unwrap();
        let state = boards.get(&id).unwrap();
        let crdt_board = state.crdt.as_ref().unwrap().to_board();
        let crdt_cols = crdt_board.all_columns();
        assert_eq!(crdt_cols.len(), 2);
        assert_eq!(crdt_cols[0].cards.len(), 2);
        assert_eq!(crdt_cols[1].cards.len(), 1);
        assert!(crdt_cols[0].cards[0].content.contains("Buy groceries"));
        assert!(crdt_cols[1].cards[0].content.contains("Laundry"));
    }

    #[test]
    fn test_include_same_file_twice_both_get_cards() {
        // Two columns including the same file should both get cards — this is
        // not a cycle, just two views of the same data
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        let include_path = dir.path().join("slides.md");

        fs::write(
            &board_path,
            "---\nkanban-plugin: board\n---\n\n## !!!include(./slides.md)!!!\n\n## !!!include(./slides.md)!!!\n",
        )
        .unwrap();
        fs::write(&include_path, "# Slide 1\n\nContent\n").unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let board = storage.read_board(&id).unwrap();
        assert!(board.valid);
        let cols = board.all_columns();
        assert_eq!(cols.len(), 2);
        // Both columns should get the same cards from the shared include file
        assert_eq!(cols[0].cards.len(), 1);
        assert_eq!(cols[1].cards.len(), 1);
    }

    #[test]
    fn test_concurrent_read_board() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = Arc::new(LocalStorage::new());
        let id = storage.add_board(tmp.path()).unwrap();

        let thread_count = 8;
        let barrier = Arc::new(std::sync::Barrier::new(thread_count));
        let mut handles = Vec::new();

        for _ in 0..thread_count {
            let s = Arc::clone(&storage);
            let bid = id.clone();
            let b = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                b.wait();
                let board = s.read_board(&bid).unwrap();
                assert!(board.valid);
                let cols = board.all_columns();
                assert_eq!(cols.len(), 2);
                assert_eq!(cols[0].cards.len(), 2);
                assert_eq!(cols[1].cards.len(), 1);
            }));
        }

        for h in handles {
            h.join().expect("thread panicked during concurrent read");
        }
    }

    #[test]
    fn test_concurrent_write_read() {
        let storage = Arc::new(LocalStorage::new());

        // Pre-populate a board via add_remote_board (no file I/O)
        let board = parser::parse_markdown(TEST_BOARD);
        storage.add_remote_board("board-rw", board);

        let thread_count = 8;
        let barrier = Arc::new(std::sync::Barrier::new(thread_count));
        let mut handles = Vec::new();

        // Half the threads write new remote boards, half read the existing one
        for i in 0..thread_count {
            let s = Arc::clone(&storage);
            let b = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                b.wait();
                if i % 2 == 0 {
                    // Writer: add a distinct remote board
                    let new_board = parser::parse_markdown(TEST_BOARD);
                    s.add_remote_board(&format!("board-rw-{}", i), new_board);
                } else {
                    // Reader: read the pre-populated board
                    let board = s.read_board("board-rw");
                    assert!(board.is_some());
                    let board = board.unwrap();
                    assert_eq!(board.all_columns().len(), 2);
                }
            }));
        }

        for h in handles {
            h.join()
                .expect("thread panicked during concurrent write/read");
        }
    }

    #[test]
    fn test_concurrent_multiple_writes() {
        let storage = Arc::new(LocalStorage::new());

        let thread_count = 8;
        let barrier = Arc::new(std::sync::Barrier::new(thread_count));
        let mut handles = Vec::new();

        for i in 0..thread_count {
            let s = Arc::clone(&storage);
            let b = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                b.wait();
                let board = parser::parse_markdown(TEST_BOARD);
                s.add_remote_board(&format!("board-mw-{}", i), board);
            }));
        }

        for h in handles {
            h.join().expect("thread panicked during concurrent writes");
        }

        // Verify all boards were saved correctly
        for i in 0..thread_count {
            let board = storage.read_board(&format!("board-mw-{}", i));
            assert!(board.is_some(), "board-mw-{} should exist", i);
            let board = board.unwrap();
            let cols = board.all_columns();
            assert_eq!(cols.len(), 2);
            assert_eq!(cols[0].cards.len(), 2);
            assert_eq!(cols[1].cards.len(), 1);
        }
    }

    #[test]
    fn test_write_board_atomic_safety() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("atomic-test.md");
        fs::write(&board_path, TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        // Modify the board and write it back
        let mut board = storage.read_board(&id).unwrap();
        board.all_columns_mut()[0].cards[0].content = "Modified task".to_string();
        storage.write_board(&id, &board).unwrap();

        // Verify file content on disk matches what we wrote
        let on_disk = fs::read_to_string(&board_path).unwrap();
        assert!(
            on_disk.contains("Modified task"),
            "disk content should contain modified card"
        );
        assert!(
            !on_disk.contains("Buy groceries"),
            "old card content should be replaced"
        );

        // Verify no .tmp files are left behind
        let tmp_path = board_path.with_extension("lexera-sync.tmp");
        assert!(
            !tmp_path.exists(),
            "temp file should be cleaned up after atomic write"
        );
    }

    #[test]
    fn test_add_card_to_specific_column_index() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("col-idx.md");
        fs::write(&board_path, TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        // Add a card to the second column (index 1 = "Done")
        storage.add_card(&id, 1, "Newly done task").unwrap();

        let board = storage.read_board(&id).unwrap();
        let cols = board.all_columns();
        // "Done" column should now have 2 cards (original "Laundry" + new one)
        assert_eq!(cols[1].cards.len(), 2);
        assert!(
            cols[1].cards[1].content.starts_with("Newly done task"),
            "new card should appear in the Done column"
        );
        // "Todo" column should be unchanged
        assert_eq!(cols[0].cards.len(), 2);

        // Verify on disk
        let on_disk = fs::read_to_string(&board_path).unwrap();
        assert!(on_disk.contains("Newly done task"));
    }

    #[test]
    fn test_remove_board() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("remove-test.md");
        fs::write(&board_path, TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        // Board should be listed
        assert_eq!(storage.list_boards().len(), 1);
        assert!(storage.read_board(&id).is_some());

        // Remove the board
        storage.remove_board(&id).unwrap();

        // Board should no longer be listed or readable
        assert!(storage.list_boards().is_empty());
        assert!(storage.read_board(&id).is_none());
        assert!(storage.get_board_path(&id).is_none());

        // The file on disk should still exist (remove_board only untracks)
        assert!(
            board_path.exists(),
            "remove_board should not delete the file on disk"
        );

        // Removing again should return BoardNotFound
        let result = storage.remove_board(&id);
        assert!(result.is_err());
    }

    #[test]
    fn test_board_with_empty_columns() {
        let empty_col_md = "\
---
kanban-plugin: board
---

## Backlog

## In Progress

## Done
- [x] Shipped feature
";
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("empty-cols.md");
        fs::write(&board_path, empty_col_md).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let board = storage.read_board(&id).unwrap();
        assert!(board.valid);
        let cols = board.all_columns();
        assert_eq!(cols.len(), 3);
        assert_eq!(cols[0].title, "Backlog");
        assert!(cols[0].cards.is_empty(), "Backlog should have no cards");
        assert_eq!(cols[1].title, "In Progress");
        assert!(cols[1].cards.is_empty(), "In Progress should have no cards");
        assert_eq!(cols[2].title, "Done");
        assert_eq!(cols[2].cards.len(), 1);

        // Write back and verify round-trip preserves empty columns
        storage.write_board(&id, &board).unwrap();
        let on_disk = fs::read_to_string(&board_path).unwrap();
        assert!(on_disk.contains("## Backlog"));
        assert!(on_disk.contains("## In Progress"));
        assert!(on_disk.contains("## Done"));

        // Re-read and verify structure is preserved
        let board2 = storage.read_board(&id).unwrap();
        let cols2 = board2.all_columns();
        assert_eq!(cols2.len(), 3);
        assert!(cols2[0].cards.is_empty());
        assert!(cols2[1].cards.is_empty());
        assert_eq!(cols2[2].cards.len(), 1);
    }

    #[test]
    fn test_write_board_new_format_round_trip() {
        let new_format_md = "\
---
kanban-plugin: board
---

# Sprint 1

## Frontend

### Todo
- [ ] Build login page

### Done
- [x] Setup React

## Backend

### Todo
- [ ] Create API endpoints

# Sprint 2

## Design

### Backlog
- [ ] Wireframes
";
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("new-format.md");
        fs::write(&board_path, new_format_md).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let board = storage.read_board(&id).unwrap();
        assert!(board.valid);
        // New format should populate rows, not flat columns
        assert_eq!(
            board.rows.len(),
            2,
            "should have 2 rows (Sprint 1, Sprint 2)"
        );
        assert_eq!(board.rows[0].title, "Sprint 1");
        assert_eq!(
            board.rows[0].stacks.len(),
            2,
            "Sprint 1 should have 2 stacks"
        );
        assert_eq!(board.rows[0].stacks[0].title, "Frontend");
        assert_eq!(board.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(board.rows[0].stacks[0].columns[0].title, "Todo");
        assert_eq!(board.rows[0].stacks[0].columns[1].title, "Done");
        assert_eq!(board.rows[0].stacks[1].title, "Backend");
        assert_eq!(board.rows[0].stacks[1].columns.len(), 1);
        assert_eq!(board.rows[1].title, "Sprint 2");
        assert_eq!(board.rows[1].stacks.len(), 1);
        assert_eq!(board.rows[1].stacks[0].title, "Design");

        // all_columns should flatten all of them
        let all_cols = board.all_columns();
        assert_eq!(all_cols.len(), 4);

        // Write back and re-read — the structure should survive the round-trip
        storage.write_board(&id, &board).unwrap();

        let board2 = storage.read_board(&id).unwrap();
        assert!(board2.valid);
        assert_eq!(board2.rows.len(), 2);
        assert_eq!(board2.rows[0].title, "Sprint 1");
        assert_eq!(board2.rows[0].stacks.len(), 2);
        assert_eq!(board2.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(board2.rows[0].stacks[1].columns.len(), 1);
        assert_eq!(board2.rows[1].stacks.len(), 1);
        assert_eq!(board2.rows[1].stacks[0].columns.len(), 1);

        // Card content should survive
        let all_cols2 = board2.all_columns();
        assert_eq!(all_cols2.len(), 4);
        assert!(all_cols2[0].cards[0].content.contains("Build login page"));
        assert!(all_cols2[1].cards[0].content.contains("Setup React"));
        assert!(all_cols2[2].cards[0]
            .content
            .contains("Create API endpoints"));
        assert!(all_cols2[3].cards[0].content.contains("Wireframes"));

        // Verify disk content uses # / ## / ### headers
        let on_disk = fs::read_to_string(&board_path).unwrap();
        assert!(on_disk.contains("# Sprint 1"));
        assert!(on_disk.contains("## Frontend"));
        assert!(on_disk.contains("### Todo"));
        assert!(on_disk.contains("# Sprint 2"));
    }

    #[test]
    fn test_write_board_new_format_preserves_empty_row_stack_and_column() {
        let new_format_md = "\
---
kanban-plugin: board
---

# Sprint 1

## Frontend

### Todo
- [ ] Build login page
";
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("new-format-empty-structures.md");
        fs::write(&board_path, new_format_md).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let mut board = storage.read_board(&id).unwrap();
        assert!(board.valid);
        assert_eq!(board.rows.len(), 1);
        assert_eq!(board.rows[0].stacks.len(), 1);
        assert_eq!(board.rows[0].stacks[0].columns.len(), 1);
        board.format_hint = BoardFormat::Legacy;

        board.rows[0].stacks[0].columns.push(KanbanColumn {
            id: "col-empty".to_string(),
            title: "Empty Column".to_string(),
            cards: vec![],
            include_source: None,
        });
        board.rows[0].stacks.push(KanbanStack {
            id: "stack-empty".to_string(),
            title: "Empty Stack".to_string(),
            columns: vec![KanbanColumn {
                id: "col-in-empty-stack".to_string(),
                title: "Stack Column".to_string(),
                cards: vec![],
                include_source: None,
            }],
        });
        board.rows.push(KanbanRow {
            id: "row-empty".to_string(),
            title: "Empty Row".to_string(),
            stacks: vec![KanbanStack {
                id: "row-empty-stack".to_string(),
                title: "Default".to_string(),
                columns: vec![KanbanColumn {
                    id: "row-empty-column".to_string(),
                    title: "Row Column".to_string(),
                    cards: vec![],
                    include_source: None,
                }],
            }],
        });

        storage.write_board(&id, &board).unwrap();

        let board2 = storage.read_board(&id).unwrap();
        assert!(board2.valid);
        assert_eq!(board2.rows.len(), 2);
        assert_eq!(board2.rows[0].title, "Sprint 1");
        assert_eq!(board2.rows[1].title, "Empty Row");
        assert_eq!(board2.rows[0].stacks.len(), 2);
        assert_eq!(board2.rows[0].stacks[1].title, "Empty Stack");
        assert_eq!(board2.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(board2.rows[0].stacks[0].columns[1].title, "Empty Column");
        assert_eq!(board2.rows[1].stacks.len(), 1);
        assert_eq!(board2.rows[1].stacks[0].columns.len(), 1);
        assert_eq!(board2.rows[1].stacks[0].columns[0].title, "Row Column");

        let on_disk = fs::read_to_string(&board_path).unwrap();
        assert!(on_disk.contains("# Empty Row"));
        assert!(on_disk.contains("## Empty Stack"));
        assert!(on_disk.contains("### Empty Column"));
        assert!(on_disk.contains("### Row Column"));
    }

    #[test]
    fn test_write_board_legacy_upgrades_when_explicit_hierarchy_is_added() {
        let legacy_md = "\
---
kanban-plugin: board
---

## Todo
- [ ] Existing task
";
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("legacy-upgrade-to-hierarchy.md");
        fs::write(&board_path, legacy_md).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let mut board = storage.read_board(&id).unwrap();
        assert!(board.valid);
        assert_eq!(board.format_hint, BoardFormat::Legacy);
        assert_eq!(board.rows.len(), 1);
        assert_eq!(board.rows[0].title, "Default");
        assert_eq!(board.rows[0].stacks.len(), 1);
        assert_eq!(board.rows[0].stacks[0].title, "Default");

        board.rows[0].title = "Sprint 1".to_string();
        board.rows[0].stacks[0].title = "Frontend".to_string();
        board.rows[0].stacks[0].columns.push(KanbanColumn {
            id: "col-new".to_string(),
            title: "Done".to_string(),
            cards: vec![],
            include_source: None,
        });
        board.rows.push(KanbanRow {
            id: "row-new".to_string(),
            title: "Sprint 2".to_string(),
            stacks: vec![KanbanStack {
                id: "stack-new".to_string(),
                title: "Backend".to_string(),
                columns: vec![KanbanColumn {
                    id: "col-backlog".to_string(),
                    title: "Backlog".to_string(),
                    cards: vec![],
                    include_source: None,
                }],
            }],
        });

        storage.write_board(&id, &board).unwrap();

        let board2 = storage.read_board(&id).unwrap();
        assert!(board2.valid);
        assert_eq!(board2.format_hint, BoardFormat::New);
        assert_eq!(board2.rows.len(), 2);
        assert_eq!(board2.rows[0].title, "Sprint 1");
        assert_eq!(board2.rows[0].stacks[0].title, "Frontend");
        assert_eq!(board2.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(board2.rows[1].title, "Sprint 2");
        assert_eq!(board2.rows[1].stacks[0].title, "Backend");
        assert_eq!(board2.rows[1].stacks[0].columns[0].title, "Backlog");

        let on_disk = fs::read_to_string(&board_path).unwrap();
        assert!(on_disk.contains("# Sprint 1"));
        assert!(on_disk.contains("## Frontend"));
        assert!(on_disk.contains("### Done"));
        assert!(on_disk.contains("# Sprint 2"));
        assert!(on_disk.contains("## Backend"));
    }

    #[test]
    fn test_get_board_path() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("path-test.md");
        fs::write(&board_path, TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let returned_path = storage.get_board_path(&id);
        assert!(
            returned_path.is_some(),
            "get_board_path should return Some for a known board"
        );

        // add_board canonicalizes the path, so compare canonical forms
        let canonical = fs::canonicalize(&board_path).unwrap();
        assert_eq!(
            returned_path.unwrap(),
            canonical,
            "get_board_path should return the canonicalized file path"
        );

        // Unknown board ID should return None
        assert!(
            storage.get_board_path("nonexistent_id").is_none(),
            "get_board_path should return None for unknown board ID"
        );
    }
}
