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
use crate::merge::diff::snapshot_board;
use crate::merge::merge as card_merge;
use crate::panic_util::panic_payload_to_string;
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

fn board_card_summary(board: &KanbanBoard) -> String {
    let cols: Vec<String> = board
        .all_columns()
        .iter()
        .map(|col| {
            let kids: Vec<&str> = col
                .cards
                .iter()
                .map(|c| c.kid.as_deref().unwrap_or("??"))
                .collect();
            format!("[{}:{}]", col.title, kids.join(","))
        })
        .collect();
    cols.join(" ")
}

fn board_kid_sample(board: &KanbanBoard, limit: usize) -> Vec<String> {
    board
        .all_columns()
        .iter()
        .flat_map(|column| column.cards.iter())
        .filter_map(|card| card.kid.clone())
        .take(limit)
        .collect()
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

impl Default for LocalStorage {
    fn default() -> Self {
        Self::new()
    }
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
        let mut include_by_column_id: HashMap<String, IncludeSource> = HashMap::new();
        let mut include_by_raw_path: HashMap<String, IncludeSource> = HashMap::new();
        for source_col in source.all_columns() {
            if let Some(include_source) = source_col.include_source.clone() {
                include_by_raw_path.insert(include_source.raw_path.clone(), include_source.clone());
                include_by_column_id.insert(source_col.id.clone(), include_source);
            }
        }

        for target_col in target.all_columns_mut() {
            if target_col.include_source.is_some() {
                continue; // already has include source
            }
            // Primary: match by column ID (stable across normal saves)
            if let Some(include_source) = include_by_column_id.get(&target_col.id) {
                target_col.include_source = Some(include_source.clone());
                continue;
            }
            // Fallback: match by include syntax in column title (survives CRDT
            // rebuilds where column IDs change)
            if let Some(raw_path) = crate::include::syntax::extract_include_path(&target_col.title) {
                if let Some(include_source) = include_by_raw_path.get(&raw_path) {
                    target_col.include_source = Some(include_source.clone());
                }
            }
        }
    }

    fn card_id_map(board: &KanbanBoard) -> HashMap<String, String> {
        let mut map = HashMap::new();
        for column in board.all_columns() {
            for card in &column.cards {
                if let Some(kid) = card.kid.as_ref() {
                    if !kid.is_empty() && !card.id.is_empty() {
                        map.insert(kid.clone(), card.id.clone());
                    }
                }
            }
        }
        map
    }

    fn restore_card_ids(board: &mut KanbanBoard, id_map: &HashMap<String, String>) {
        for column in board.all_columns_mut() {
            for card in &mut column.cards {
                let Some(kid) = card.kid.as_ref() else {
                    continue;
                };
                if let Some(id) = id_map.get(kid) {
                    card.id = id.clone();
                }
            }
        }
    }

    fn board_visible_signature(board: &KanbanBoard) -> String {
        let mut normalized = Self::board_without_generation_meta(board);
        normalized.reconcile_format_hint();
        parser::generate_markdown(&normalized)
    }

    fn boards_match_visible_content(a: &KanbanBoard, b: &KanbanBoard) -> bool {
        Self::board_visible_signature(a) == Self::board_visible_signature(b)
    }

    /// Compare the card content of include columns between two boards.
    /// Returns true when every include column has the same cards in both boards.
    fn include_columns_match(a: &KanbanBoard, b: &KanbanBoard) -> bool {
        let a_cols = a.all_columns();
        let b_cols = b.all_columns();
        for a_col in &a_cols {
            if a_col.include_source.is_none() {
                continue;
            }
            let a_content = slide_parser::generate_slides(&a_col.cards);
            let b_content = b_cols
                .iter()
                .find(|bc| bc.id == a_col.id || bc.title == a_col.title)
                .map(|bc| slide_parser::generate_slides(&bc.cards))
                .unwrap_or_default();
            if a_content != b_content {
                return false;
            }
        }
        true
    }

    fn board_from_crdt_if_semantically_equal(
        board: &KanbanBoard,
        crdt: &CrdtStore,
        board_dir: &Path,
    ) -> Option<KanbanBoard> {
        let normalized_board = Self::normalize_board_for_write(board, board_dir);
        let crdt_snapshot = match crdt.to_board_result() {
            Ok(board) => board,
            Err(error) => {
                log::warn!(
                    target: "lexera.storage.read_board",
                    "Failed to materialize CRDT snapshot during semantic compare: {}",
                    error
                );
                return None;
            }
        };
        let mut crdt_board = Self::normalize_board_for_write(&crdt_snapshot, board_dir);
        Self::restore_include_sources(&mut crdt_board, &normalized_board);
        if !Self::boards_match_visible_content(&normalized_board, &crdt_board) {
            log::info!(
                target: "lexera.storage.read_board",
                "CRDT snapshot rejected after normalization visible_equal=false state_kids={:?} snapshot_kids={:?} state={} snapshot={}",
                board_kid_sample(&normalized_board, 6),
                board_kid_sample(&crdt_board, 6),
                board_card_summary(&normalized_board),
                board_card_summary(&crdt_board)
            );
            return None;
        }

        // The visible-content signature excludes include-column cards (they
        // live in external files, not in the board markdown).  If include
        // content changed on disk, the CRDT snapshot is stale even though
        // the board markdown is identical.  Compare include columns' cards
        // explicitly so the CRDT gets rebuilt from the freshly-parsed board.
        if !Self::include_columns_match(&normalized_board, &crdt_board) {
            log::info!(
                target: "lexera.storage.read_board",
                "CRDT snapshot rejected: include column content differs from disk"
            );
            return None;
        }

        let id_map = Self::card_id_map(&normalized_board);
        Self::restore_card_ids(&mut crdt_board, &id_map);
        crdt_board.yaml_header = board.yaml_header.clone();
        crdt_board.kanban_footer = board.kanban_footer.clone();
        crdt_board.board_settings = board.board_settings.clone();
        crdt_board.generation_meta = board.generation_meta.clone();
        crdt_board.format_hint = board.format_hint;
        crdt_board.reconcile_format_hint();

        // The CRDT bridge returns legacy boards with flat `columns` but the
        // parser always wraps them in Default row/stack (`rows`).  Align the
        // CRDT board to match the parser convention so callers always see a
        // consistent structure.
        if crdt_board.rows.is_empty() && !crdt_board.columns.is_empty() {
            crdt_board.rows = vec![crate::types::KanbanRow {
                id: "row-default".to_string(),
                title: "Default".to_string(),
                stacks: vec![crate::types::KanbanStack {
                    id: "stack-default".to_string(),
                    title: "Default".to_string(),
                    columns: std::mem::take(&mut crdt_board.columns),
                    params: HashMap::new(),
                }],
                params: HashMap::new(),
            }];
        }

        Some(crdt_board)
    }

    fn align_loaded_board_with_crdt(
        board_id: &str,
        board: &KanbanBoard,
        crdt: CrdtStore,
        board_dir: &Path,
    ) -> Result<(KanbanBoard, CrdtStore), StorageError> {
        if let Some(canonical_board) =
            Self::board_from_crdt_if_semantically_equal(board, &crdt, board_dir)
        {
            return Ok((canonical_board, crdt));
        }

        log::warn!(
            "[lexera.storage.crdt] Snapshot diverged from markdown for board {}, rebuilding CRDT from markdown",
            board_id
        );
        match CrdtStore::from_board(board) {
            Ok(rebuilt) => Ok((board.clone(), rebuilt)),
            Err(e) => {
                log::error!(
                    "[lexera.storage.crdt] Failed to rebuild CRDT for board {}, keeping old CRDT to avoid data loss: {}",
                    board_id, e
                );
                Ok((board.clone(), crdt))
            }
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

    fn describe_card_position(snapshot: &crate::merge::diff::CardSnapshot) -> String {
        format!("{}@{}", snapshot.column_title, snapshot.position)
    }

    fn push_card_conflict(
        conflicts: &mut Vec<card_merge::CardConflict>,
        card_id: &str,
        column_title: &str,
        field: card_merge::ConflictField,
        base_value: String,
        theirs_value: String,
        ours_value: String,
    ) {
        conflicts.push(card_merge::CardConflict {
            card_id: card_id.to_string(),
            column_title: column_title.to_string(),
            field,
            base_value,
            theirs_value,
            ours_value,
        });
    }

    fn detect_card_conflicts(
        base: &KanbanBoard,
        current: &KanbanBoard,
        incoming: &KanbanBoard,
    ) -> Vec<card_merge::CardConflict> {
        let base_snap = snapshot_board(base);
        let current_snap = snapshot_board(current);
        let incoming_snap = snapshot_board(incoming);

        let mut kids: HashSet<String> = HashSet::new();
        kids.extend(base_snap.keys().cloned());
        kids.extend(current_snap.keys().cloned());
        kids.extend(incoming_snap.keys().cloned());

        let mut conflicts = Vec::new();

        for kid in kids {
            let base_card = base_snap.get(&kid);
            let current_card = current_snap.get(&kid);
            let incoming_card = incoming_snap.get(&kid);

            let column_title = incoming_card
                .or(current_card)
                .or(base_card)
                .map(|card| card.column_title.as_str())
                .unwrap_or("");

            match (base_card, current_card, incoming_card) {
                (Some(base_card), Some(current_card), Some(incoming_card)) => {
                    if current_card.content != base_card.content
                        && incoming_card.content != base_card.content
                        && current_card.content != incoming_card.content
                    {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Content,
                            base_card.content.clone(),
                            current_card.content.clone(),
                            incoming_card.content.clone(),
                        );
                    }

                    if current_card.checked != base_card.checked
                        && incoming_card.checked != base_card.checked
                        && current_card.checked != incoming_card.checked
                    {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Checked,
                            base_card.checked.to_string(),
                            current_card.checked.to_string(),
                            incoming_card.checked.to_string(),
                        );
                    }

                    let current_position_changed = current_card.column_id != base_card.column_id
                        || current_card.position != base_card.position;
                    let incoming_position_changed = incoming_card.column_id != base_card.column_id
                        || incoming_card.position != base_card.position;
                    if current_position_changed
                        && incoming_position_changed
                        && (current_card.column_id != incoming_card.column_id
                            || current_card.position != incoming_card.position)
                    {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Position,
                            Self::describe_card_position(base_card),
                            Self::describe_card_position(current_card),
                            Self::describe_card_position(incoming_card),
                        );
                    }
                }
                (Some(base_card), None, Some(incoming_card)) => {
                    if incoming_card.content != base_card.content {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Content,
                            base_card.content.clone(),
                            "<deleted>".to_string(),
                            incoming_card.content.clone(),
                        );
                    }
                    if incoming_card.checked != base_card.checked {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Checked,
                            base_card.checked.to_string(),
                            "<deleted>".to_string(),
                            incoming_card.checked.to_string(),
                        );
                    }
                    if incoming_card.column_id != base_card.column_id
                        || incoming_card.position != base_card.position
                    {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Position,
                            Self::describe_card_position(base_card),
                            "<deleted>".to_string(),
                            Self::describe_card_position(incoming_card),
                        );
                    }
                }
                (Some(base_card), Some(current_card), None) => {
                    if current_card.content != base_card.content {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Content,
                            base_card.content.clone(),
                            current_card.content.clone(),
                            "<deleted>".to_string(),
                        );
                    }
                    if current_card.checked != base_card.checked {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Checked,
                            base_card.checked.to_string(),
                            current_card.checked.to_string(),
                            "<deleted>".to_string(),
                        );
                    }
                    if current_card.column_id != base_card.column_id
                        || current_card.position != base_card.position
                    {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Position,
                            Self::describe_card_position(base_card),
                            Self::describe_card_position(current_card),
                            "<deleted>".to_string(),
                        );
                    }
                }
                (None, Some(current_card), Some(incoming_card)) => {
                    if current_card.content != incoming_card.content {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Content,
                            "<added>".to_string(),
                            current_card.content.clone(),
                            incoming_card.content.clone(),
                        );
                    }
                    if current_card.checked != incoming_card.checked {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Checked,
                            "<added>".to_string(),
                            current_card.checked.to_string(),
                            incoming_card.checked.to_string(),
                        );
                    }
                    if current_card.column_id != incoming_card.column_id
                        || current_card.position != incoming_card.position
                    {
                        Self::push_card_conflict(
                            &mut conflicts,
                            &kid,
                            column_title,
                            card_merge::ConflictField::Position,
                            "<added>".to_string(),
                            Self::describe_card_position(current_card),
                            Self::describe_card_position(incoming_card),
                        );
                    }
                }
                _ => {}
            }
        }

        fn field_rank(field: &card_merge::ConflictField) -> u8 {
            match field {
                card_merge::ConflictField::Content => 0,
                card_merge::ConflictField::Checked => 1,
                card_merge::ConflictField::Position => 2,
            }
        }

        conflicts.sort_by(|a, b| {
            a.card_id
                .cmp(&b.card_id)
                .then_with(|| field_rank(&a.field).cmp(&field_rank(&b.field)))
        });
        conflicts
    }

    fn merge_boards_with_crdt(
        base: &KanbanBoard,
        current: &KanbanBoard,
        incoming: &KanbanBoard,
        board_dir: &Path,
    ) -> Result<(KanbanBoard, CrdtStore), StorageError> {
        let base_store = CrdtStore::from_board(base)?;
        let snapshot = base_store.save()?;

        let mut current_store = CrdtStore::load(&snapshot)?;
        current_store.apply_board(current, base)?;

        let mut incoming_store = CrdtStore::load(&snapshot)?;
        incoming_store.set_peer_id(2)?;
        incoming_store.apply_board(incoming, base)?;

        let current_vv = current_store.oplog_vv();
        let incoming_delta = incoming_store.export_updates_since(&current_vv)?;
        current_store.import_updates(&incoming_delta)?;

        let mut merged_board = current_store.to_board_result()?;
        merged_board = Self::normalize_board_for_write(&merged_board, board_dir);
        Self::restore_include_sources(&mut merged_board, current);
        Self::restore_include_sources(&mut merged_board, incoming);
        Ok((merged_board, current_store))
    }

    fn write_crashsave_for_file(
        &self,
        file_path: &Path,
        board: &KanbanBoard,
        reason: &str,
    ) -> Result<super::backup::CrashsaveEntry, StorageError> {
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let normalized = Self::normalize_board_for_write(board, &board_dir);
        let user_markdown = parser::generate_markdown(&normalized);
        let crashsave = super::backup::BackupManager::create_crashsave(file_path, &user_markdown)?;
        log::warn!(
            target: "lexera.storage.crashsave",
            "Saved crashsave for reason={} to {:?}",
            reason,
            crashsave.path
        );
        Ok(crashsave)
    }

    fn board_without_generation_meta(board: &KanbanBoard) -> KanbanBoard {
        let mut normalized = board.clone();
        normalized.generation_meta = None;
        normalized
    }

    fn resolved_hash(board: &KanbanBoard) -> String {
        let board = Self::board_without_generation_meta(board);
        let serialized =
            serde_json::to_string(&board).unwrap_or_else(|_| parser::generate_markdown(&board));
        Self::content_hash(&serialized)
    }

    fn dependency_hash(board: &KanbanBoard) -> Option<String> {
        let mut fingerprint_parts = Vec::new();
        for column in board.all_columns() {
            let Some(include_source) = column.include_source.as_ref() else {
                continue;
            };
            fingerprint_parts.push(include_source.raw_path.clone());
            fingerprint_parts.push(slide_parser::generate_slides(&column.cards));
        }
        if fingerprint_parts.is_empty() {
            None
        } else {
            Some(Self::content_hash(
                &fingerprint_parts.join("\n--lexera-include--\n"),
            ))
        }
    }

    fn current_generation(&self, board_id: &str) -> u64 {
        self.boards
            .read()
            .ok()
            .and_then(|b| b.get(board_id).map(|s| s.generation))
            .unwrap_or(0)
    }

    fn next_generation_meta(&self, board_id: &str, board: &KanbanBoard) -> GenerationMeta {
        let next_generation = self.current_generation(board_id) + 1;
        let preview_markdown = parser::generate_markdown(board);
        GenerationMeta {
            generation: Some(next_generation),
            content_hash: Some(parser::body_hash(&preview_markdown)),
            dependency_hash: Self::dependency_hash(board),
            resolved_hash: Some(Self::resolved_hash(board)),
            writer_id: Some(self.writer_id.clone()),
        }
    }

    fn commit_board_state(
        &self,
        board_id: &str,
        file_path: &Path,
        mut board_to_write: KanbanBoard,
        mut crdt: Option<CrdtStore>,
        create_backup: bool,
    ) -> Result<(), StorageError> {
        // Compute generation meta before write but DON'T commit to in-memory
        // state until after the disk write succeeds.  This prevents the
        // generation counter from advancing on failed writes.
        let next_gen_meta = self.next_generation_meta(board_id, &board_to_write);
        board_to_write.generation_meta = Some(next_gen_meta);

        if let Some(ref mut c) = crdt {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                c.set_metadata(
                    board_to_write.yaml_header.clone(),
                    board_to_write.kanban_footer.clone(),
                    board_to_write.board_settings.clone(),
                    board_to_write.generation_meta.clone(),
                );
            }));
            if let Err(panic_payload) = result {
                log::error!(
                    "[lexera.crdt] Loro panicked during set_metadata for board {}: {}",
                    board_id,
                    panic_payload_to_string(panic_payload.as_ref())
                );
                // Drop the corrupted CRDT — it will be rebuilt from markdown
                // on next reload rather than persisting unknown state.
                crdt = None;
            }
        }

        if create_backup && file_path.exists() {
            let backup_mgr = super::backup::BackupManager::new();
            if let Err(e) = backup_mgr.create_backup(file_path) {
                log::warn!(
                    "[lexera.storage.backup] Failed to create backup for board {}: {}",
                    board_id,
                    e
                );
            }
        }

        // Disk write: includes first, main board last (see persist_board_files).
        // If this fails, generation counter was NOT yet committed to in-memory
        // state, so staleness checks remain valid.
        let markdown = self.persist_board_files(board_id, file_path, &board_to_write)?;

        if create_backup && file_path.exists() {
            let backup_mgr = super::backup::BackupManager::new();
            if let Err(e) = backup_mgr.rotate_backups(file_path) {
                log::warn!(
                    "[lexera.storage.backup] Failed to rotate backups for board {}: {}",
                    board_id,
                    e
                );
            }
        }

        // CRDT save: best-effort after successful disk write.
        // If it fails, the CRDT will be rebuilt from markdown on next reload.
        if let Some(ref c) = crdt {
            let crdt_path = file_path.with_extension("md.crdt");
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                c.save_to_file(&crdt_path)
            }));
            match result {
                Ok(Err(e)) => {
                    log::error!(
                        "[lexera.crdt] Failed to save CRDT file for board {}: {}",
                        board_id,
                        e
                    );
                }
                Err(panic_payload) => {
                    log::error!(
                        "[lexera.crdt] Loro panicked during save_to_file for board {}: {}",
                        board_id,
                        panic_payload_to_string(panic_payload.as_ref())
                    );
                }
                Ok(Ok(())) => {}
            }
        }

        // NOW commit to in-memory state — only after disk write succeeded.
        let metadata = fs::metadata(file_path)?;
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());
        let generation = board_to_write
            .generation_meta
            .as_ref()
            .and_then(|m| m.generation)
            .unwrap_or(0);

        let state = BoardState {
            file_path: file_path.to_path_buf(),
            board: board_to_write,
            last_modified,
            content_hash: Self::content_hash(&markdown),
            version: self.next_version(),
            generation,
            crdt,
        };

        self.boards
            .write()
            .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?
            .insert(board_id.to_string(), state);

        Ok(())
    }

    fn commit_remote_board_state(
        &self,
        board_id: &str,
        board: KanbanBoard,
        crdt: Option<CrdtStore>,
    ) -> Result<(), StorageError> {
        let existing_path = self
            .boards
            .read()
            .map_err(|e| StorageError::LockPoisoned(format!("boards read: {}", e)))?
            .get(board_id)
            .map(|state| state.file_path.clone())
            .unwrap_or_else(|| Self::remote_virtual_board_path(board_id));

        let markdown = parser::generate_markdown(&board);
        let generation = board
            .generation_meta
            .as_ref()
            .and_then(|m| m.generation)
            .unwrap_or(0);

        let state = BoardState {
            file_path: existing_path,
            board,
            last_modified: SystemTime::now(),
            content_hash: Self::content_hash(&markdown),
            version: self.next_version(),
            generation,
            crdt,
        };

        self.boards
            .write()
            .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?
            .insert(board_id.to_string(), state);

        Ok(())
    }

    pub fn create_crashsave(
        &self,
        board_id: &str,
        board: &KanbanBoard,
        reason: &str,
    ) -> Result<super::backup::CrashsaveEntry, StorageError> {
        let file_path = if self.is_remote_board(board_id) {
            // Remote mirrors still need crashsave guarantees; persist into a
            // stable local shadow directory using a safe synthetic filename.
            Self::remote_virtual_board_path(board_id)
        } else {
            self.get_board_path(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?
        };
        self.write_crashsave_for_file(&file_path, board, reason)
    }

    fn write_remote_board_internal(
        &self,
        board_id: &str,
        board: &KanbanBoard,
    ) -> Result<Option<card_merge::MergeResult>, StorageError> {
        let lock = self.get_write_lock(board_id)?;
        let _guard =
            Self::acquire_board_write_guard(board_id, lock.as_ref(), "write_remote_board_internal");

        let incoming_board = Self::ensure_board_card_kids(board);
        let (mut current_board, mut crdt) = {
            let mut boards = self
                .boards
                .write()
                .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?;
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            let current = Self::ensure_board_card_kids(&state.board);
            let crdt = state
                .crdt
                .take()
                .or_else(|| CrdtStore::from_board(&current).ok())
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            (current, crdt)
        };

        let merged_result: Result<(KanbanBoard, CrdtStore), StorageError> = (|| {
            if Self::board_has_missing_kids(&current_board) {
                current_board = Self::ensure_board_card_kids(&current_board);
                crdt = CrdtStore::from_board(&current_board)?;
            }
            log::info!(
                "[lexera.storage.remote.write] board={} current={} incoming={}",
                board_id,
                board_card_summary(&current_board),
                board_card_summary(&incoming_board)
            );
            crdt.apply_board(&incoming_board, &current_board)?;
            let mut merged = crdt.to_board_result()?;
            Self::restore_include_sources(&mut merged, &current_board);
            Self::restore_include_sources(&mut merged, &incoming_board);

            if has_structural_mismatch(&merged, &incoming_board) {
                log::info!(
                    "[lexera.storage.remote.write] board={} structural mismatch after CRDT apply, rebuilding from incoming",
                    board_id
                );
                Ok((
                    incoming_board.clone(),
                    CrdtStore::from_board(&incoming_board)?,
                ))
            } else {
                Ok((merged, crdt))
            }
        })();

        let (board_to_write, crdt_to_write) = match merged_result {
            Ok(result) => result,
            Err(err) => {
                log::error!(
                    "[lexera.storage.remote.write] CRDT apply failed for board {}: {} (current={} incoming={})",
                    board_id,
                    err,
                    board_card_summary(&current_board),
                    board_card_summary(&incoming_board)
                );
                let replacement_crdt = CrdtStore::from_board(&current_board).ok();
                if let Ok(mut boards) = self.boards.write() {
                    if let Some(state) = boards.get_mut(board_id) {
                        state.crdt = replacement_crdt;
                    }
                }
                return Err(err);
            }
        };

        log::info!(
            "[lexera.storage.remote.write] board={} final={}",
            board_id,
            board_card_summary(&board_to_write)
        );
        self.commit_remote_board_state(board_id, board_to_write, Some(crdt_to_write))?;
        Ok(None)
    }

    fn write_board_internal(
        &self,
        board_id: &str,
        board: &KanbanBoard,
        base_board: Option<&KanbanBoard>,
    ) -> Result<super::WriteResult, StorageError> {
        if self.is_remote_board(board_id) {
            let merge_result = self.write_remote_board_internal(board_id, board)?;
            return Ok(super::WriteResult {
                merge_result,
                redirected_path: None,
            });
        }
        let lock = self.get_write_lock(board_id)?;
        let _guard =
            Self::acquire_board_write_guard(board_id, lock.as_ref(), "write_board_internal");

        let file_path = self
            .get_board_path(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let normalized_board = Self::normalize_board_for_write(board, &board_dir);
        let normalized_base =
            base_board.map(|base| Self::normalize_board_for_write(base, &board_dir));

        // Read current disk content to check for conflicts
        let stored_hash = self.get_board_content_hash(board_id).unwrap_or_default();
        let disk_content = fs::read_to_string(&file_path)?;
        let disk_hash = Self::content_hash(&disk_content);
        let disk_diverged = disk_hash != stored_hash && !stored_hash.is_empty();

        let (stored_board, crdt_board, has_crdt) = {
            let boards = self
                .boards
                .read()
                .map_err(|e| StorageError::LockPoisoned(format!("boards read: {}", e)))?;
            let state = boards
                .get(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            (
                state.board.clone(),
                state.crdt.as_ref().and_then(|c| match c.to_board_result() {
                    Ok(board) => Some(board),
                    Err(error) => {
                        log::warn!(
                            "[lexera.storage.write] Failed to materialize CRDT board for {}: {}",
                            board_id,
                            error
                        );
                        None
                    }
                }),
                state.crdt.is_some(),
            )
        };

        log::info!(
            "[lexera.storage.write] board={} has_crdt={} has_base={} disk_diverged={} incoming={}",
            board_id,
            has_crdt,
            normalized_base.is_some(),
            disk_diverged,
            board_card_summary(&normalized_board)
        );

        let current = if disk_diverged {
            Self::normalize_board_for_write(
                &self.parse_with_includes(&disk_content, board_id, &board_dir, &file_path)?,
                &board_dir,
            )
        } else if let Some(crdt_board) = crdt_board {
            Self::normalize_board_for_write(&crdt_board, &board_dir)
        } else {
            Self::normalize_board_for_write(&stored_board, &board_dir)
        };

        let merge_base = normalized_base.clone().or_else(|| {
            if disk_diverged {
                Some(Self::normalize_board_for_write(&stored_board, &board_dir))
            } else {
                None
            }
        });

        let (board_to_write, crdt_to_write, merge_result) = if let Some(base) = merge_base {
            log::info!(
                "[lexera.storage.write] board={} path=CRDT_BASE_REBASE base={} current={}",
                board_id,
                board_card_summary(&base),
                board_card_summary(&current)
            );

            let conflicts = Self::detect_card_conflicts(&base, &current, &normalized_board);
            if !conflicts.is_empty() {
                let crashsave = match self.write_crashsave_for_file(
                    &file_path,
                    &normalized_board,
                    "save-conflict",
                ) {
                    Ok(entry) => Some(entry),
                    Err(error) => {
                        log::error!(
                            target: "lexera.storage.crashsave",
                            "Failed to create crashsave for conflicted save on board {}: {}",
                            board_id,
                            error
                        );
                        None
                    }
                };
                log::warn!(
                    "[lexera.storage.merge] {} conflicts during CRDT save on board {}",
                    conflicts.len(),
                    board_id
                );
                return Err(StorageError::ConflictDetected {
                    board_id: board_id.to_string(),
                    conflicts: conflicts.len(),
                    merge_result: Box::new(card_merge::MergeResult {
                        board: normalized_board.clone(),
                        conflicts,
                        auto_merged: 0,
                    }),
                    crashsave,
                });
            }

            let (board_to_write, crdt) =
                Self::merge_boards_with_crdt(&base, &current, &normalized_board, &board_dir)?;
            log::info!(
                "[lexera.storage.write] board={} crdt_merged_output={}",
                board_id,
                board_card_summary(&board_to_write)
            );
            (board_to_write, Some(crdt), None)
        } else if has_crdt {
            let mut crdt = {
                let mut boards = self
                    .boards
                    .write()
                    .map_err(|e| StorageError::LockPoisoned(format!("boards write: {}", e)))?;
                boards
                    .get_mut(board_id)
                    .and_then(|s| s.crdt.take())
                    .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?
            };
            let mut current = current.clone();

            let direct_result: Result<(KanbanBoard, CrdtStore), StorageError> = (|| {
                if Self::board_has_missing_kids(&current) {
                    log::info!(
                        "[lexera.storage.crdt] Missing card identity on board {}, rebuilding CRDT",
                        board_id
                    );
                    current = Self::ensure_board_card_kids(&current);
                    crdt = crate::crdt::bridge::CrdtStore::from_board(&current)?;
                }

                log::info!(
                    "[lexera.storage.write] board={} path=CRDT_DIRECT current={}",
                    board_id,
                    board_card_summary(&current)
                );

                crdt.apply_board(&normalized_board, &current)?;
                let mut merged =
                    Self::normalize_board_for_write(&crdt.to_board_result()?, &board_dir);
                Self::restore_include_sources(&mut merged, &current);
                Self::restore_include_sources(&mut merged, &normalized_board);

                log::info!(
                    "[lexera.storage.write] board={} crdt_output={}",
                    board_id,
                    board_card_summary(&merged)
                );

                if has_structural_mismatch(&merged, &normalized_board) {
                    log::info!(
                        "[lexera.storage.crdt] Structural mismatch after CRDT merge on board {}, rebuilding CRDT",
                        board_id
                    );
                    Ok((
                        normalized_board.clone(),
                        crate::crdt::bridge::CrdtStore::from_board(&normalized_board)?,
                    ))
                } else {
                    Ok((merged, crdt))
                }
            })();

            match direct_result {
                Ok((board_to_write, crdt)) => (board_to_write, Some(crdt), None),
                Err(err) => {
                    log::error!(
                        "[lexera.storage.write] CRDT direct apply failed for board {}: {}",
                        board_id,
                        err
                    );
                    let replacement_crdt =
                        crate::crdt::bridge::CrdtStore::from_board(&current).ok();
                    if let Ok(mut boards) = self.boards.write() {
                        if let Some(state) = boards.get_mut(board_id) {
                            state.crdt = replacement_crdt;
                        }
                    }
                    return Err(err);
                }
            }
        } else {
            // No conflict — direct write
            (normalized_board.clone(), None, None)
        };

        log::info!(
            "[lexera.storage.write] board={} FINAL_WRITE={}",
            board_id,
            board_card_summary(&board_to_write)
        );

        // Legacy-format boards: redirect writes to a new file so the original
        // is never overwritten.  The check on has_explicit_hierarchy() allows
        // boards that the user promoted to new format (added rows/stacks) to
        // write back to the original path.  Subsequent saves already target the
        // `-lexera2.md` path.
        let file_path_str = file_path.to_string_lossy();
        let is_legacy_redirect = board_to_write.format_hint == crate::types::BoardFormat::Legacy
            && !board_to_write.has_explicit_hierarchy()
            && !file_path_str.contains("-lexera2");
        let (actual_path, redirected_path) = if is_legacy_redirect {
            let stem = file_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let new_name = format!("{}-lexera2.md", stem);
            let new_path = file_path.with_file_name(&new_name);
            log::info!(
                "[lexera.storage.legacy_redirect] Board {} redirected from {:?} to {:?}",
                board_id,
                file_path,
                new_path
            );
            (new_path.clone(), Some(new_path))
        } else {
            (file_path.clone(), None)
        };

        self.commit_board_state(board_id, &actual_path, board_to_write, crdt_to_write, true)?;

        Ok(super::WriteResult {
            merge_result,
            redirected_path,
        })
    }

    pub fn write_board_from_base(
        &self,
        board_id: &str,
        base_board: &KanbanBoard,
        board: &KanbanBoard,
    ) -> Result<super::WriteResult, StorageError> {
        self.write_board_internal(board_id, board, Some(base_board))
    }

    pub fn rebase_board_from_base(
        &self,
        board_id: &str,
        base_board: &KanbanBoard,
        board: &KanbanBoard,
    ) -> Result<(KanbanBoard, KanbanBoard, Option<card_merge::MergeResult>), StorageError> {
        if self.is_remote_board(board_id) {
            let _ = base_board;
            let lock = self.get_write_lock(board_id)?;
            let _guard = Self::acquire_board_write_guard(
                board_id,
                lock.as_ref(),
                "rebase_board_from_base(remote)",
            );
            let current = self
                .boards
                .read()
                .map_err(|e| StorageError::LockPoisoned(format!("boards read: {}", e)))?
                .get(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?
                .board
                .clone();
            let current = Self::ensure_board_card_kids(&current);
            let incoming = Self::ensure_board_card_kids(board);
            let mut crdt = CrdtStore::from_board(&current)?;
            crdt.apply_board(&incoming, &current)?;
            let mut merged = crdt.to_board_result()?;
            Self::restore_include_sources(&mut merged, &current);
            Self::restore_include_sources(&mut merged, &incoming);
            if has_structural_mismatch(&merged, &incoming) {
                return Ok((current, incoming, None));
            }
            return Ok((current, merged, None));
        }
        let lock = self.get_write_lock(board_id)?;
        let _guard =
            Self::acquire_board_write_guard(board_id, lock.as_ref(), "rebase_board_from_base");

        let file_path = self
            .get_board_path(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let normalized_board = Self::normalize_board_for_write(board, &board_dir);
        let normalized_base = Self::normalize_board_for_write(base_board, &board_dir);
        let stored_hash = self.get_board_content_hash(board_id).unwrap_or_default();
        let disk_content = fs::read_to_string(&file_path)?;
        let disk_hash = Self::content_hash(&disk_content);
        let disk_diverged = disk_hash != stored_hash && !stored_hash.is_empty();
        let current = {
            let boards = self
                .boards
                .read()
                .map_err(|e| StorageError::LockPoisoned(format!("boards read: {}", e)))?;
            let state = boards
                .get(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            match (disk_diverged, state.crdt.as_ref()) {
                (false, Some(crdt)) => {
                    Self::normalize_board_for_write(
                        &crdt
                            .to_board_result()
                            .unwrap_or_else(|error| {
                                log::warn!(
                                    "[lexera.storage.rebase] Failed to materialize CRDT board for {}: {}. Falling back to in-memory board state.",
                                    board_id,
                                    error
                                );
                                state.board.clone()
                            }),
                        &board_dir,
                    )
                }
                _ => {
                    drop(boards);
                    Self::normalize_board_for_write(
                        &self.parse_with_includes(&disk_content, board_id, &board_dir, &file_path)?,
                        &board_dir,
                    )
                }
            }
        };

        let conflicts = Self::detect_card_conflicts(&normalized_base, &current, &normalized_board);
        if !conflicts.is_empty() {
            let merge_result = card_merge::MergeResult {
                board: normalized_board.clone(),
                conflicts,
                auto_merged: 0,
            };
            return Ok((
                current,
                normalized_board.clone(),
                Self::finalize_merge_result(merge_result, normalized_board),
            ));
        }

        let (merged_board, _) = Self::merge_boards_with_crdt(
            &normalized_base,
            &current,
            &normalized_board,
            &board_dir,
        )?;
        Ok((current, merged_board, None))
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

    fn sanitize_filename_component(value: &str) -> String {
        let mut out = String::with_capacity(value.len());
        for ch in value.chars() {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                out.push(ch);
            } else {
                out.push('_');
            }
        }
        if out.is_empty() {
            "remote-board".to_string()
        } else {
            out
        }
    }

    fn remote_virtual_board_path(board_id: &str) -> PathBuf {
        let safe = Self::sanitize_filename_component(board_id);
        PathBuf::from(".lexera-remote").join(format!("{}.md", safe))
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
        let mut board = Self::normalize_board_for_write(
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
                        board.generation_meta.clone(),
                    );
                    match Self::align_loaded_board_with_crdt(&board_id, &board, c, &board_dir) {
                        Ok((canonical_board, c)) => {
                            board = canonical_board;
                            Some(c)
                        }
                        Err(e) => {
                            log::error!("[lexera.crdt] Failed to align loaded CRDT: {}", e);
                            None
                        }
                    }
                }
                Err(e) => {
                    log::warn!("[lexera.crdt] Failed to load .crdt file: {}", e);
                    match CrdtStore::from_board(&board) {
                        Ok(c) => {
                            if let Err(error) = c.save_to_file(&crdt_path) {
                                log::warn!(
                                    "[lexera.crdt] Failed to persist rebuilt .crdt file {:?}: {}",
                                    crdt_path,
                                    error
                                );
                            }
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
                    if let Err(error) = c.save_to_file(&crdt_path) {
                        log::warn!(
                            "[lexera.crdt] Failed to persist new .crdt file {:?}: {}",
                            crdt_path,
                            error
                        );
                    }
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
        // Acquire the per-board write lock to prevent races with write_board_internal
        let lock = self.get_write_lock(board_id)?;
        let _guard = Self::acquire_board_write_guard(board_id, lock.as_ref(), "reload_board");

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

        // Helper to restore the CRDT back into the board state.
        // Called on early-return / error paths so the CRDT is never lost.
        let restore_crdt = |crdt: Option<CrdtStore>, boards: &RwLock<HashMap<String, BoardState>>, id: &str| {
            if let Some(crdt) = crdt {
                if let Ok(mut boards) = boards.write() {
                    if let Some(state) = boards.get_mut(id) {
                        state.crdt = Some(crdt);
                    }
                }
            }
        };

        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                restore_crdt(old_crdt, &self.boards, board_id);
                return Err(e.into());
            }
        };
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let parsed = match self.parse_with_includes(&content, board_id, &board_dir, &file_path) {
            Ok(b) => b,
            Err(e) => {
                restore_crdt(old_crdt, &self.boards, board_id);
                return Err(e);
            }
        };
        let mut board = Self::normalize_board_for_write(&parsed, &board_dir);

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
            restore_crdt(old_crdt, &self.boards, board_id);
            return Ok(());
        }
        if new_gen == current_gen && new_gen > 0 {
            let new_body_hash = parser::body_hash(&content);
            let new_dependency_hash = Self::dependency_hash(&board);
            let new_resolved_hash = Self::resolved_hash(&board);
            let existing_revision = self
                .boards
                .read()
                .ok()
                .and_then(|b| b.get(board_id)?.board.generation_meta.as_ref().cloned());
            let existing_body_hash = existing_revision
                .as_ref()
                .and_then(|m| m.content_hash.clone());
            let existing_dependency_hash = existing_revision
                .as_ref()
                .and_then(|m| m.dependency_hash.clone());
            let existing_resolved_hash = existing_revision
                .as_ref()
                .and_then(|m| m.resolved_hash.clone());
            if existing_body_hash.as_deref() == Some(&new_body_hash)
                && existing_dependency_hash == new_dependency_hash
                && existing_resolved_hash.as_deref() == Some(&new_resolved_hash)
            {
                // Same generation, same content — no real change
                restore_crdt(old_crdt, &self.boards, board_id);
                return Ok(());
            }
            log::warn!(
                "[lexera.storage.reload] Same generation ({}) but different content for board {}, accepting external edit",
                new_gen,
                board_id
            );
        }

        let metadata = match fs::metadata(&file_path) {
            Ok(m) => m,
            Err(e) => {
                restore_crdt(old_crdt, &self.boards, board_id);
                return Err(e.into());
            }
        };
        let last_modified = metadata.modified().unwrap_or_else(|_| SystemTime::now());

        // Update CRDT with changes from disk
        let crdt_path = file_path.with_extension("md.crdt");
        let crdt = if let Some(mut c) = old_crdt {
            c.set_metadata(
                board.yaml_header.clone(),
                board.kanban_footer.clone(),
                board.board_settings.clone(),
                board.generation_meta.clone(),
            );
            match Self::align_loaded_board_with_crdt(board_id, &board, c, &board_dir) {
                Ok((canonical_board, c)) => {
                    board = canonical_board;
                    if let Err(error) = c.save_to_file(&crdt_path) {
                        log::warn!(
                            "[lexera.crdt] Failed to persist aligned .crdt file {:?}: {}",
                            crdt_path,
                            error
                        );
                    }
                    Some(c)
                }
                Err(e) => {
                    log::error!("[lexera.crdt] Failed to align board reload CRDT: {}", e);
                    None
                }
            }
        } else {
            match CrdtStore::from_board(&board) {
                Ok(c) => {
                    if let Err(error) = c.save_to_file(&crdt_path) {
                        log::warn!(
                            "[lexera.crdt] Failed to persist rebuilt .crdt file {:?}: {}",
                            crdt_path,
                            error
                        );
                    }
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
        let normalized_board = Self::ensure_board_card_kids(&board);
        let content_hash = Self::content_hash(&parser::generate_markdown(&normalized_board));
        let generation = normalized_board
            .generation_meta
            .as_ref()
            .and_then(|m| m.generation)
            .unwrap_or(0);
        let version = self.next_version();
        let state = BoardState {
            file_path: Self::remote_virtual_board_path(board_id),
            board: normalized_board.clone(),
            last_modified: SystemTime::now(),
            content_hash,
            version,
            generation,
            crdt: CrdtStore::from_board(&normalized_board).ok(),
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

    /// Get the authoritative backend-computed revision token for a board.
    ///
    /// This token is derived from the effective loaded board state after parse
    /// and include resolution. It intentionally does not trust revision
    /// metadata embedded in the editable markdown file.
    pub fn get_board_revision_token(&self, board_id: &str) -> Option<String> {
        self.boards
            .read()
            .ok()?
            .get(board_id)
            .map(|state| format!("r-{}", Self::resolved_hash(&state.board)))
    }

    /// Get the persisted generation counter for a board (for staleness detection).
    pub fn get_board_generation(&self, board_id: &str) -> Option<u64> {
        self.boards.read().ok()?.get(board_id).map(|s| s.generation)
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
        self.parse_with_includes_inner(content, board_id, board_dir, &visited)
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
                        log::error!(
                            "[lexera.storage.include] Failed to read include file {:?} for board {}: {} — column will appear empty",
                            resolved,
                            board_id,
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
        } else if let Ok(mut map) = self.include_map.write() {
            map.remove_board(board_id);
        } else {
            log::error!(
                "[lexera.storage.include] Include map lock poisoned during sync remove"
            );
        }
    }

    fn write_include_column(&self, column: &KanbanColumn) -> Result<(), StorageError> {
        let include_source = column.include_source.as_ref().ok_or_else(|| {
            StorageError::InvalidBoard("Column is not an include column".to_string())
        })?;

        let resolved_path = include_source.resolved_path.clone();
        let slide_content = slide_parser::generate_slides(&column.cards);

        Self::atomic_write(&resolved_path, &slide_content)?;

        // Register self-write fingerprint AFTER successful write so that a
        // failed write doesn't suppress legitimate external file-watcher events.
        match self.self_write_tracker.lock() {
            Ok(mut tracker) => tracker.register(&resolved_path, &slide_content),
            Err(e) => log::error!(
                "[lexera.storage.write] Self-write tracker lock poisoned: {}",
                e
            ),
        }

        Ok(())
    }

    fn persist_board_files(
        &self,
        board_id: &str,
        file_path: &Path,
        board: &KanbanBoard,
    ) -> Result<String, StorageError> {
        let markdown = parser::generate_markdown(board);

        // Write include files FIRST so that if any include write fails,
        // the main board file is still consistent with the previous state.
        for column in board.all_columns() {
            if column.include_source.is_some() {
                self.write_include_column(column)?;
            }
        }

        // Write main board file last — only after all includes succeeded.
        Self::atomic_write(file_path, &markdown)?;

        // Register self-write fingerprint AFTER successful write so that a
        // failed write doesn't suppress legitimate external file-watcher events.
        match self.self_write_tracker.lock() {
            Ok(mut tracker) => tracker.register(file_path, &markdown),
            Err(e) => log::error!(
                "[lexera.storage.write] Self-write tracker lock poisoned: {}",
                e
            ),
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
        let mut locks = match self.write_locks.lock() {
            Ok(locks) => locks,
            Err(poisoned) => {
                log::error!(
                    "[lexera.storage.lock] Recovered from poisoned global write_locks mutex while getting board {} lock",
                    board_id
                );
                poisoned.into_inner()
            }
        };
        Ok(locks
            .entry(board_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    fn acquire_board_write_guard<'a>(
        board_id: &str,
        lock: &'a Mutex<()>,
        context: &str,
    ) -> std::sync::MutexGuard<'a, ()> {
        match lock.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                log::error!(
                    "[lexera.storage.lock] Recovered from poisoned write lock for board {} during {}. A prior task panicked while holding this lock.",
                    board_id,
                    context
                );
                poisoned.into_inner()
            }
        }
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
        if let Err(e) = file.write_all(content.as_bytes()).and_then(|_| file.sync_all()) {
            let _ = fs::remove_file(&tmp_path);
            return Err(e);
        }
        if let Err(e) = fs::rename(&tmp_path, path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(e);
        }

        // fsync directory for rename durability
        if let Some(dir) = path.parent() {
            match fs::File::open(dir) {
                Ok(d) => {
                    if let Err(error) = d.sync_all() {
                        log::warn!(
                            "[lexera.storage.atomic_write] Failed to fsync directory {:?}: {}",
                            dir,
                            error
                        );
                    }
                }
                Err(error) => {
                    log::warn!(
                        "[lexera.storage.atomic_write] Failed to open directory {:?} for fsync: {}",
                        dir,
                        error
                    );
                }
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
        let _guard = Self::acquire_board_write_guard(board_id, lock.as_ref(), "get_crdt_vv");
        let mut boards = self.boards.write().ok()?;
        let state = boards.get_mut(board_id)?;

        let read_vv = |crdt: &CrdtStore| {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| crdt.oplog_vv().encode()))
        };

        if state.crdt.is_none() {
            state.crdt = CrdtStore::from_board(&state.board).ok();
            if state.crdt.is_none() {
                log::error!(
                    "[lexera.storage.crdt] Missing CRDT for board {} and failed to rebuild while reading VV",
                    board_id
                );
                return None;
            }
            log::warn!(
                "[lexera.storage.crdt] Rebuilt missing CRDT for board {} while reading VV",
                board_id
            );
        }

        if let Some(crdt) = state.crdt.as_ref() {
            match read_vv(crdt) {
                Ok(vv) => return Some(vv),
                Err(payload) => {
                    log::error!(
                        "[lexera.storage.crdt] Loro panicked during oplog_vv for board {}: {}",
                        board_id,
                        panic_payload_to_string(payload.as_ref())
                    );
                }
            }
        }

        match CrdtStore::from_board(&state.board) {
            Ok(rebuilt) => {
                state.crdt = Some(rebuilt);
                log::warn!(
                    "[lexera.storage.crdt] Rebuilt CRDT after oplog_vv panic for board {}",
                    board_id
                );
            }
            Err(error) => {
                log::error!(
                    "[lexera.storage.crdt] Failed to rebuild CRDT after oplog_vv panic for board {}: {}",
                    board_id,
                    error
                );
                state.crdt = None;
                return None;
            }
        }

        if let Some(crdt) = state.crdt.as_ref() {
            match read_vv(crdt) {
                Ok(vv) => Some(vv),
                Err(payload) => {
                    log::error!(
                        "[lexera.storage.crdt] Loro panicked again during oplog_vv after rebuild for board {}: {}",
                        board_id,
                        panic_payload_to_string(payload.as_ref())
                    );
                    None
                }
            }
        } else {
            None
        }
    }

    /// Export CRDT updates since a given version vector (for sync delta).
    /// `vv_bytes` is the encoded VersionVector from the remote peer.
    /// An empty `vv_bytes` slice is treated as an empty VersionVector (export all).
    /// Acquires the per-board write lock to avoid reading while CRDT is taken out.
    pub fn export_crdt_updates_since(&self, board_id: &str, vv_bytes: &[u8]) -> Option<Vec<u8>> {
        let lock = self.get_write_lock(board_id).ok()?;
        let _guard =
            Self::acquire_board_write_guard(board_id, lock.as_ref(), "export_crdt_updates_since");
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
        let _guard =
            Self::acquire_board_write_guard(board_id, lock.as_ref(), "export_crdt_snapshot");
        let boards = self.boards.read().ok()?;
        let state = boards.get(board_id)?;
        let crdt = state.crdt.as_ref()?;
        crdt.save().ok()
    }

    /// Import remote CRDT updates, rebuild the board from CRDT, and persist.
    pub fn import_crdt_updates(&self, board_id: &str, bytes: &[u8]) -> Result<(), StorageError> {
        let lock = self.get_write_lock(board_id)?;
        let _guard =
            Self::acquire_board_write_guard(board_id, lock.as_ref(), "import_crdt_updates");
        let is_remote = self.is_remote_board(board_id);
        let file_path = if is_remote {
            None
        } else {
            Some(
                self.get_board_path(board_id)
                    .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?,
            )
        };

        // Take CRDT and current board from state for mutation
        let (mut crdt, current_board) = {
            let mut boards = self.boards.write().map_err(|e| {
                StorageError::LockPoisoned(format!("boards write in import_crdt (take): {}", e))
            })?;
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            let current_board = state.board.clone();
            (
                state
                    .crdt
                    .take()
                    .or_else(|| CrdtStore::from_board(&current_board).ok())
                    .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?,
                current_board,
            )
        };

        // import_updates is panic-safe in the CRDT bridge, but any failure
        // still means this CRDT instance may be unhealthy (e.g. poisoned
        // internals after panic recovery). Rebuild from the last stable board.
        if let Err(e) = crdt.import_updates(bytes) {
            log::error!(
                "[lexera.crdt] import_updates failed for board {}: {}",
                board_id,
                e
            );
            let replacement_crdt = CrdtStore::from_board(&current_board).ok();
            if let Ok(mut boards) = self.boards.write() {
                if let Some(state) = boards.get_mut(board_id) {
                    state.crdt = replacement_crdt;
                }
            }
            return Err(StorageError::Io(e));
        }

        let board_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| crdt.to_board()));
        let mut board = match board_result {
            Ok(board) => board,
            Err(panic_payload) => {
                let msg = panic_payload_to_string(panic_payload.as_ref());
                log::error!(
                    "[lexera.crdt] Loro panicked during to_board for {}: {}",
                    board_id,
                    msg
                );
                let replacement_crdt = CrdtStore::from_board(&current_board).ok();
                if let Ok(mut boards) = self.boards.write() {
                    if let Some(state) = boards.get_mut(board_id) {
                        state.crdt = replacement_crdt;
                    }
                }
                return Err(StorageError::Io(std::io::Error::other(
                    format!("CRDT to_board panic: {}", msg),
                )));
            }
        };

        Self::restore_include_sources(&mut board, &current_board);

        log::info!(
            "[lexera.storage.import_crdt] board={} bytes={} before={} after={}",
            board_id,
            bytes.len(),
            board_card_summary(&current_board),
            board_card_summary(&board)
        );
        if is_remote {
            self.commit_remote_board_state(board_id, board, Some(crdt))
        } else {
            self.commit_board_state(
                board_id,
                file_path.as_ref().unwrap(),
                board,
                Some(crdt),
                false,
            )?;
            Ok(())
        }
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
                        links: meta.links.clone(),
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
        let boards = self.boards.read().ok()?;
        let state = boards.get(board_id)?;
        let board_dir = state
            .file_path
            .parent()
            .unwrap_or(Path::new("."))
            .to_path_buf();
        if let Some(crdt) = state.crdt.as_ref() {
            if let Some(canonical_board) =
                Self::board_from_crdt_if_semantically_equal(&state.board, crdt, &board_dir)
            {
                log::info!(
                    target: "lexera.storage.read_board",
                    "Returning CRDT-aligned board source=crdt board_id={} state_kids={:?} returned_kids={:?}",
                    board_id,
                    board_kid_sample(&state.board, 6),
                    board_kid_sample(&canonical_board, 6)
                );
                return Some(canonical_board);
            }
        }
        log::warn!(
            target: "lexera.storage.read_board",
            "Returning stored board source=state board_id={} state_kids={:?}",
            board_id,
            board_kid_sample(&state.board, 6)
        );
        Some(state.board.clone())
    }

    fn write_board(
        &self,
        board_id: &str,
        board: &KanbanBoard,
    ) -> Result<super::WriteResult, StorageError> {
        self.write_board_internal(board_id, board, None)
    }

    fn add_card(
        &self,
        board_id: &str,
        col_index: usize,
        content: &str,
    ) -> Result<(), StorageError> {
        let lock = self.get_write_lock(board_id)?;
        let _guard = Self::acquire_board_write_guard(board_id, lock.as_ref(), "add_card");

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
            params: HashMap::new(),
        };

        all_cols[col_index].cards.push(new_card);

        // Update CRDT with the new card (catch Loro panics)
        if let Some(ref mut c) = crdt {
            let result = c
                .to_board_result()
                .and_then(|old_board| c.apply_board(&board, &old_board));
            if let Err(e) = result {
                log::error!(
                    "[lexera.crdt] Failed to apply card addition to CRDT for board {}: {}",
                    board_id,
                    e
                );
            }
        }

        self.commit_board_state(board_id, &file_path, board, crdt, true)?;
        Ok(())
    }

    fn append_to_card(
        &self,
        board_id: &str,
        card_id: &str,
        content: &str,
    ) -> Result<(), StorageError> {
        let lock = self.get_write_lock(board_id)?;
        let _guard = Self::acquire_board_write_guard(board_id, lock.as_ref(), "append_to_card");

        let file_path = self
            .get_board_path(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        let mut crdt = {
            let mut boards = self.boards.write().map_err(|e| {
                StorageError::LockPoisoned(format!(
                    "boards write in append_to_card (take crdt): {}",
                    e
                ))
            })?;
            boards.get_mut(board_id).and_then(|s| s.crdt.take())
        };

        let file_content = fs::read_to_string(&file_path)?;
        let board_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let mut board = Self::normalize_board_for_write(
            &self.parse_with_includes(&file_content, board_id, &board_dir, &file_path)?,
            &board_dir,
        );

        if !board.valid {
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

        // Find and mutate the card
        let mut found = false;
        for col in board.all_columns_mut() {
            for card in col.cards.iter_mut() {
                if card.id == card_id {
                    card.content = format!("{}\n{}", card.content, content);
                    found = true;
                    break;
                }
            }
            if found {
                break;
            }
        }

        if !found {
            if let Some(c) = crdt {
                if let Ok(mut boards) = self.boards.write() {
                    if let Some(state) = boards.get_mut(board_id) {
                        state.crdt = Some(c);
                    }
                }
            }
            return Err(StorageError::CardNotFound(card_id.to_string()));
        }

        // Update CRDT (catch Loro panics)
        if let Some(ref mut c) = crdt {
            let result = c
                .to_board_result()
                .and_then(|old_board| c.apply_board(&board, &old_board));
            if let Err(e) = result {
                log::error!(
                    "[lexera.crdt] Failed to apply card append to CRDT for board {}: {}",
                    board_id,
                    e
                );
            }
        }

        self.commit_board_state(board_id, &file_path, board, crdt, true)?;
        Ok(())
    }

    fn search(&self, query: &str) -> Vec<SearchResult> {
        LocalStorage::search_with_options(self, query, SearchOptions::default())
    }

    fn search_with_options(&self, query: &str, options: SearchOptions) -> Vec<SearchResult> {
        LocalStorage::search_with_options(self, query, options)
    }

    fn calendar_tasks(&self) -> Vec<SearchResult> {
        let boards = match self.boards.read() {
            Ok(b) => b,
            Err(e) => {
                log::error!("[lexera.storage.calendar] Boards lock poisoned: {}", e);
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
                    if meta.due_date.is_none() {
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
                        links: meta.links.clone(),
                        due_date: meta.due_date.map(|d| d.to_string()),
                        is_overdue: meta.is_overdue,
                    });
                }
            }
        }

        results.sort_by(|a, b| {
            a.due_date
                .cmp(&b.due_date)
                .then_with(|| {
                    a.board_title
                        .to_ascii_lowercase()
                        .cmp(&b.board_title.to_ascii_lowercase())
                })
                .then_with(|| a.column_index.cmp(&b.column_index))
        });

        results
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
        let revision = board.generation_meta.as_ref().unwrap();
        assert_eq!(revision.generation, Some(1));
        assert!(revision.content_hash.is_some());
        assert!(revision.resolved_hash.is_some());
        assert!(board.revision_token().is_some());
    }

    #[test]
    fn test_import_crdt_updates_bumps_generation_and_revision() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();
        let base_board = storage.read_board(&id).unwrap();
        let snapshot = storage.export_crdt_snapshot(&id).unwrap();
        let mut remote_store = CrdtStore::load(&snapshot).unwrap();
        remote_store.set_peer_id(99).unwrap();

        let mut remote_board = base_board.clone();
        remote_board.all_columns_mut()[0].cards.push(KanbanCard {
            id: "remote-crdt-card".to_string(),
            content: "Remote CRDT addition".to_string(),
            checked: false,
            kid: Some("remote-crdt-add".to_string()),
            params: HashMap::new(),
        });
        remote_store
            .apply_board(&remote_board, &base_board)
            .unwrap();

        let updates = remote_store
            .export_updates_since(&loro::VersionVector::default())
            .unwrap();
        storage.import_crdt_updates(&id, &updates).unwrap();

        let updated = storage.read_board(&id).unwrap();
        let revision = updated.generation_meta.as_ref().unwrap();
        assert_eq!(revision.generation, Some(1));
        assert!(revision.content_hash.is_some());
        assert!(revision.resolved_hash.is_some());
        assert!(updated
            .all_columns()
            .iter()
            .flat_map(|column| column.cards.iter())
            .any(|card| card.content == "Remote CRDT addition"));
    }

    #[test]
    fn test_import_crdt_updates_remote_board_updates_in_memory_without_local_file_writes() {
        let storage = LocalStorage::new();
        let base_board = parser::parse_markdown(TEST_BOARD);
        let remote_id = "remote-sync-board";
        storage.add_remote_board(remote_id, base_board.clone());

        let snapshot = storage.export_crdt_snapshot(remote_id).unwrap();
        let mut remote_store = CrdtStore::load(&snapshot).unwrap();
        remote_store.set_peer_id(99).unwrap();

        let mut remote_board = base_board.clone();
        remote_board.title = "Shared Remote Board".to_string();
        remote_board.all_columns_mut()[0].cards.push(KanbanCard {
            id: "remote-card".to_string(),
            content: "Remote mirror card".to_string(),
            checked: false,
            kid: Some("remote-card-kid".to_string()),
            params: HashMap::new(),
        });
        remote_store
            .apply_board(&remote_board, &base_board)
            .unwrap();

        let updates = remote_store
            .export_updates_since(&loro::VersionVector::default())
            .unwrap();
        storage.import_crdt_updates(remote_id, &updates).unwrap();

        let updated = storage.read_board(remote_id).unwrap();
        assert_eq!(updated.title, "Shared Remote Board");
        assert!(updated
            .all_columns()
            .iter()
            .flat_map(|column| column.cards.iter())
            .any(|card| card.content == "Remote mirror card"));
    }

    #[test]
    fn test_get_board_revision_token_ignores_inline_metadata_tampering() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        storage.add_card(&id, 0, "Revision anchor").unwrap();
        let revision_before = storage.get_board_revision_token(&id).unwrap();

        {
            let mut boards = storage.boards.write().unwrap();
            let state = boards.get_mut(&id).unwrap();
            state.board.generation_meta = Some(GenerationMeta {
                generation: Some(999),
                content_hash: Some("tampered-content-hash".to_string()),
                dependency_hash: Some("tampered-dependency-hash".to_string()),
                resolved_hash: Some("tampered-resolved-hash".to_string()),
                writer_id: Some("tampered-writer".to_string()),
            });
        }
        let revision_after = storage.get_board_revision_token(&id).unwrap();

        assert_eq!(revision_before, revision_after);
        assert!(revision_after.starts_with("r-"));
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
        let board_path = storage.get_board_path(&id).unwrap();

        let on_disk = fs::read_to_string(&board_path).unwrap();
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
            params: HashMap::new(),
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
        let board_file = storage.get_board_path(&id).unwrap();

        let on_disk_board = fs::read_to_string(&board_file).unwrap();
        assert!(on_disk_board.contains("## Todo !!!include(./slides.md)!!!"));
        assert!(!on_disk_board.contains("- [ ] Task 1"));

        let on_disk_include = fs::read_to_string(&include_path).unwrap();
        assert!(on_disk_include.contains("Task 1"));
    }

    #[test]
    fn test_reload_board_detects_include_file_change_without_generation_change() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        let include_path = dir.path().join("slides.md");

        fs::write(
            &board_path,
            "---\nkanban-plugin: board\ngeneration: 7\ncontentHash: abc123\nresolvedHash: stale\n---\n\n## !!!include(./slides.md)!!!\n",
        )
        .unwrap();
        fs::write(&include_path, "# Slide 1\n\nInitial include content\n").unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        fs::write(&include_path, "# Slide 1\n\nUpdated include content\n").unwrap();
        storage.reload_board(&id).unwrap();

        let reloaded = storage.read_board(&id).unwrap();
        assert!(reloaded.all_columns()[0].cards[0]
            .content
            .contains("Updated include content"));
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
            params: HashMap::new(),
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
    fn test_write_board_from_base_same_titled_columns_do_not_duplicate_moved_cards() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(
            tmp,
            "{}",
            "\
---
kanban-plugin: board
---

# Row 1

## Stack A

### Todo
- [ ] Card 1

## Stack B

### Todo
- [ ] Card 2
"
        )
        .unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        let base = storage.read_board(&id).unwrap();
        let moved_kid = base.rows[0].stacks[0].columns[0].cards[0]
            .kid
            .clone()
            .unwrap();

        let mut ours = base.clone();
        let moved = ours.rows[0].stacks[0].columns[0].cards.remove(0);
        ours.rows[0].stacks[1].columns[0].cards.insert(0, moved);

        storage.write_board_from_base(&id, &base, &ours).unwrap();

        let merged = storage.read_board(&id).unwrap();
        assert_eq!(merged.rows[0].stacks[0].columns[0].cards.len(), 0);

        let target_cards = &merged.rows[0].stacks[1].columns[0].cards;
        assert_eq!(target_cards.len(), 2);
        assert_eq!(target_cards[0].kid.as_deref(), Some(moved_kid.as_str()));

        let moved_instances = merged
            .all_columns()
            .iter()
            .flat_map(|col| col.cards.iter())
            .filter(|card| card.kid.as_deref() == Some(moved_kid.as_str()))
            .count();
        assert_eq!(moved_instances, 1, "moved card must exist exactly once");
    }

    #[test]
    fn test_write_board_from_base_conflicting_same_card_edit_blocks_save() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        let base = storage.read_board(&id).unwrap();

        let mut remote = base.clone();
        remote.all_columns_mut()[0].cards[0].content = "Buy groceries from remote".to_string();
        storage.write_board(&id, &remote).unwrap();

        let mut ours = base.clone();
        ours.all_columns_mut()[0].cards[0].content = "Buy groceries from local".to_string();

        let result = storage.write_board_from_base(&id, &base, &ours);
        match result {
            Err(StorageError::ConflictDetected {
                conflicts,
                crashsave,
                ..
            }) => {
                assert_eq!(conflicts, 1);
                let crashsave = crashsave.expect("conflicted save should write a crashsave");
                assert!(crashsave.path.exists(), "crashsave path should exist");
                assert!(
                    crashsave.filename.contains("-crashsave-"),
                    "crashsave filename should use crashsave format"
                );
            }
            other => panic!("expected conflict with crashsave, got {:?}", other),
        }

        let persisted = storage.read_board(&id).unwrap();
        assert_eq!(
            persisted.all_columns()[0].cards[0].content,
            "Buy groceries from remote"
        );
    }

    #[test]
    fn test_create_crashsave_writes_recovery_file_beside_board() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("project.md");
        fs::write(&board_path, TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();
        let mut board = storage.read_board(&id).unwrap();
        board.all_columns_mut()[0].cards[0].content = "Recovered card content".to_string();

        let crashsave = storage
            .create_crashsave(&id, &board, "manual-test")
            .unwrap();

        assert!(crashsave.path.exists());
        assert!(crashsave.filename.starts_with("project-crashsave-"));
        let content = fs::read_to_string(&crashsave.path).unwrap();
        assert!(
            content.contains("Recovered card content"),
            "crashsave should contain board markdown content"
        );
    }

    #[test]
    fn test_rebase_board_from_base_conflicting_same_card_edit_reports_conflict() {
        let mut tmp = NamedTempFile::new().unwrap();
        write!(tmp, "{}", TEST_BOARD).unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(tmp.path()).unwrap();

        let base = storage.read_board(&id).unwrap();

        let mut remote = base.clone();
        remote.all_columns_mut()[0].cards[0].content = "Buy groceries from remote".to_string();
        storage.write_board(&id, &remote).unwrap();

        let mut ours = base.clone();
        ours.all_columns_mut()[0].cards[0].content = "Buy groceries from local".to_string();

        let (current, rebased, result) = storage.rebase_board_from_base(&id, &base, &ours).unwrap();
        let merge_result = result.expect("expected conflict result");

        assert_eq!(
            current.all_columns()[0].cards[0].content,
            "Buy groceries from remote"
        );
        assert_eq!(
            rebased.all_columns()[0].cards[0].content,
            "Buy groceries from local"
        );
        assert_eq!(merge_result.conflicts.len(), 1);
        assert_eq!(
            merge_result.conflicts[0].field,
            card_merge::ConflictField::Content
        );
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
    fn test_add_board_reuses_matching_crdt_card_identities() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        fs::write(&board_path, TEST_BOARD).unwrap();

        let mut snapshot_board = LocalStorage::normalize_board_for_write(
            &parser::parse_markdown(TEST_BOARD),
            dir.path(),
        );
        let expected_kids = ["a1b2c3d4", "b1c2d3e4", "c1d2e3f4"];
        let mut next = 0usize;
        for column in snapshot_board.all_columns_mut() {
            for card in &mut column.cards {
                card.kid = Some(expected_kids[next].to_string());
                card.id = format!("seed-{}", next);
                next += 1;
            }
        }

        let crdt = CrdtStore::from_board(&snapshot_board).unwrap();
        crdt.save_to_file(&board_path.with_extension("md.crdt"))
            .unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        let loaded = storage.read_board(&id).unwrap();
        let loaded_kids: Vec<String> = loaded
            .all_columns()
            .iter()
            .flat_map(|column| column.cards.iter())
            .map(|card| card.kid.clone().unwrap())
            .collect();
        assert_eq!(
            loaded_kids,
            expected_kids
                .iter()
                .map(|kid| kid.to_string())
                .collect::<Vec<_>>()
        );

        let boards = storage.boards.read().unwrap();
        let state = boards.get(&id).unwrap();
        let state_kids: Vec<String> = state
            .board
            .all_columns()
            .iter()
            .flat_map(|column| column.cards.iter())
            .map(|card| card.kid.clone().unwrap())
            .collect();
        assert_eq!(
            state_kids,
            expected_kids
                .iter()
                .map(|kid| kid.to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_read_board_normalizes_stored_board_before_reusing_matching_snapshot_kids() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        fs::write(&board_path, TEST_BOARD).unwrap();

        let mut snapshot_board = LocalStorage::normalize_board_for_write(
            &parser::parse_markdown(TEST_BOARD),
            dir.path(),
        );
        let expected_kids = ["a1b2c3d4", "b1c2d3e4", "c1d2e3f4"];
        let mut next = 0usize;
        for column in snapshot_board.all_columns_mut() {
            for card in &mut column.cards {
                card.kid = Some(expected_kids[next].to_string());
                card.id = format!("seed-{}", next);
                next += 1;
            }
        }

        let crdt = CrdtStore::from_board(&snapshot_board).unwrap();
        crdt.save_to_file(&board_path.with_extension("md.crdt"))
            .unwrap();

        let storage = LocalStorage::new();
        let id = storage.add_board(&board_path).unwrap();

        {
            let mut boards = storage.boards.write().unwrap();
            let state = boards.get_mut(&id).unwrap();
            let drift_kids = ["dead0001", "dead0002", "dead0003"];
            let mut drift_idx = 0usize;
            for column in state.board.all_columns_mut() {
                for card in &mut column.cards {
                    let drift_kid = drift_kids[drift_idx].to_string();
                    card.content =
                        crate::merge::card_identity::inject_kid(&card.content, &drift_kid);
                    card.kid = Some(drift_kid);
                    drift_idx += 1;
                }
            }
        }

        let loaded = storage.read_board(&id).unwrap();
        let loaded_kids: Vec<String> = loaded
            .all_columns()
            .iter()
            .flat_map(|column| column.cards.iter())
            .map(|card| card.kid.clone().unwrap())
            .collect();
        assert_eq!(
            loaded_kids,
            expected_kids
                .iter()
                .map(|kid| kid.to_string())
                .collect::<Vec<_>>()
        );
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
        let board_file = storage.get_board_path(&id).unwrap();

        // Verify file content on disk matches what we wrote
        let on_disk = fs::read_to_string(&board_file).unwrap();
        assert!(
            on_disk.contains("Modified task"),
            "disk content should contain modified card"
        );
        assert!(
            !on_disk.contains("Buy groceries"),
            "old card content should be replaced"
        );

        // Verify no .tmp files are left behind
        let tmp_path = board_file.with_extension("lexera-sync.tmp");
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
            params: HashMap::new(),
        });
        board.rows[0].stacks.push(KanbanStack {
            id: "stack-empty".to_string(),
            title: "Empty Stack".to_string(),
            columns: vec![KanbanColumn {
                id: "col-in-empty-stack".to_string(),
                title: "Stack Column".to_string(),
                cards: vec![],
                include_source: None,
                params: HashMap::new(),
            }],
            params: HashMap::new(),
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
                    params: HashMap::new(),
                }],
                params: HashMap::new(),
            }],
            params: HashMap::new(),
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
            params: HashMap::new(),
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
                    params: HashMap::new(),
                }],
                params: HashMap::new(),
            }],
            params: HashMap::new(),
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
