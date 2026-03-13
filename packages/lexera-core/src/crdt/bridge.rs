/// CRDT bridge between KanbanBoard and Loro document.
///
/// Converts boards to/from a Loro CRDT representation, applies diffs as
/// minimal CRDT operations, and provides undo/redo and persistence.
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::Path;

use loro::{
    Container, ExportMode, LoroDoc, LoroMap, LoroMovableList, UndoManager, ValueOrContainer,
};

use crate::merge::card_identity;
use crate::merge::diff::{self, CardChange};
use crate::types::*;

/// Convert any Display-able Loro error into an io::Error.
fn loro_err(e: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::Other, e.to_string())
}

fn panic_payload_to_string(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_string()
    }
}

fn crdt_panic_err(op: &str, payload: Box<dyn std::any::Any + Send>) -> io::Error {
    let msg = panic_payload_to_string(payload);
    io::Error::new(
        io::ErrorKind::Other,
        format!("CRDT panic during {}: {}", op, msg),
    )
}

/// CRDT-backed board storage that wraps a Loro document.
///
/// Board metadata (yaml_header, kanban_footer, board_settings) is stored
/// inside the CRDT document in a "metadata" sub-map, enabling collaborative
/// conflict resolution at the field level.
pub struct CrdtStore {
    doc: LoroDoc,
    undo_mgr: UndoManager,
}

impl std::fmt::Debug for CrdtStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let root = self.doc.get_map("root");
        let meta = get_sub_map(&root, "metadata");
        let yaml = meta
            .as_ref()
            .and_then(|m| get_optional_string(m, "yaml_header"));
        let footer = meta.as_ref().and_then(|m| get_optional_string(m, "footer"));
        f.debug_struct("CrdtStore")
            .field("yaml_header", &yaml)
            .field("kanban_footer", &footer)
            .finish_non_exhaustive()
    }
}

// ── Helpers for reading Loro values ──────────────────────────────────────────

fn read_string(voc: &ValueOrContainer) -> Option<String> {
    voc.as_value()
        .and_then(|v| v.as_string())
        .map(|s| s.to_string())
}

fn read_bool(voc: &ValueOrContainer) -> Option<bool> {
    voc.as_value().and_then(|v| v.as_bool()).copied()
}

fn get_string(map: &LoroMap, key: &str) -> String {
    map.get(key)
        .and_then(|v| read_string(&v))
        .unwrap_or_default()
}

fn get_bool(map: &LoroMap, key: &str) -> bool {
    map.get(key).and_then(|v| read_bool(&v)).unwrap_or(false)
}

fn get_movable_list(map: &LoroMap, key: &str) -> Option<LoroMovableList> {
    match map.get(key)? {
        ValueOrContainer::Container(Container::MovableList(ml)) => Some(ml),
        _ => None,
    }
}

fn get_map_at(list: &LoroMovableList, index: usize) -> Option<LoroMap> {
    match list.get(index)? {
        ValueOrContainer::Container(Container::Map(m)) => Some(m),
        _ => None,
    }
}

fn get_sub_map(map: &LoroMap, key: &str) -> Option<LoroMap> {
    match map.get(key)? {
        ValueOrContainer::Container(Container::Map(m)) => Some(m),
        _ => None,
    }
}

fn get_optional_string(map: &LoroMap, key: &str) -> Option<String> {
    map.get(key).and_then(|v| read_string(&v))
}

/// Reorder a LoroMovableList to match the target ID order.
/// Elements not found in the target list remain at the end (will be removed by caller).
/// Target IDs not found in the list are skipped (will be added by caller).
fn reorder_list_by_id(
    list: &LoroMovableList,
    target_ids: &[String],
    id_key: &str,
) -> io::Result<()> {
    let list_len = list.len();
    let mut write_pos = 0;

    for target_id in target_ids {
        if write_pos >= list_len {
            break;
        }
        // Check if correct element is already at write_pos
        let current_id = get_map_at(list, write_pos)
            .map(|m| get_string(&m, id_key))
            .unwrap_or_default();
        if current_id == *target_id {
            write_pos += 1;
            continue;
        }
        // Find target_id in remaining positions
        let found = ((write_pos + 1)..list_len).find(|&i| {
            get_map_at(list, i)
                .map(|m| get_string(&m, id_key) == *target_id)
                .unwrap_or(false)
        });
        if let Some(from) = found {
            list.mov(from, write_pos).map_err(loro_err)?;
            write_pos += 1;
        }
        // If not found in CRDT, skip — will be added by caller
    }
    Ok(())
}

// ── Cross-container move helpers ─────────────────────────────────────────────

/// Card data extracted from a CRDT LoroMap for cross-container move.
struct CardData {
    kid: String,
    content: String,
    checked: bool,
}

/// Column data extracted from a CRDT LoroMap for cross-container move.
struct ColumnData {
    id: String,
    title: String,
    cards: Vec<CardData>,
}

/// Stack data extracted from a CRDT LoroMap for cross-container move.
struct StackData {
    id: String,
    title: String,
    columns: Vec<ColumnData>,
}

/// Extract all data from a column LoroMap (id, title, all cards).
fn extract_column_data(col_map: &LoroMap) -> ColumnData {
    let id = get_string(col_map, "id");
    let title = get_string(col_map, "title");
    let cards = if let Some(cards_list) = get_movable_list(col_map, "cards") {
        (0..cards_list.len())
            .filter_map(|i| {
                get_map_at(&cards_list, i).map(|cm| CardData {
                    kid: get_string(&cm, "kid"),
                    content: get_string(&cm, "content"),
                    checked: get_bool(&cm, "checked"),
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    ColumnData { id, title, cards }
}

/// Extract all data from a stack LoroMap (id, title, all columns with cards).
fn extract_stack_data(stack_map: &LoroMap) -> StackData {
    let id = get_string(stack_map, "id");
    let title = get_string(stack_map, "title");
    let columns = if let Some(cols_list) = get_movable_list(stack_map, "columns") {
        (0..cols_list.len())
            .filter_map(|i| get_map_at(&cols_list, i).map(|cm| extract_column_data(&cm)))
            .collect()
    } else {
        Vec::new()
    };
    StackData { id, title, columns }
}

/// Insert extracted column data (with cards) into a columns LoroMovableList.
fn insert_column_data(cols_list: &LoroMovableList, data: &ColumnData) -> io::Result<()> {
    let col_map: LoroMap = cols_list.push_container(LoroMap::new()).map_err(loro_err)?;
    col_map.insert("id", data.id.as_str()).map_err(loro_err)?;
    col_map
        .insert("title", data.title.as_str())
        .map_err(loro_err)?;
    let cards_list: LoroMovableList = col_map
        .insert_container("cards", LoroMovableList::new())
        .map_err(loro_err)?;
    for card in &data.cards {
        let card_map: LoroMap = cards_list
            .push_container(LoroMap::new())
            .map_err(loro_err)?;
        card_map
            .insert("kid", card.kid.as_str())
            .map_err(loro_err)?;
        card_map
            .insert("content", card.content.as_str())
            .map_err(loro_err)?;
        card_map.insert("checked", card.checked).map_err(loro_err)?;
    }
    Ok(())
}

/// Insert extracted stack data (with columns and cards) into a stacks LoroMovableList.
fn insert_stack_data(stacks_list: &LoroMovableList, data: &StackData) -> io::Result<()> {
    let stack_map: LoroMap = stacks_list
        .push_container(LoroMap::new())
        .map_err(loro_err)?;
    stack_map.insert("id", data.id.as_str()).map_err(loro_err)?;
    stack_map
        .insert("title", data.title.as_str())
        .map_err(loro_err)?;
    let cols_list: LoroMovableList = stack_map
        .insert_container("columns", LoroMovableList::new())
        .map_err(loro_err)?;
    for col in &data.columns {
        insert_column_data(&cols_list, col)?;
    }
    Ok(())
}

// ── Metadata helpers ─────────────────────────────────────────────────────────

/// Write board metadata (yaml_header, footer, settings) into a CRDT metadata map.
fn write_metadata_to_map(meta: &LoroMap, board: &KanbanBoard) -> io::Result<()> {
    // Store yaml_header (empty string = None)
    let yaml = board.yaml_header.as_deref().unwrap_or("");
    meta.insert("yaml_header", yaml).map_err(loro_err)?;

    // Store footer (empty string = None)
    let footer = board.kanban_footer.as_deref().unwrap_or("");
    meta.insert("footer", footer).map_err(loro_err)?;

    // Store settings as a sub-map with individual keys for field-level CRDT resolution
    let settings_map: LoroMap = meta
        .insert_container("settings", LoroMap::new())
        .map_err(loro_err)?;
    if let Some(ref settings) = board.board_settings {
        write_settings_to_map(&settings_map, settings)?;
    }

    let revision_map: LoroMap = meta
        .insert_container("revision", LoroMap::new())
        .map_err(loro_err)?;
    write_generation_meta_to_map(&revision_map, board.generation_meta.as_ref())?;

    Ok(())
}

/// Write individual BoardSettings fields into a LoroMap.
fn write_settings_to_map(map: &LoroMap, settings: &BoardSettings) -> io::Result<()> {
    for key in BOARD_SETTING_KEYS {
        if let Some(val) = settings.get_by_key(key) {
            map.insert(*key, val.as_str()).map_err(loro_err)?;
        }
    }
    Ok(())
}

fn write_generation_meta_to_map(map: &LoroMap, meta: Option<&GenerationMeta>) -> io::Result<()> {
    let generation = meta
        .and_then(|m| m.generation.map(|g| g.to_string()))
        .unwrap_or_default();
    map.insert("generation", generation.as_str())
        .map_err(loro_err)?;
    map.insert(
        "content_hash",
        meta.and_then(|m| m.content_hash.as_deref()).unwrap_or(""),
    )
    .map_err(loro_err)?;
    map.insert(
        "dependency_hash",
        meta.and_then(|m| m.dependency_hash.as_deref())
            .unwrap_or(""),
    )
    .map_err(loro_err)?;
    map.insert(
        "resolved_hash",
        meta.and_then(|m| m.resolved_hash.as_deref()).unwrap_or(""),
    )
    .map_err(loro_err)?;
    map.insert(
        "writer_id",
        meta.and_then(|m| m.writer_id.as_deref()).unwrap_or(""),
    )
    .map_err(loro_err)?;
    Ok(())
}

/// Read board metadata from the CRDT metadata map.
fn read_metadata_from_map(
    meta: &LoroMap,
) -> (
    Option<String>,
    Option<String>,
    Option<BoardSettings>,
    Option<GenerationMeta>,
) {
    let yaml_header = get_optional_string(meta, "yaml_header").filter(|s| !s.is_empty());
    let footer = get_optional_string(meta, "footer").filter(|s| !s.is_empty());
    let settings = get_sub_map(meta, "settings")
        .map(|sm| read_settings_from_map(&sm))
        .filter(|s| s != &BoardSettings::default());
    let generation_meta = get_sub_map(meta, "revision")
        .map(|rm| read_generation_meta_from_map(&rm))
        .filter(|m| m != &GenerationMeta::default());
    (yaml_header, footer, settings, generation_meta)
}

/// Read BoardSettings from a LoroMap of individual setting keys.
fn read_settings_from_map(map: &LoroMap) -> BoardSettings {
    let mut settings = BoardSettings::default();
    for key in BOARD_SETTING_KEYS {
        if let Some(val) = get_optional_string(map, key) {
            settings.set_by_key(key, &val);
        }
    }
    settings
}

fn read_generation_meta_from_map(map: &LoroMap) -> GenerationMeta {
    let mut meta = GenerationMeta::default();
    meta.generation = get_optional_string(map, "generation").and_then(|v| v.parse().ok());
    meta.content_hash = get_optional_string(map, "content_hash").filter(|s| !s.is_empty());
    meta.dependency_hash = get_optional_string(map, "dependency_hash").filter(|s| !s.is_empty());
    meta.resolved_hash = get_optional_string(map, "resolved_hash").filter(|s| !s.is_empty());
    meta.writer_id = get_optional_string(map, "writer_id").filter(|s| !s.is_empty());
    meta
}

// ── Building CRDT from Board ─────────────────────────────────────────────────

fn insert_card(cards_list: &LoroMovableList, card: &KanbanCard) -> io::Result<()> {
    let card_map: LoroMap = cards_list
        .push_container(LoroMap::new())
        .map_err(loro_err)?;
    let kid = card_identity::resolve_kid(&card.content, card.kid.as_deref());
    let content = card_identity::strip_kid(&card.content);
    card_map.insert("kid", kid.as_str()).map_err(loro_err)?;
    card_map
        .insert("content", content.as_str())
        .map_err(loro_err)?;
    card_map.insert("checked", card.checked).map_err(loro_err)?;
    Ok(())
}

fn populate_columns_list(
    columns_list: &LoroMovableList,
    columns: &[KanbanColumn],
) -> io::Result<()> {
    for col in columns {
        populate_single_column(columns_list, col)?;
    }
    Ok(())
}

/// Populate a CRDT columns list from a Vec of column references.
/// Used when columns come from `all_columns()` which returns `Vec<&KanbanColumn>`.
fn populate_columns_list_from_refs(
    columns_list: &LoroMovableList,
    columns: &[&KanbanColumn],
) -> io::Result<()> {
    for col in columns {
        populate_single_column(columns_list, col)?;
    }
    Ok(())
}

fn populate_single_column(columns_list: &LoroMovableList, col: &KanbanColumn) -> io::Result<()> {
    let col_map: LoroMap = columns_list
        .push_container(LoroMap::new())
        .map_err(loro_err)?;
    col_map.insert("id", col.id.as_str()).map_err(loro_err)?;
    col_map
        .insert("title", col.title.as_str())
        .map_err(loro_err)?;
    let cards_list: LoroMovableList = col_map
        .insert_container("cards", LoroMovableList::new())
        .map_err(loro_err)?;
    for card in &col.cards {
        insert_card(&cards_list, card)?;
    }
    Ok(())
}

// ── Reading Board from CRDT ──────────────────────────────────────────────────

fn read_card(card_map: &LoroMap) -> KanbanCard {
    let kid = get_string(card_map, "kid");
    let content = get_string(card_map, "content");
    let checked = get_bool(card_map, "checked");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    KanbanCard {
        id: format!("crdt-{:x}", ts),
        content,
        checked,
        kid: if kid.is_empty() { None } else { Some(kid) },
    }
}

fn read_columns(columns_list: &LoroMovableList) -> Vec<KanbanColumn> {
    let mut columns = Vec::new();
    for i in 0..columns_list.len() {
        if let Some(col_map) = get_map_at(columns_list, i) {
            let cards_list = get_movable_list(&col_map, "cards");
            let cards = if let Some(ref cl) = cards_list {
                (0..cl.len())
                    .filter_map(|j| get_map_at(cl, j).map(|cm| read_card(&cm)))
                    .collect()
            } else {
                Vec::new()
            };
            columns.push(KanbanColumn {
                id: get_string(&col_map, "id"),
                title: get_string(&col_map, "title"),
                cards,
                include_source: None,
            });
        }
    }
    columns
}

// ── CrdtStore Implementation ─────────────────────────────────────────────────

impl CrdtStore {
    /// Create a new CrdtStore from a KanbanBoard.
    pub fn from_board(board: &KanbanBoard) -> io::Result<Self> {
        let doc = LoroDoc::new();
        doc.set_peer_id(1).map_err(loro_err)?;

        let root = doc.get_map("root");
        root.insert("title", board.title.as_str())
            .map_err(loro_err)?;

        let is_new_format = board.format_hint == BoardFormat::New;
        root.insert("format", if is_new_format { "new" } else { "legacy" })
            .map_err(loro_err)?;

        if is_new_format {
            let rows_list: LoroMovableList = root
                .insert_container("rows", LoroMovableList::new())
                .map_err(loro_err)?;
            for row in &board.rows {
                let row_map: LoroMap =
                    rows_list.push_container(LoroMap::new()).map_err(loro_err)?;
                row_map.insert("id", row.id.as_str()).map_err(loro_err)?;
                row_map
                    .insert("title", row.title.as_str())
                    .map_err(loro_err)?;
                let stacks_list: LoroMovableList = row_map
                    .insert_container("stacks", LoroMovableList::new())
                    .map_err(loro_err)?;
                for stack in &row.stacks {
                    let stack_map: LoroMap = stacks_list
                        .push_container(LoroMap::new())
                        .map_err(loro_err)?;
                    stack_map
                        .insert("id", stack.id.as_str())
                        .map_err(loro_err)?;
                    stack_map
                        .insert("title", stack.title.as_str())
                        .map_err(loro_err)?;
                    let columns_list: LoroMovableList = stack_map
                        .insert_container("columns", LoroMovableList::new())
                        .map_err(loro_err)?;
                    populate_columns_list(&columns_list, &stack.columns)?;
                }
            }
        } else {
            // Legacy format: store columns flat. Use all_columns() to handle
            // both flat columns and Default row/stack wrapping from the parser.
            let columns_list: LoroMovableList = root
                .insert_container("columns", LoroMovableList::new())
                .map_err(loro_err)?;
            let cols: Vec<&KanbanColumn> = board.all_columns();
            populate_columns_list_from_refs(&columns_list, &cols)?;
        }

        // Store board metadata in the CRDT
        let metadata_map: LoroMap = root
            .insert_container("metadata", LoroMap::new())
            .map_err(loro_err)?;
        write_metadata_to_map(&metadata_map, board)?;

        doc.commit();
        let undo_mgr = UndoManager::new(&doc);

        Ok(CrdtStore { doc, undo_mgr })
    }

    /// Reconstruct a KanbanBoard from the CRDT state.
    pub fn to_board(&self) -> KanbanBoard {
        let root = self.doc.get_map("root");
        let title = get_string(&root, "title");
        let format = get_string(&root, "format");

        // Read metadata from CRDT (backwards compatible: returns None if missing)
        let (yaml_header, kanban_footer, board_settings, generation_meta) =
            if let Some(meta) = get_sub_map(&root, "metadata") {
                read_metadata_from_map(&meta)
            } else {
                (None, None, None, None)
            };

        if format == "new" {
            let rows = if let Some(rows_list) = get_movable_list(&root, "rows") {
                let mut rows = Vec::new();
                for i in 0..rows_list.len() {
                    if let Some(row_map) = get_map_at(&rows_list, i) {
                        let stacks = if let Some(stacks_list) = get_movable_list(&row_map, "stacks")
                        {
                            let mut stacks = Vec::new();
                            for j in 0..stacks_list.len() {
                                if let Some(stack_map) = get_map_at(&stacks_list, j) {
                                    let columns = if let Some(columns_list) =
                                        get_movable_list(&stack_map, "columns")
                                    {
                                        read_columns(&columns_list)
                                    } else {
                                        Vec::new()
                                    };
                                    stacks.push(KanbanStack {
                                        id: get_string(&stack_map, "id"),
                                        title: get_string(&stack_map, "title"),
                                        columns,
                                    });
                                }
                            }
                            stacks
                        } else {
                            Vec::new()
                        };
                        rows.push(KanbanRow {
                            id: get_string(&row_map, "id"),
                            title: get_string(&row_map, "title"),
                            stacks,
                        });
                    }
                }
                rows
            } else {
                Vec::new()
            };

            KanbanBoard {
                valid: true,
                title,
                columns: Vec::new(),
                rows,
                yaml_header,
                kanban_footer,
                board_settings,
                generation_meta,
                format_hint: BoardFormat::New,
            }
        } else {
            let columns = if let Some(columns_list) = get_movable_list(&root, "columns") {
                read_columns(&columns_list)
            } else {
                Vec::new()
            };

            KanbanBoard {
                valid: true,
                title,
                columns,
                rows: Vec::new(),
                yaml_header,
                kanban_footer,
                board_settings,
                generation_meta,
                format_hint: BoardFormat::Legacy,
            }
        }
    }

    /// Reconstruct a KanbanBoard from the CRDT state, converting panics into
    /// io::Error so callers can recover from poisoned internal locks.
    pub fn to_board_result(&self) -> io::Result<KanbanBoard> {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.to_board()));
        match result {
            Ok(board) => Ok(board),
            Err(payload) => Err(crdt_panic_err("to_board", payload)),
        }
    }

    /// Apply changes from an incoming board by diffing against the current CRDT state.
    pub fn apply_board(&mut self, incoming: &KanbanBoard, current: &KanbanBoard) -> io::Result<()> {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let changes = diff::diff_boards(current, incoming);
            let has_structural_change = self.has_structural_diff(incoming);
            let has_metadata_change = self.has_metadata_diff(incoming);
            let has_title_change = incoming.title != current.title;

            // Update title if changed
            if has_title_change {
                let root = self.doc.get_map("root");
                root.insert("title", incoming.title.as_str())
                    .map_err(loro_err)?;
            }

            // Sync metadata into CRDT
            if has_metadata_change {
                self.sync_metadata(incoming)?;
            }

            // Move stacks/columns that changed parent containers (e.g., column moved
            // from one stack to another). Must run before structural sync so elements
            // are in the correct parent before index-based operations.
            self.execute_cross_container_moves(incoming)?;

            // Sync column structure/titles BEFORE card diffs so that column lookups
            // by stable ID resolve correctly even when a column has been renamed.
            if has_structural_change {
                self.sync_column_structure(incoming, current)?;
            } else {
                self.sync_column_order(incoming)?;
            }

            // Apply card-level diffs (add/remove/modify/move between columns)
            for change in &changes {
                match change {
                    CardChange::Added {
                        kid,
                        column_id,
                        column_title,
                        card,
                    } => {
                        if let Some(cards_list) =
                            self.find_column_cards_list_by_identity(column_id, column_title)
                        {
                            // Skip if card already exists in target (placed by sync_column_structure)
                            let already_exists = (0..cards_list.len()).any(|i| {
                                get_map_at(&cards_list, i)
                                    .map(|m| get_string(&m, "kid") == *kid)
                                    .unwrap_or(false)
                            });
                            if !already_exists {
                                let card_map: LoroMap = cards_list
                                    .push_container(LoroMap::new())
                                    .map_err(loro_err)?;
                                let content = card_identity::strip_kid(&card.content);
                                card_map.insert("kid", kid.as_str()).map_err(loro_err)?;
                                card_map
                                    .insert("content", content.as_str())
                                    .map_err(loro_err)?;
                                card_map.insert("checked", card.checked).map_err(loro_err)?;
                            }
                        }
                    }
                    CardChange::Removed { kid, .. } => {
                        if let Some((cards_list, pos)) = self.find_card_position(kid) {
                            cards_list.delete(pos, 1).map_err(loro_err)?;
                        }
                    }
                    CardChange::Modified {
                        kid,
                        new_content,
                        new_checked,
                        ..
                    } => {
                        if let Some((_, pos, cards_list)) = self.find_card_with_map(kid) {
                            if let Some(card_map) = get_map_at(&cards_list, pos) {
                                card_map
                                    .insert("content", new_content.as_str())
                                    .map_err(loro_err)?;
                                card_map.insert("checked", *new_checked).map_err(loro_err)?;
                            }
                        }
                    }
                    CardChange::Moved {
                        kid,
                        old_column_id,
                        old_column,
                        new_column_id,
                        new_column,
                    } => {
                        // Check if card already exists in target (placed by sync_column_structure)
                        let already_in_target = self
                            .find_column_cards_list_by_identity(new_column_id, new_column)
                            .map(|cl| {
                                (0..cl.len()).any(|i| {
                                    get_map_at(&cl, i)
                                        .map(|m| get_string(&m, "kid") == *kid)
                                        .unwrap_or(false)
                                })
                            })
                            .unwrap_or(false);

                        // Find and remove from old column specifically (not just first match anywhere)
                        if let Some(old_cards) =
                            self.find_column_cards_list_by_identity(old_column_id, old_column)
                        {
                            let pos = (0..old_cards.len()).find(|&i| {
                                get_map_at(&old_cards, i)
                                    .map(|m| get_string(&m, "kid") == *kid)
                                    .unwrap_or(false)
                            });
                            if let Some(pos) = pos {
                                let card_data = if !already_in_target {
                                    // Read data before removing — we need to add to target
                                    get_map_at(&old_cards, pos).map(|m| {
                                        (
                                            get_string(&m, "kid"),
                                            get_string(&m, "content"),
                                            get_bool(&m, "checked"),
                                        )
                                    })
                                } else {
                                    None
                                };
                                old_cards.delete(pos, 1).map_err(loro_err)?;

                                // Add to target only if not already there
                                if let Some((kid_val, content, checked)) = card_data {
                                    if let Some(target_cards) = self
                                        .find_column_cards_list_by_identity(
                                            new_column_id,
                                            new_column,
                                        )
                                    {
                                        let card_map: LoroMap = target_cards
                                            .push_container(LoroMap::new())
                                            .map_err(loro_err)?;
                                        card_map
                                            .insert("kid", kid_val.as_str())
                                            .map_err(loro_err)?;
                                        card_map
                                            .insert("content", content.as_str())
                                            .map_err(loro_err)?;
                                        card_map.insert("checked", checked).map_err(loro_err)?;
                                    }
                                }
                            }
                        } else if !already_in_target {
                            // Old column not found — try global search as fallback
                            if let Some((cards_list, pos)) = self.find_card_position(kid) {
                                let card_map = get_map_at(&cards_list, pos);
                                let data = card_map.map(|m| {
                                    (
                                        get_string(&m, "kid"),
                                        get_string(&m, "content"),
                                        get_bool(&m, "checked"),
                                    )
                                });
                                cards_list.delete(pos, 1).map_err(loro_err)?;
                                if let Some((kid_val, content, checked)) = data {
                                    if let Some(target_cards) = self
                                        .find_column_cards_list_by_identity(
                                            new_column_id,
                                            new_column,
                                        )
                                    {
                                        let card_map: LoroMap = target_cards
                                            .push_container(LoroMap::new())
                                            .map_err(loro_err)?;
                                        card_map
                                            .insert("kid", kid_val.as_str())
                                            .map_err(loro_err)?;
                                        card_map
                                            .insert("content", content.as_str())
                                            .map_err(loro_err)?;
                                        card_map.insert("checked", checked).map_err(loro_err)?;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Always sync card ordering to match the incoming board exactly.
            // This is a cheap no-op when the order already matches, but critical
            // when the only change is a reorder (which diff_boards does not detect).
            self.sync_card_order(incoming)?;

            self.doc.commit();
            Ok(())
        }));

        match result {
            Ok(inner) => inner,
            Err(payload) => Err(crdt_panic_err("apply_board", payload)),
        }
    }

    /// Reorder cards within each column to match the incoming board's card order.
    fn sync_card_order(&self, incoming: &KanbanBoard) -> io::Result<()> {
        for col in incoming.all_columns() {
            let incoming_kids: Vec<String> = col
                .cards
                .iter()
                .filter_map(|c| {
                    c.kid
                        .clone()
                        .or_else(|| card_identity::extract_kid(&c.content))
                })
                .collect();
            if incoming_kids.is_empty() {
                continue;
            }
            if let Some(cards_list) = self.find_column_cards_list_by_identity(&col.id, &col.title) {
                reorder_list_by_id(&cards_list, &incoming_kids, "kid")?;
            }
        }
        Ok(())
    }

    /// Lightweight reorder of rows/stacks/columns to match the incoming board.
    /// Unlike sync_column_structure, this does NOT add or remove elements — only
    /// reorders existing ones.  Used when counts match but order differs.
    fn sync_column_order(&self, incoming: &KanbanBoard) -> io::Result<()> {
        let root = self.doc.get_map("root");
        let format = get_string(&root, "format");

        if format == "new" {
            if let Some(rows_list) = get_movable_list(&root, "rows") {
                let row_ids: Vec<String> = incoming.rows.iter().map(|r| r.id.clone()).collect();
                reorder_list_by_id(&rows_list, &row_ids, "id")?;

                for (ri, row) in incoming.rows.iter().enumerate() {
                    if let Some(row_map) = get_map_at(&rows_list, ri) {
                        // Sync title
                        let _ = row_map.insert("title", row.title.as_str());

                        if let Some(stacks_list) = get_movable_list(&row_map, "stacks") {
                            let stack_ids: Vec<String> =
                                row.stacks.iter().map(|s| s.id.clone()).collect();
                            reorder_list_by_id(&stacks_list, &stack_ids, "id")?;

                            for (si, stack) in row.stacks.iter().enumerate() {
                                if let Some(stack_map) = get_map_at(&stacks_list, si) {
                                    // Sync title
                                    let _ = stack_map.insert("title", stack.title.as_str());

                                    if let Some(cols_list) = get_movable_list(&stack_map, "columns")
                                    {
                                        let col_ids: Vec<String> =
                                            stack.columns.iter().map(|c| c.id.clone()).collect();
                                        reorder_list_by_id(&cols_list, &col_ids, "id")?;

                                        for (ci, col) in stack.columns.iter().enumerate() {
                                            if let Some(col_map) = get_map_at(&cols_list, ci) {
                                                let _ = col_map.insert("title", col.title.as_str());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Legacy format: reorder flat columns by ID and sync titles
            if let Some(columns_list) = get_movable_list(&root, "columns") {
                let col_ids: Vec<String> = incoming
                    .all_columns()
                    .iter()
                    .map(|c| c.id.clone())
                    .collect();
                reorder_list_by_id(&columns_list, &col_ids, "id")?;

                for (ci, col) in incoming.all_columns().iter().enumerate() {
                    if let Some(col_map) = get_map_at(&columns_list, ci) {
                        let _ = col_map.insert("title", col.title.as_str());
                    }
                }
            }
        }
        Ok(())
    }

    /// Detect and execute cross-container moves for stacks and columns.
    ///
    /// Must run BEFORE sync_column_structure/sync_column_order so that elements
    /// are in the correct parent containers before index-based sync runs.
    /// Only applies to "new" format boards (legacy has flat columns, no parents).
    fn execute_cross_container_moves(&self, incoming: &KanbanBoard) -> io::Result<()> {
        let root = self.doc.get_map("root");
        let format = get_string(&root, "format");
        if format != "new" {
            return Ok(());
        }

        let rows_list = match get_movable_list(&root, "rows") {
            Some(rl) => rl,
            None => return Ok(()),
        };

        // ── Phase 1: Stack moves between rows ──────────────────────────
        let crdt_stack_index = Self::build_crdt_stack_index(&rows_list);

        let mut incoming_stack_index: HashMap<String, usize> = HashMap::new();
        for (ri, row) in incoming.rows.iter().enumerate() {
            for stack in &row.stacks {
                incoming_stack_index.insert(stack.id.clone(), ri);
            }
        }

        // Find stacks that are in the wrong row
        let mut stack_moves: Vec<(String, usize, usize)> = Vec::new();
        for (stack_id, &target_row) in &incoming_stack_index {
            if let Some(&crdt_row) = crdt_stack_index.get(stack_id) {
                if crdt_row != target_row {
                    stack_moves.push((stack_id.clone(), crdt_row, target_row));
                }
            }
        }

        for (stack_id, from_row_idx, to_row_idx) in &stack_moves {
            // Only execute if target row exists in CRDT. If not, the stack stays
            // in its current location and sync_column_structure will handle the
            // full rebuild (creating the new row with all content from incoming).
            if *to_row_idx >= rows_list.len() {
                continue;
            }
            // Verify target row has a stacks list we can insert into
            let target_ok = get_map_at(&rows_list, *to_row_idx)
                .and_then(|m| get_movable_list(&m, "stacks"))
                .is_some();
            if !target_ok {
                continue;
            }

            if let Some(source_row_map) = get_map_at(&rows_list, *from_row_idx) {
                if let Some(source_stacks_list) = get_movable_list(&source_row_map, "stacks") {
                    let stack_pos = (0..source_stacks_list.len()).find(|&i| {
                        get_map_at(&source_stacks_list, i)
                            .map(|m| get_string(&m, "id") == *stack_id)
                            .unwrap_or(false)
                    });
                    if let Some(pos) = stack_pos {
                        let stack_map = get_map_at(&source_stacks_list, pos).unwrap();
                        let data = extract_stack_data(&stack_map);
                        source_stacks_list.delete(pos, 1).map_err(loro_err)?;

                        if let Some(target_row_map) = get_map_at(&rows_list, *to_row_idx) {
                            if let Some(target_stacks_list) =
                                get_movable_list(&target_row_map, "stacks")
                            {
                                insert_stack_data(&target_stacks_list, &data)?;
                            }
                        }
                    }
                }
            }
        }

        // ── Phase 2: Column moves between stacks ───────────────────────
        // Rebuild index after stack moves (positions may have changed)
        let crdt_col_index = Self::build_crdt_column_index(&rows_list);

        let mut incoming_col_index: HashMap<String, (usize, usize)> = HashMap::new();
        for (ri, row) in incoming.rows.iter().enumerate() {
            for (si, stack) in row.stacks.iter().enumerate() {
                for col in &stack.columns {
                    incoming_col_index.insert(col.id.clone(), (ri, si));
                }
            }
        }

        let mut col_moves: Vec<(String, (usize, usize), (usize, usize))> = Vec::new();
        for (col_id, &(target_ri, target_si)) in &incoming_col_index {
            if let Some(&(crdt_ri, crdt_si)) = crdt_col_index.get(col_id) {
                if crdt_ri != target_ri || crdt_si != target_si {
                    col_moves.push((col_id.clone(), (crdt_ri, crdt_si), (target_ri, target_si)));
                }
            }
        }

        for (col_id, (from_ri, from_si), (to_ri, to_si)) in &col_moves {
            // Only execute if target stack exists in CRDT. If not, the column
            // stays in its current location and sync_column_structure will handle
            // the full rebuild (creating the new stack with content from incoming).
            let target_ok = if *to_ri < rows_list.len() {
                get_map_at(&rows_list, *to_ri)
                    .and_then(|rm| get_movable_list(&rm, "stacks"))
                    .and_then(|sl| {
                        if *to_si < sl.len() {
                            get_map_at(&sl, *to_si)
                        } else {
                            None
                        }
                    })
                    .and_then(|sm| get_movable_list(&sm, "columns"))
                    .is_some()
            } else {
                false
            };
            if !target_ok {
                continue;
            }

            if let Some(src_row_map) = get_map_at(&rows_list, *from_ri) {
                if let Some(src_stacks_list) = get_movable_list(&src_row_map, "stacks") {
                    if let Some(src_stack_map) = get_map_at(&src_stacks_list, *from_si) {
                        if let Some(src_cols_list) = get_movable_list(&src_stack_map, "columns") {
                            let col_pos = (0..src_cols_list.len()).find(|&i| {
                                get_map_at(&src_cols_list, i)
                                    .map(|m| get_string(&m, "id") == *col_id)
                                    .unwrap_or(false)
                            });
                            if let Some(pos) = col_pos {
                                let col_map = get_map_at(&src_cols_list, pos).unwrap();
                                let data = extract_column_data(&col_map);
                                src_cols_list.delete(pos, 1).map_err(loro_err)?;

                                if let Some(tgt_row_map) = get_map_at(&rows_list, *to_ri) {
                                    if let Some(tgt_stacks_list) =
                                        get_movable_list(&tgt_row_map, "stacks")
                                    {
                                        if let Some(tgt_stack_map) =
                                            get_map_at(&tgt_stacks_list, *to_si)
                                        {
                                            if let Some(tgt_cols_list) =
                                                get_movable_list(&tgt_stack_map, "columns")
                                            {
                                                insert_column_data(&tgt_cols_list, &data)?;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Build a map of stack_id -> row_index from the CRDT's rows list.
    fn build_crdt_stack_index(rows_list: &LoroMovableList) -> HashMap<String, usize> {
        let mut index = HashMap::new();
        for ri in 0..rows_list.len() {
            if let Some(row_map) = get_map_at(rows_list, ri) {
                if let Some(stacks_list) = get_movable_list(&row_map, "stacks") {
                    for si in 0..stacks_list.len() {
                        if let Some(stack_map) = get_map_at(&stacks_list, si) {
                            let id = get_string(&stack_map, "id");
                            if !id.is_empty() {
                                index.insert(id, ri);
                            }
                        }
                    }
                }
            }
        }
        index
    }

    /// Build a map of column_id -> (row_index, stack_index) from the CRDT's rows list.
    fn build_crdt_column_index(rows_list: &LoroMovableList) -> HashMap<String, (usize, usize)> {
        let mut index = HashMap::new();
        for ri in 0..rows_list.len() {
            if let Some(row_map) = get_map_at(rows_list, ri) {
                if let Some(stacks_list) = get_movable_list(&row_map, "stacks") {
                    for si in 0..stacks_list.len() {
                        if let Some(stack_map) = get_map_at(&stacks_list, si) {
                            if let Some(cols_list) = get_movable_list(&stack_map, "columns") {
                                for ci in 0..cols_list.len() {
                                    if let Some(col_map) = get_map_at(&cols_list, ci) {
                                        let id = get_string(&col_map, "id");
                                        if !id.is_empty() {
                                            index.insert(id, (ri, si));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        index
    }

    /// Check whether the incoming board has different metadata than the CRDT.
    fn has_metadata_diff(&self, incoming: &KanbanBoard) -> bool {
        let root = self.doc.get_map("root");
        let (crdt_yaml, crdt_footer, crdt_settings, crdt_generation_meta) =
            if let Some(meta) = get_sub_map(&root, "metadata") {
                read_metadata_from_map(&meta)
            } else {
                // No metadata map in CRDT: any non-None incoming metadata is a diff
                return incoming.yaml_header.is_some()
                    || incoming.kanban_footer.is_some()
                    || incoming.board_settings.is_some()
                    || incoming.generation_meta.is_some();
            };

        crdt_yaml != incoming.yaml_header
            || crdt_footer != incoming.kanban_footer
            || crdt_settings != incoming.board_settings
            || crdt_generation_meta != incoming.generation_meta
    }

    /// Sync metadata from the incoming board into the CRDT metadata map.
    /// Creates the metadata map if it does not exist (legacy CRDT upgrade).
    /// Reuses existing sub-maps (especially "settings") to preserve CRDT lineage
    /// so that concurrent field-level changes merge correctly.
    fn sync_metadata(&self, incoming: &KanbanBoard) -> io::Result<()> {
        let root = self.doc.get_map("root");
        let metadata_map: LoroMap = if let Some(meta) = get_sub_map(&root, "metadata") {
            meta
        } else {
            // Legacy CRDT: create metadata map on first access
            root.insert_container("metadata", LoroMap::new())
                .map_err(loro_err)?
        };

        // Update scalar metadata fields
        let yaml = incoming.yaml_header.as_deref().unwrap_or("");
        metadata_map.insert("yaml_header", yaml).map_err(loro_err)?;
        let footer = incoming.kanban_footer.as_deref().unwrap_or("");
        metadata_map.insert("footer", footer).map_err(loro_err)?;

        // Update settings in-place (reuse existing LoroMap for CRDT merge)
        let settings_map: LoroMap = if let Some(sm) = get_sub_map(&metadata_map, "settings") {
            sm
        } else {
            metadata_map
                .insert_container("settings", LoroMap::new())
                .map_err(loro_err)?
        };
        if let Some(ref settings) = incoming.board_settings {
            write_settings_to_map(&settings_map, settings)?;
        }

        let revision_map: LoroMap = if let Some(rm) = get_sub_map(&metadata_map, "revision") {
            rm
        } else {
            metadata_map
                .insert_container("revision", LoroMap::new())
                .map_err(loro_err)?
        };
        write_generation_meta_to_map(&revision_map, incoming.generation_meta.as_ref())?;

        Ok(())
    }

    /// Check whether the incoming board has a different structure than the CRDT.
    /// Detects format upgrade (legacy->new), row/stack/column count changes, and
    /// title/id changes that `diff_boards` (card-level only) would miss.
    fn has_structural_diff(&self, incoming: &KanbanBoard) -> bool {
        let root = self.doc.get_map("root");
        let format = get_string(&root, "format");

        // Format upgrade: legacy CRDT but incoming has actual new-format rows
        // (not just the Default wrapper from the parser's legacy path).
        if format != "new" && incoming.format_hint == BoardFormat::New && !incoming.rows.is_empty()
        {
            return true;
        }

        if format == "new" {
            if let Some(rows_list) = get_movable_list(&root, "rows") {
                if rows_list.len() != incoming.rows.len() {
                    return true;
                }
                for (ri, row) in incoming.rows.iter().enumerate() {
                    if let Some(row_map) = get_map_at(&rows_list, ri) {
                        if get_string(&row_map, "title") != row.title {
                            return true;
                        }
                        if let Some(stacks_list) = get_movable_list(&row_map, "stacks") {
                            if stacks_list.len() != row.stacks.len() {
                                return true;
                            }
                            for (si, stack) in row.stacks.iter().enumerate() {
                                if let Some(stack_map) = get_map_at(&stacks_list, si) {
                                    if get_string(&stack_map, "title") != stack.title {
                                        return true;
                                    }
                                    if let Some(cols_list) = get_movable_list(&stack_map, "columns")
                                    {
                                        if cols_list.len() != stack.columns.len() {
                                            return true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Legacy format: check column count using all_columns() which
            // handles both flat columns and Default row/stack wrapping.
            if let Some(columns_list) = get_movable_list(&root, "columns") {
                if columns_list.len() != incoming.all_columns().len() {
                    return true;
                }
            }
        }

        false
    }

    /// Synchronize column structure using 3-way merge — compares CRDT state,
    /// incoming board (what the user saved), and current board (what the user
    /// started editing from) to correctly handle concurrent additions and
    /// intentional deletions.
    fn sync_column_structure(&self, incoming: &KanbanBoard, current: &KanbanBoard) -> io::Result<()> {
        let root = self.doc.get_map("root");
        let format = get_string(&root, "format");

        if format == "new" {
            if let Some(rows_list) = get_movable_list(&root, "rows") {
                // Collect CRDT row IDs
                let crdt_row_ids: Vec<String> = (0..rows_list.len())
                    .filter_map(|i| get_map_at(&rows_list, i).map(|m| get_string(&m, "id")))
                    .collect();
                let incoming_row_ids: HashSet<&str> =
                    incoming.rows.iter().map(|r| r.id.as_str()).collect();
                let current_row_ids: HashSet<&str> =
                    current.rows.iter().map(|r| r.id.as_str()).collect();

                // Phase 1: Delete rows that user intentionally removed (reverse order)
                // A row should be deleted if: it's in CRDT, user saw it (in current),
                // and user removed it (not in incoming).
                for i in (0..rows_list.len()).rev() {
                    if i < crdt_row_ids.len() {
                        let id = &crdt_row_ids[i];
                        if !incoming_row_ids.contains(id.as_str())
                            && current_row_ids.contains(id.as_str())
                        {
                            let _ = rows_list.delete(i, 1);
                        }
                    }
                }

                // Phase 2: Add new rows from incoming that don't exist in CRDT
                let crdt_row_id_set: HashSet<String> = crdt_row_ids.iter().cloned().collect();
                for row in &incoming.rows {
                    if !crdt_row_id_set.contains(&row.id) {
                        let row_map: LoroMap =
                            rows_list.push_container(LoroMap::new()).map_err(loro_err)?;
                        row_map.insert("id", row.id.as_str()).map_err(loro_err)?;
                        row_map.insert("title", row.title.as_str()).map_err(loro_err)?;
                        let stacks_list: LoroMovableList = row_map
                            .insert_container("stacks", LoroMovableList::new())
                            .map_err(loro_err)?;
                        for stack in &row.stacks {
                            let stack_map: LoroMap = stacks_list
                                .push_container(LoroMap::new()).map_err(loro_err)?;
                            stack_map.insert("id", stack.id.as_str()).map_err(loro_err)?;
                            stack_map.insert("title", stack.title.as_str()).map_err(loro_err)?;
                            let cols_list: LoroMovableList = stack_map
                                .insert_container("columns", LoroMovableList::new())
                                .map_err(loro_err)?;
                            for col in &stack.columns {
                                let data = ColumnData {
                                    id: col.id.clone(),
                                    title: col.title.clone(),
                                    cards: col.cards.iter().map(|c| CardData {
                                        kid: c.kid.clone().unwrap_or_default(),
                                        content: card_identity::strip_kid(&c.content),
                                        checked: c.checked,
                                    }).collect(),
                                };
                                insert_column_data(&cols_list, &data)?;
                            }
                        }
                    }
                }

                // Phase 3: Reorder — incoming items first, preserved items at end
                let row_ids: Vec<String> = incoming.rows.iter().map(|r| r.id.clone()).collect();
                reorder_list_by_id(&rows_list, &row_ids, "id")?;

                // Phase 4: Update existing rows and recurse into stacks/columns
                for row in &incoming.rows {
                    let pos = (0..rows_list.len()).find(|&i| {
                        get_map_at(&rows_list, i)
                            .map(|m| get_string(&m, "id") == row.id)
                            .unwrap_or(false)
                    });
                    let Some(ri) = pos else { continue };
                    let Some(row_map) = get_map_at(&rows_list, ri) else { continue };

                    row_map.insert("title", row.title.as_str()).map_err(loro_err)?;

                    // 3-way merge for stacks within this row
                    if let Some(stacks_list) = get_movable_list(&row_map, "stacks") {
                        let current_row = current.rows.iter().find(|r| r.id == row.id);
                        self.sync_stacks_3way(&stacks_list, &row.stacks, current_row)?;
                    }
                }
            }
        } else if incoming.format_hint == BoardFormat::New && !incoming.rows.is_empty() {
            // Legacy CRDT but incoming board has actual new-format rows — upgrade format.
            // Rebuild the entire CRDT structure as "new" format, populating
            // card lists from the incoming board data.
            root.insert("format", "new").map_err(loro_err)?;

            let rows_list: LoroMovableList = root
                .insert_container("rows", LoroMovableList::new())
                .map_err(loro_err)?;
            for row in &incoming.rows {
                let row_map: LoroMap =
                    rows_list.push_container(LoroMap::new()).map_err(loro_err)?;
                row_map.insert("id", row.id.as_str()).map_err(loro_err)?;
                row_map
                    .insert("title", row.title.as_str())
                    .map_err(loro_err)?;
                let stacks_list: LoroMovableList = row_map
                    .insert_container("stacks", LoroMovableList::new())
                    .map_err(loro_err)?;
                for stack in &row.stacks {
                    let stack_map: LoroMap = stacks_list
                        .push_container(LoroMap::new())
                        .map_err(loro_err)?;
                    stack_map
                        .insert("id", stack.id.as_str())
                        .map_err(loro_err)?;
                    stack_map
                        .insert("title", stack.title.as_str())
                        .map_err(loro_err)?;
                    let cols_list: LoroMovableList = stack_map
                        .insert_container("columns", LoroMovableList::new())
                        .map_err(loro_err)?;
                    for col in &stack.columns {
                        let col_map: LoroMap =
                            cols_list.push_container(LoroMap::new()).map_err(loro_err)?;
                        col_map.insert("id", col.id.as_str()).map_err(loro_err)?;
                        col_map
                            .insert("title", col.title.as_str())
                            .map_err(loro_err)?;
                        let cards_list: LoroMovableList = col_map
                            .insert_container("cards", LoroMovableList::new())
                            .map_err(loro_err)?;
                        // Populate cards from the incoming board
                        for card in &col.cards {
                            let card_map: LoroMap = cards_list
                                .push_container(LoroMap::new())
                                .map_err(loro_err)?;
                            let kid = card.kid.as_deref().unwrap_or("");
                            let content = card_identity::strip_kid(&card.content);
                            card_map.insert("kid", kid).map_err(loro_err)?;
                            card_map
                                .insert("content", content.as_str())
                                .map_err(loro_err)?;
                            card_map.insert("checked", card.checked).map_err(loro_err)?;
                        }
                    }
                }
            }
        } else {
            // Legacy format — add missing columns.
            // Use all_columns() to handle both flat columns and Default row/stack wrapping.
            if let Some(columns_list) = get_movable_list(&root, "columns") {
                let existing_titles: Vec<String> = (0..columns_list.len())
                    .filter_map(|i| get_map_at(&columns_list, i).map(|m| get_string(&m, "title")))
                    .collect();

                for col in incoming.all_columns() {
                    if !existing_titles.contains(&col.title) {
                        let data = ColumnData {
                            id: col.id.clone(),
                            title: col.title.clone(),
                            cards: col
                                .cards
                                .iter()
                                .map(|c| CardData {
                                    kid: c.kid.clone().unwrap_or_default(),
                                    content: card_identity::strip_kid(&c.content),
                                    checked: c.checked,
                                })
                                .collect(),
                        };
                        insert_column_data(&columns_list, &data)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// 3-way merge for stacks within a row.
    /// Same pattern as row-level: delete intentionally removed → add missing → reorder → update.
    fn sync_stacks_3way(
        &self,
        stacks_list: &LoroMovableList,
        incoming_stacks: &[KanbanStack],
        current_row: Option<&KanbanRow>,
    ) -> io::Result<()> {
        let crdt_stack_ids: Vec<String> = (0..stacks_list.len())
            .filter_map(|i| get_map_at(stacks_list, i).map(|m| get_string(&m, "id")))
            .collect();
        let incoming_stack_ids: HashSet<&str> =
            incoming_stacks.iter().map(|s| s.id.as_str()).collect();
        let current_stack_ids: HashSet<&str> = current_row
            .map(|r| r.stacks.iter().map(|s| s.id.as_str()).collect())
            .unwrap_or_default();

        // Phase 1: Delete stacks that user intentionally removed (reverse order)
        for i in (0..stacks_list.len()).rev() {
            if i < crdt_stack_ids.len() {
                let id = &crdt_stack_ids[i];
                if !incoming_stack_ids.contains(id.as_str())
                    && current_stack_ids.contains(id.as_str())
                {
                    let _ = stacks_list.delete(i, 1);
                }
            }
        }

        // Phase 2: Add new stacks from incoming that don't exist in CRDT
        let crdt_stack_id_set: HashSet<String> = crdt_stack_ids.iter().cloned().collect();
        for stack in incoming_stacks {
            if !crdt_stack_id_set.contains(&stack.id) {
                let stack_map: LoroMap =
                    stacks_list.push_container(LoroMap::new()).map_err(loro_err)?;
                stack_map.insert("id", stack.id.as_str()).map_err(loro_err)?;
                stack_map.insert("title", stack.title.as_str()).map_err(loro_err)?;
                let cols_list: LoroMovableList = stack_map
                    .insert_container("columns", LoroMovableList::new())
                    .map_err(loro_err)?;
                for col in &stack.columns {
                    let data = ColumnData {
                        id: col.id.clone(),
                        title: col.title.clone(),
                        cards: col.cards.iter().map(|c| CardData {
                            kid: c.kid.clone().unwrap_or_default(),
                            content: card_identity::strip_kid(&c.content),
                            checked: c.checked,
                        }).collect(),
                    };
                    insert_column_data(&cols_list, &data)?;
                }
            }
        }

        // Phase 3: Reorder — incoming items first, preserved items at end
        let stack_ids: Vec<String> = incoming_stacks.iter().map(|s| s.id.clone()).collect();
        reorder_list_by_id(stacks_list, &stack_ids, "id")?;

        // Phase 4: Update existing stacks and recurse into columns
        for stack in incoming_stacks {
            let pos = (0..stacks_list.len()).find(|&i| {
                get_map_at(stacks_list, i)
                    .map(|m| get_string(&m, "id") == stack.id)
                    .unwrap_or(false)
            });
            let Some(si) = pos else { continue };
            let Some(stack_map) = get_map_at(stacks_list, si) else { continue };

            stack_map.insert("title", stack.title.as_str()).map_err(loro_err)?;

            // 3-way merge for columns within this stack
            if let Some(cols_list) = get_movable_list(&stack_map, "columns") {
                let current_stack = current_row
                    .and_then(|r| r.stacks.iter().find(|s| s.id == stack.id));
                self.sync_columns_3way(&cols_list, &stack.columns, current_stack)?;
            }
        }

        Ok(())
    }

    /// 3-way merge for columns within a stack.
    /// Same pattern: delete intentionally removed → add missing → reorder → update titles.
    fn sync_columns_3way(
        &self,
        cols_list: &LoroMovableList,
        incoming_columns: &[KanbanColumn],
        current_stack: Option<&KanbanStack>,
    ) -> io::Result<()> {
        let crdt_col_ids: Vec<String> = (0..cols_list.len())
            .filter_map(|i| get_map_at(cols_list, i).map(|m| get_string(&m, "id")))
            .collect();
        let incoming_col_ids: HashSet<&str> =
            incoming_columns.iter().map(|c| c.id.as_str()).collect();
        let current_col_ids: HashSet<&str> = current_stack
            .map(|s| s.columns.iter().map(|c| c.id.as_str()).collect())
            .unwrap_or_default();

        // Phase 1: Delete columns that user intentionally removed (reverse order)
        for i in (0..cols_list.len()).rev() {
            if i < crdt_col_ids.len() {
                let id = &crdt_col_ids[i];
                if !incoming_col_ids.contains(id.as_str())
                    && current_col_ids.contains(id.as_str())
                {
                    let _ = cols_list.delete(i, 1);
                }
            }
        }

        // Phase 2: Add new columns from incoming that don't exist in CRDT
        let crdt_col_id_set: HashSet<String> = crdt_col_ids.iter().cloned().collect();
        for col in incoming_columns {
            if !crdt_col_id_set.contains(&col.id) {
                let data = ColumnData {
                    id: col.id.clone(),
                    title: col.title.clone(),
                    cards: col.cards.iter().map(|c| CardData {
                        kid: c.kid.clone().unwrap_or_default(),
                        content: card_identity::strip_kid(&c.content),
                        checked: c.checked,
                    }).collect(),
                };
                insert_column_data(cols_list, &data)?;
            }
        }

        // Phase 3: Reorder — incoming items first, preserved items at end
        let col_ids: Vec<String> = incoming_columns.iter().map(|c| c.id.clone()).collect();
        reorder_list_by_id(cols_list, &col_ids, "id")?;

        // Phase 4: Update titles of existing columns (card sync handled separately)
        for col in incoming_columns {
            let pos = (0..cols_list.len()).find(|&i| {
                get_map_at(cols_list, i)
                    .map(|m| get_string(&m, "id") == col.id)
                    .unwrap_or(false)
            });
            let Some(ci) = pos else { continue };
            let Some(col_map) = get_map_at(cols_list, ci) else { continue };

            col_map.insert("title", col.title.as_str()).map_err(loro_err)?;
        }

        Ok(())
    }

    /// Find the cards LoroMovableList for a column by stable ID with a title fallback.
    fn find_column_cards_list_by_identity(
        &self,
        column_id: &str,
        column_title: &str,
    ) -> Option<LoroMovableList> {
        let root = self.doc.get_map("root");
        let format = get_string(&root, "format");

        if format == "new" {
            let rows_list = get_movable_list(&root, "rows")?;
            if !column_id.is_empty() {
                for ri in 0..rows_list.len() {
                    let row_map = get_map_at(&rows_list, ri)?;
                    let stacks_list = get_movable_list(&row_map, "stacks")?;
                    for si in 0..stacks_list.len() {
                        let stack_map = get_map_at(&stacks_list, si)?;
                        let cols_list = get_movable_list(&stack_map, "columns")?;
                        for ci in 0..cols_list.len() {
                            if let Some(col_map) = get_map_at(&cols_list, ci) {
                                if get_string(&col_map, "id") == column_id {
                                    return get_movable_list(&col_map, "cards");
                                }
                            }
                        }
                    }
                }
            }
            for ri in 0..rows_list.len() {
                let row_map = get_map_at(&rows_list, ri)?;
                let stacks_list = get_movable_list(&row_map, "stacks")?;
                for si in 0..stacks_list.len() {
                    let stack_map = get_map_at(&stacks_list, si)?;
                    let cols_list = get_movable_list(&stack_map, "columns")?;
                    for ci in 0..cols_list.len() {
                        if let Some(col_map) = get_map_at(&cols_list, ci) {
                            if get_string(&col_map, "title") == column_title {
                                return get_movable_list(&col_map, "cards");
                            }
                        }
                    }
                }
            }
            None
        } else {
            let columns_list = get_movable_list(&root, "columns")?;
            if !column_id.is_empty() {
                for i in 0..columns_list.len() {
                    if let Some(col_map) = get_map_at(&columns_list, i) {
                        if get_string(&col_map, "id") == column_id {
                            return get_movable_list(&col_map, "cards");
                        }
                    }
                }
            }
            for i in 0..columns_list.len() {
                if let Some(col_map) = get_map_at(&columns_list, i) {
                    if get_string(&col_map, "title") == column_title {
                        return get_movable_list(&col_map, "cards");
                    }
                }
            }
            None
        }
    }

    /// Find a card's position by kid. Returns (cards_list, index).
    fn find_card_position(&self, kid: &str) -> Option<(LoroMovableList, usize)> {
        self.find_card_with_map(kid)
            .map(|(list, pos, _)| (list, pos))
    }

    /// Find a card by kid, returning (cards_list_clone, index, cards_list).
    /// The first element is a clone for deletion, the third for reading.
    fn find_card_with_map(&self, kid: &str) -> Option<(LoroMovableList, usize, LoroMovableList)> {
        let all_cards_lists = self.collect_all_cards_lists();
        for cards_list in all_cards_lists {
            for i in 0..cards_list.len() {
                if let Some(card_map) = get_map_at(&cards_list, i) {
                    if get_string(&card_map, "kid") == kid {
                        return Some((cards_list.clone(), i, cards_list));
                    }
                }
            }
        }
        None
    }

    /// Collect all cards LoroMovableLists from the document.
    fn collect_all_cards_lists(&self) -> Vec<LoroMovableList> {
        let root = self.doc.get_map("root");
        let format = get_string(&root, "format");
        let mut result = Vec::new();

        if format == "new" {
            if let Some(rows_list) = get_movable_list(&root, "rows") {
                for ri in 0..rows_list.len() {
                    if let Some(row_map) = get_map_at(&rows_list, ri) {
                        if let Some(stacks_list) = get_movable_list(&row_map, "stacks") {
                            for si in 0..stacks_list.len() {
                                if let Some(stack_map) = get_map_at(&stacks_list, si) {
                                    if let Some(cols_list) = get_movable_list(&stack_map, "columns")
                                    {
                                        for ci in 0..cols_list.len() {
                                            if let Some(col_map) = get_map_at(&cols_list, ci) {
                                                if let Some(cl) =
                                                    get_movable_list(&col_map, "cards")
                                                {
                                                    result.push(cl);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else if let Some(columns_list) = get_movable_list(&root, "columns") {
            for i in 0..columns_list.len() {
                if let Some(col_map) = get_map_at(&columns_list, i) {
                    if let Some(cl) = get_movable_list(&col_map, "cards") {
                        result.push(cl);
                    }
                }
            }
        }

        result
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    /// Export CRDT state as bytes (snapshot).
    pub fn save(&self) -> io::Result<Vec<u8>> {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.doc.export(ExportMode::Snapshot).map_err(loro_err)
        }));
        match result {
            Ok(inner) => inner,
            Err(payload) => Err(crdt_panic_err("save", payload)),
        }
    }

    /// Load a CrdtStore from snapshot bytes.
    pub fn load(bytes: &[u8]) -> io::Result<Self> {
        let doc = LoroDoc::from_snapshot(bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        doc.set_peer_id(1).map_err(loro_err)?;
        let undo_mgr = UndoManager::new(&doc);
        Ok(CrdtStore { doc, undo_mgr })
    }

    /// Save CRDT state to a file.
    pub fn save_to_file(&self, path: &Path) -> io::Result<()> {
        let bytes = self.save()?;
        std::fs::write(path, bytes)
    }

    /// Load CrdtStore from a file.
    pub fn load_from_file(path: &Path) -> io::Result<Self> {
        let bytes = std::fs::read(path)?;
        Self::load(&bytes)
    }

    /// Update the stored board metadata (yaml_header, kanban_footer, board_settings)
    /// by writing it into the CRDT metadata map.
    pub fn set_metadata(
        &mut self,
        yaml_header: Option<String>,
        kanban_footer: Option<String>,
        board_settings: Option<BoardSettings>,
        generation_meta: Option<GenerationMeta>,
    ) {
        let board_for_meta = KanbanBoard {
            valid: true,
            title: String::new(),
            columns: Vec::new(),
            rows: Vec::new(),
            yaml_header,
            kanban_footer,
            board_settings,
            generation_meta,
            format_hint: BoardFormat::Legacy,
        };
        // Write into CRDT; ignore errors since this is a best-effort setter
        let _ = self.sync_metadata(&board_for_meta);
        self.doc.commit();
    }

    pub fn set_peer_id(&self, peer_id: u64) -> io::Result<()> {
        self.doc
            .set_peer_id(peer_id)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))
    }

    // ── Undo / Redo ──────────────────────────────────────────────────────────

    pub fn undo(&mut self) -> bool {
        self.undo_mgr.undo().unwrap_or(false)
    }

    pub fn redo(&mut self) -> bool {
        self.undo_mgr.redo().unwrap_or(false)
    }

    pub fn can_undo(&self) -> bool {
        self.undo_mgr.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.undo_mgr.can_redo()
    }

    // ── Sync Primitives ─────────────────────────────────────────────────

    /// Return the current operation-log version vector.
    pub fn oplog_vv(&self) -> loro::VersionVector {
        self.doc.oplog_vv()
    }

    /// Export CRDT updates since a given version vector.
    pub fn export_updates_since(&self, vv: &loro::VersionVector) -> Result<Vec<u8>, io::Error> {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.doc
                .export(ExportMode::updates(vv))
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))
        }));
        match result {
            Ok(inner) => inner,
            Err(payload) => Err(crdt_panic_err("export_updates_since", payload)),
        }
    }

    /// Import remote CRDT updates into the local document.
    pub fn import_updates(&mut self, bytes: &[u8]) -> Result<loro::ImportStatus, io::Error> {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.doc
                .import(bytes)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))
        }));
        match result {
            Ok(inner) => inner,
            Err(payload) => Err(crdt_panic_err("import_updates", payload)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_card(kid: &str, content: &str, checked: bool) -> KanbanCard {
        KanbanCard {
            id: "test".to_string(),
            content: content.to_string(),
            checked,
            kid: Some(kid.to_string()),
        }
    }

    fn make_legacy_board(columns: Vec<(&str, Vec<KanbanCard>)>) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: columns
                .into_iter()
                .map(|(title, cards)| KanbanColumn {
                    id: format!("col-{}", title),
                    title: title.to_string(),
                    cards,
                    include_source: None,
                })
                .collect(),
            rows: Vec::new(),
            yaml_header: Some("---\nkanban-plugin: board\n---".to_string()),
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        }
    }

    fn make_new_format_board(
        rows: Vec<(&str, Vec<(&str, Vec<(&str, Vec<KanbanCard>)>)>)>,
    ) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: Vec::new(),
            rows: rows
                .into_iter()
                .map(|(row_title, stacks)| KanbanRow {
                    id: format!("row-{}", row_title),
                    title: row_title.to_string(),
                    stacks: stacks
                        .into_iter()
                        .map(|(stack_title, cols)| KanbanStack {
                            id: format!("stack-{}", stack_title),
                            title: stack_title.to_string(),
                            columns: cols
                                .into_iter()
                                .map(|(col_title, cards)| KanbanColumn {
                                    id: format!("col-{}", col_title),
                                    title: col_title.to_string(),
                                    cards,
                                    include_source: None,
                                })
                                .collect(),
                        })
                        .collect(),
                })
                .collect(),
            yaml_header: Some("---\nkanban-plugin: board\n---".to_string()),
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        }
    }

    #[test]
    fn test_roundtrip_legacy_board() {
        let board = make_legacy_board(vec![
            (
                "Todo",
                vec![
                    make_card("aaaa0001", "Buy groceries", false),
                    make_card("aaaa0002", "Walk the dog", false),
                ],
            ),
            ("Done", vec![make_card("aaaa0003", "Laundry", true)]),
        ]);

        let store = CrdtStore::from_board(&board).unwrap();
        let restored = store.to_board();

        assert_eq!(restored.title, "Test Board");
        assert_eq!(restored.columns.len(), 2);
        assert_eq!(restored.columns[0].title, "Todo");
        assert_eq!(restored.columns[0].cards.len(), 2);
        assert_eq!(restored.columns[1].title, "Done");
        assert_eq!(restored.columns[1].cards.len(), 1);

        assert_eq!(restored.columns[0].cards[0].content, "Buy groceries");
        assert_eq!(
            restored.columns[0].cards[0].kid,
            Some("aaaa0001".to_string())
        );
        assert!(!restored.columns[0].cards[0].checked);

        assert!(restored.columns[1].cards[0].content.contains("Laundry"));
        assert!(restored.columns[1].cards[0].checked);

        // Metadata preserved
        assert_eq!(restored.yaml_header, board.yaml_header);
    }

    #[test]
    fn test_roundtrip_new_format_board() {
        let board = make_new_format_board(vec![(
            "Row 1",
            vec![
                (
                    "Stack A",
                    vec![
                        ("Todo", vec![make_card("aaaa0001", "Task 1", false)]),
                        ("Done", vec![make_card("aaaa0002", "Task 2", true)]),
                    ],
                ),
                (
                    "Stack B",
                    vec![("Review", vec![make_card("aaaa0003", "Task 3", false)])],
                ),
            ],
        )]);

        let store = CrdtStore::from_board(&board).unwrap();
        let restored = store.to_board();

        assert!(restored.columns.is_empty());
        assert_eq!(restored.rows.len(), 1);
        assert_eq!(restored.rows[0].stacks.len(), 2);
        assert_eq!(restored.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(restored.rows[0].stacks[0].columns[0].title, "Todo");
        assert_eq!(restored.rows[0].stacks[0].columns[0].cards.len(), 1);
        assert_eq!(restored.rows[0].stacks[1].columns[0].title, "Review");
    }

    #[test]
    fn test_apply_card_added() {
        let original = make_legacy_board(vec![("Todo", vec![])]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let updated = make_legacy_board(vec![(
            "Todo",
            vec![make_card("aaaa0001", "New task", false)],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.columns[0].cards.len(), 1);
        assert!(result.columns[0].cards[0].content.contains("New task"));
        assert_eq!(result.columns[0].cards[0].kid, Some("aaaa0001".to_string()));
    }

    #[test]
    fn test_apply_card_removed() {
        let original = make_legacy_board(vec![(
            "Todo",
            vec![make_card("aaaa0001", "Task to remove", false)],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let updated = make_legacy_board(vec![("Todo", vec![])]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.columns[0].cards.len(), 0);
    }

    #[test]
    fn test_apply_card_modified() {
        let original = make_legacy_board(vec![(
            "Todo",
            vec![make_card("aaaa0001", "Old content", false)],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let updated = make_legacy_board(vec![(
            "Todo",
            vec![make_card("aaaa0001", "New content", true)],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.columns[0].cards.len(), 1);
        assert!(result.columns[0].cards[0].content.contains("New content"));
        assert!(result.columns[0].cards[0].checked);
    }

    #[test]
    fn test_apply_card_moved() {
        let original = make_legacy_board(vec![
            ("Todo", vec![make_card("aaaa0001", "Task 1", false)]),
            ("Done", vec![]),
        ]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let updated = make_legacy_board(vec![
            ("Todo", vec![]),
            ("Done", vec![make_card("aaaa0001", "Task 1", false)]),
        ]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.columns[0].cards.len(), 0);
        assert_eq!(result.columns[1].cards.len(), 1);
        assert!(result.columns[1].cards[0].content.contains("Task 1"));
    }

    #[test]
    fn test_undo_redo() {
        let original =
            make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])]);
        let mut store = CrdtStore::from_board(&original).unwrap();
        assert!(!store.can_undo()); // Initial state, nothing to undo

        let updated = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("aaaa0001", "Task 1", false),
                make_card("aaaa0002", "Task 2", false),
            ],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let after_add = store.to_board();
        assert_eq!(after_add.columns[0].cards.len(), 2);
        assert!(store.can_undo());

        store.undo();
        let after_undo = store.to_board();
        assert_eq!(after_undo.columns[0].cards.len(), 1);

        assert!(store.can_redo());
        store.redo();
        let after_redo = store.to_board();
        assert_eq!(after_redo.columns[0].cards.len(), 2);
    }

    #[test]
    fn test_persistence_roundtrip() {
        let board = make_legacy_board(vec![
            ("Todo", vec![make_card("aaaa0001", "Task 1", false)]),
            ("Done", vec![make_card("aaaa0002", "Task 2", true)]),
        ]);

        let store = CrdtStore::from_board(&board).unwrap();
        let bytes = store.save().unwrap();

        // Metadata is now in the CRDT, so no need for set_metadata after load
        let restored_store = CrdtStore::load(&bytes).unwrap();
        let restored_board = restored_store.to_board();

        assert_eq!(restored_board.title, "Test Board");
        assert_eq!(restored_board.columns.len(), 2);
        assert_eq!(restored_board.columns[0].cards.len(), 1);
        assert_eq!(restored_board.columns[1].cards.len(), 1);
        assert!(restored_board.columns[0].cards[0]
            .content
            .contains("Task 1"));
        assert!(restored_board.columns[1].cards[0]
            .content
            .contains("Task 2"));
    }

    #[test]
    fn test_oplog_vv_and_export_updates() {
        let board = make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])]);
        let mut store = CrdtStore::from_board(&board).unwrap();

        // Capture VV before change
        let vv_before = store.oplog_vv();

        // Apply a change
        let updated = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("aaaa0001", "Task 1", false),
                make_card("aaaa0002", "Task 2", false),
            ],
        )]);
        store.apply_board(&updated, &board).unwrap();

        // Export delta since the old VV
        let delta = store.export_updates_since(&vv_before).unwrap();
        assert!(!delta.is_empty());

        // Import into a fresh doc that has the same base state
        let mut store2 = CrdtStore::from_board(&board).unwrap();
        let _status = store2.import_updates(&delta).unwrap();
        // After import, store2 should have the same board as store
        let result = store2.to_board();
        assert_eq!(result.columns[0].cards.len(), 2);
        assert!(result.columns[0].cards[1].content.contains("Task 2"));
    }

    #[test]
    fn test_import_updates_server_client_flow() {
        // Simulate the actual sync flow: server creates CRDT, client gets initial
        // state via save/load (shared history), client makes changes, server imports.
        let base = make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])]);
        let mut server_store = CrdtStore::from_board(&base).unwrap();

        // Client gets the initial state (shared history via snapshot)
        let snapshot = server_store.save().unwrap();
        let mut client_store = CrdtStore::load(&snapshot).unwrap();

        let server_vv = server_store.oplog_vv();

        // Client adds a card
        let client_board = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("aaaa0001", "Task 1", false),
                make_card("aaaa0002", "Client card", false),
            ],
        )]);
        client_store.apply_board(&client_board, &base).unwrap();

        // Client exports delta since server's VV
        let delta = client_store.export_updates_since(&server_vv).unwrap();
        assert!(!delta.is_empty());

        // Server imports client changes
        server_store.import_updates(&delta).unwrap();
        let result = server_store.to_board();
        assert_eq!(result.columns[0].cards.len(), 2);
        assert!(result.columns[0].cards[1].content.contains("Client card"));
    }

    #[test]
    fn test_file_persistence_roundtrip() {
        let board = make_legacy_board(vec![(
            "Todo",
            vec![make_card("aaaa0001", "Persistent task", false)],
        )]);

        let store = CrdtStore::from_board(&board).unwrap();
        let tmp = tempfile::NamedTempFile::new().unwrap();
        store.save_to_file(tmp.path()).unwrap();

        // Metadata now persists in CRDT, no need for set_metadata
        let restored = CrdtStore::load_from_file(tmp.path()).unwrap();
        let restored_board = restored.to_board();

        assert_eq!(restored_board.columns[0].cards.len(), 1);
        assert!(restored_board.columns[0].cards[0]
            .content
            .contains("Persistent task"));
    }

    fn make_two_peers(board: &KanbanBoard) -> (CrdtStore, CrdtStore) {
        let peer_a = CrdtStore::from_board(board).unwrap();
        let snapshot = peer_a.save().unwrap();
        let peer_b = CrdtStore::load(&snapshot).unwrap();
        // Metadata is now in the CRDT snapshot, no set_metadata needed
        peer_b.set_peer_id(2).unwrap();
        (peer_a, peer_b)
    }

    fn sync_peers(a: &mut CrdtStore, b: &mut CrdtStore) {
        let vv_a = a.oplog_vv();
        let vv_b = b.oplog_vv();
        let delta_a = a.export_updates_since(&vv_b).unwrap();
        let delta_b = b.export_updates_since(&vv_a).unwrap();
        a.import_updates(&delta_b).unwrap();
        b.import_updates(&delta_a).unwrap();
    }

    fn collect_kids(board: &KanbanBoard) -> std::collections::HashSet<String> {
        board
            .all_columns()
            .iter()
            .flat_map(|col| col.cards.iter())
            .filter_map(|card| card.kid.clone())
            .collect()
    }

    #[test]
    fn test_concurrent_edit_different_cards() {
        let base = make_legacy_board(vec![
            (
                "Todo",
                vec![
                    make_card("aaaa0001", "Card A", false),
                    make_card("aaaa0002", "Card B", false),
                ],
            ),
            ("Done", vec![]),
        ]);
        let (mut peer_a, mut peer_b) = make_two_peers(&base);

        let base_a = peer_a.to_board();
        let mut board_a = base_a.clone();
        board_a.columns[0].cards[0].content = "Card A edited by peer A".to_string();
        peer_a.apply_board(&board_a, &base_a).unwrap();

        let base_b = peer_b.to_board();
        let mut board_b = base_b.clone();
        board_b.columns[0].cards[1].content = "Card B edited by peer B".to_string();
        peer_b.apply_board(&board_b, &base_b).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();

        assert_eq!(result_a.columns[0].cards.len(), 2);
        assert_eq!(result_b.columns[0].cards.len(), 2);

        let a_contents: Vec<&str> = result_a.columns[0]
            .cards
            .iter()
            .map(|c| c.content.as_str())
            .collect();
        let b_contents: Vec<&str> = result_b.columns[0]
            .cards
            .iter()
            .map(|c| c.content.as_str())
            .collect();

        assert!(a_contents.contains(&"Card A edited by peer A"));
        assert!(a_contents.contains(&"Card B edited by peer B"));
        assert_eq!(a_contents, b_contents);
    }

    #[test]
    fn test_concurrent_edit_same_card_lww() {
        let base = make_legacy_board(vec![(
            "Todo",
            vec![make_card("aaaa0001", "Original content", false)],
        )]);
        let (mut peer_a, mut peer_b) = make_two_peers(&base);

        let base_a = peer_a.to_board();
        let mut board_a = base_a.clone();
        board_a.columns[0].cards[0].content = "Peer A version".to_string();
        board_a.columns[0].cards[0].checked = true;
        peer_a.apply_board(&board_a, &base_a).unwrap();

        let base_b = peer_b.to_board();
        let mut board_b = base_b.clone();
        board_b.columns[0].cards[0].content = "Peer B version".to_string();
        peer_b.apply_board(&board_b, &base_b).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();

        assert_eq!(result_a.columns[0].cards.len(), 1);
        assert_eq!(result_b.columns[0].cards.len(), 1);

        let content_a = &result_a.columns[0].cards[0].content;
        let content_b = &result_b.columns[0].cards[0].content;
        assert_eq!(
            content_a, content_b,
            "both peers must converge to the same content"
        );
        assert!(
            content_a == "Peer A version" || content_a == "Peer B version",
            "converged content must be one of the two writes, got: {}",
            content_a
        );

        let checked_a = result_a.columns[0].cards[0].checked;
        let checked_b = result_b.columns[0].cards[0].checked;
        assert_eq!(
            checked_a, checked_b,
            "both peers must converge to the same checked state"
        );

        let kids_a = collect_kids(&result_a);
        let kids_b = collect_kids(&result_b);
        assert_eq!(kids_a, kids_b, "card identities must match after merge");
        assert!(
            kids_a.contains("aaaa0001"),
            "original card identity must survive"
        );
    }

    #[test]
    fn test_concurrent_add_card_and_move_card() {
        let base = make_legacy_board(vec![
            ("Todo", vec![make_card("aaaa0001", "Movable card", false)]),
            ("Done", vec![]),
        ]);
        let (mut peer_a, mut peer_b) = make_two_peers(&base);

        let base_a = peer_a.to_board();
        let board_a = make_legacy_board(vec![
            (
                "Todo",
                vec![
                    make_card("aaaa0001", "Movable card", false),
                    make_card("aaaa0002", "New card by peer A", false),
                ],
            ),
            ("Done", vec![]),
        ]);
        peer_a.apply_board(&board_a, &base_a).unwrap();

        let base_b = peer_b.to_board();
        let board_b = make_legacy_board(vec![
            ("Todo", vec![]),
            ("Done", vec![make_card("aaaa0001", "Movable card", false)]),
        ]);
        peer_b.apply_board(&board_b, &base_b).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();

        let kids_a = collect_kids(&result_a);
        let kids_b = collect_kids(&result_b);
        assert_eq!(kids_a, kids_b, "both peers must have the same set of cards");
        assert!(kids_a.contains("aaaa0001"), "moved card must survive");
        assert!(kids_a.contains("aaaa0002"), "added card must survive");

        let total_cards_a: usize = result_a.all_columns().iter().map(|c| c.cards.len()).sum();
        let total_cards_b: usize = result_b.all_columns().iter().map(|c| c.cards.len()).sum();
        assert_eq!(total_cards_a, 2, "peer A must see exactly 2 cards total");
        assert_eq!(total_cards_b, 2, "peer B must see exactly 2 cards total");
    }

    #[test]
    fn test_concurrent_delete_and_edit_same_card() {
        let base = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("aaaa0001", "Card to conflict", false),
                make_card("aaaa0002", "Survivor card", false),
            ],
        )]);
        let (mut peer_a, mut peer_b) = make_two_peers(&base);

        let base_a = peer_a.to_board();
        let board_a = make_legacy_board(vec![(
            "Todo",
            vec![make_card("aaaa0002", "Survivor card", false)],
        )]);
        peer_a.apply_board(&board_a, &base_a).unwrap();

        let base_b = peer_b.to_board();
        let mut board_b = base_b.clone();
        board_b.columns[0].cards[0].content = "Edited by peer B".to_string();
        board_b.columns[0].cards[0].checked = true;
        peer_b.apply_board(&board_b, &base_b).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();

        let kids_a = collect_kids(&result_a);
        let kids_b = collect_kids(&result_b);
        assert_eq!(
            kids_a, kids_b,
            "both peers must converge to the same card set"
        );

        assert!(kids_a.contains("aaaa0002"), "uncontested card must survive");

        let total_a: usize = result_a.all_columns().iter().map(|c| c.cards.len()).sum();
        let total_b: usize = result_b.all_columns().iter().map(|c| c.cards.len()).sum();
        assert_eq!(
            total_a, total_b,
            "both peers must have the same total card count"
        );
    }

    #[test]
    fn test_legacy_crdt_upgrades_to_new_format_on_row_add() {
        // Simulate: board starts as legacy (flat columns), frontend converts to
        // rows/stacks, then user adds a new row. The CRDT must upgrade format.
        let legacy_board = KanbanBoard {
            valid: true,
            title: "Legacy Board".to_string(),
            columns: vec![
                KanbanColumn {
                    id: "col-1".to_string(),
                    title: "Todo".to_string(),
                    cards: vec![KanbanCard {
                        id: "c1".to_string(),
                        content: "Task A".to_string(),
                        checked: false,
                        kid: Some("aaaa0001".to_string()),
                    }],
                    include_source: None,
                },
                KanbanColumn {
                    id: "col-2".to_string(),
                    title: "Done".to_string(),
                    cards: vec![],
                    include_source: None,
                },
            ],
            rows: vec![], // legacy: no rows
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        };

        let mut store = CrdtStore::from_board(&legacy_board).unwrap();

        // Verify CRDT is in legacy format
        let board = store.to_board();
        assert!(board.rows.is_empty(), "should start as legacy format");
        assert_eq!(board.columns.len(), 2);

        // Frontend converts to new format (as migrateLegacyBoard does):
        let current = store.to_board();
        let incoming = KanbanBoard {
            valid: true,
            title: "Legacy Board".to_string(),
            columns: vec![], // frontend clears this
            rows: vec![
                KanbanRow {
                    id: "row-1".to_string(),
                    title: "Legacy Board".to_string(),
                    stacks: vec![KanbanStack {
                        id: "stack-1".to_string(),
                        title: "Todo".to_string(),
                        columns: vec![
                            KanbanColumn {
                                id: "col-1".to_string(),
                                title: "Todo".to_string(),
                                cards: vec![KanbanCard {
                                    id: "c1".to_string(),
                                    content: "Task A".to_string(),
                                    checked: false,
                                    kid: Some("aaaa0001".to_string()),
                                }],
                                include_source: None,
                            },
                            KanbanColumn {
                                id: "col-2".to_string(),
                                title: "Done".to_string(),
                                cards: vec![],
                                include_source: None,
                            },
                        ],
                    }],
                },
                // User added a new row:
                KanbanRow {
                    id: "row-2".to_string(),
                    title: "New Row".to_string(),
                    stacks: vec![KanbanStack {
                        id: "stack-2".to_string(),
                        title: "Default".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-3".to_string(),
                            title: "New Column".to_string(),
                            cards: vec![],
                            include_source: None,
                        }],
                    }],
                },
            ],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        };

        store.apply_board(&incoming, &current).unwrap();

        // Verify CRDT upgraded to new format
        let result = store.to_board();
        assert!(!result.rows.is_empty(), "CRDT must upgrade to new format");
        assert_eq!(result.rows.len(), 2, "must have both rows");
        assert_eq!(result.rows[0].title, "Legacy Board");
        assert_eq!(result.rows[1].title, "New Row");

        // Verify cards survived the format upgrade
        let all_cards: Vec<&KanbanCard> = result
            .all_columns()
            .iter()
            .flat_map(|c| c.cards.iter())
            .collect();
        assert!(
            all_cards.iter().any(|c| c.content == "Task A"),
            "existing card must survive format upgrade"
        );

        // Verify column structure
        assert_eq!(result.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(result.rows[1].stacks[0].columns.len(), 1);
        assert_eq!(result.rows[1].stacks[0].columns[0].title, "New Column");
    }

    // ── Metadata CRDT tests ─────────────────────────────────────────────────

    #[test]
    fn test_metadata_title_syncs_through_crdt() {
        let mut board =
            make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task", false)])]);
        board.title = "Original Title".to_string();
        let (mut peer_a, mut peer_b) = make_two_peers(&board);

        // Peer A changes the title
        let base_a = peer_a.to_board();
        let mut updated_a = base_a.clone();
        updated_a.title = "Title from Peer A".to_string();
        peer_a.apply_board(&updated_a, &base_a).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();
        assert_eq!(
            result_a.title, result_b.title,
            "title must converge across peers"
        );
        assert_eq!(result_a.title, "Title from Peer A");
    }

    #[test]
    fn test_metadata_settings_sync_through_crdt() {
        let mut board =
            make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task", false)])]);
        board.board_settings = Some(BoardSettings {
            column_width: Some("200px".to_string()),
            ..Default::default()
        });

        let (mut peer_a, mut peer_b) = make_two_peers(&board);

        // Verify initial settings roundtrip
        let initial_a = peer_a.to_board();
        let initial_b = peer_b.to_board();
        assert_eq!(
            initial_a.board_settings.as_ref().unwrap().column_width,
            Some("200px".to_string())
        );
        assert_eq!(
            initial_b.board_settings.as_ref().unwrap().column_width,
            Some("200px".to_string())
        );

        // Peer A changes column_width
        let base_a = peer_a.to_board();
        let mut updated_a = base_a.clone();
        updated_a.board_settings = Some(BoardSettings {
            column_width: Some("300px".to_string()),
            font_size: Some("14px".to_string()),
            ..Default::default()
        });
        peer_a.apply_board(&updated_a, &base_a).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();
        assert_eq!(
            result_a.board_settings, result_b.board_settings,
            "settings must converge across peers"
        );
        let settings = result_a.board_settings.unwrap();
        assert_eq!(settings.column_width, Some("300px".to_string()));
        assert_eq!(settings.font_size, Some("14px".to_string()));
    }

    #[test]
    fn test_metadata_footer_syncs_through_crdt() {
        let mut board =
            make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task", false)])]);
        board.kanban_footer = Some("Original footer".to_string());

        let (mut peer_a, mut peer_b) = make_two_peers(&board);

        // Verify initial footer roundtrip
        assert_eq!(
            peer_a.to_board().kanban_footer,
            Some("Original footer".to_string())
        );

        // Peer A changes footer
        let base_a = peer_a.to_board();
        let mut updated_a = base_a.clone();
        updated_a.kanban_footer = Some("Updated footer from A".to_string());
        peer_a.apply_board(&updated_a, &base_a).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();
        assert_eq!(
            result_a.kanban_footer, result_b.kanban_footer,
            "footer must converge across peers"
        );
        assert_eq!(
            result_a.kanban_footer,
            Some("Updated footer from A".to_string())
        );
    }

    #[test]
    fn test_metadata_yaml_header_syncs_through_crdt() {
        let mut board =
            make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task", false)])]);
        board.yaml_header = Some("---\nkanban-plugin: board\n---".to_string());

        let (mut peer_a, mut peer_b) = make_two_peers(&board);

        // Peer A changes yaml header
        let base_a = peer_a.to_board();
        let mut updated_a = base_a.clone();
        updated_a.yaml_header =
            Some("---\nkanban-plugin: board\ncustomKey: value\n---".to_string());
        peer_a.apply_board(&updated_a, &base_a).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();
        assert_eq!(
            result_a.yaml_header, result_b.yaml_header,
            "yaml_header must converge across peers"
        );
        assert_eq!(
            result_a.yaml_header,
            Some("---\nkanban-plugin: board\ncustomKey: value\n---".to_string())
        );
    }

    #[test]
    fn test_metadata_persists_through_save_load() {
        let mut board =
            make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task", false)])]);
        board.yaml_header = Some("---\nkanban-plugin: board\n---".to_string());
        board.kanban_footer = Some("My footer".to_string());
        board.board_settings = Some(BoardSettings {
            column_width: Some("250px".to_string()),
            font_size: Some("16px".to_string()),
            board_color: Some("#ff0000".to_string()),
            ..Default::default()
        });

        let store = CrdtStore::from_board(&board).unwrap();
        let bytes = store.save().unwrap();

        // Load from snapshot -- metadata should be in CRDT, no set_metadata needed
        let restored = CrdtStore::load(&bytes).unwrap();
        let restored_board = restored.to_board();

        assert_eq!(restored_board.yaml_header, board.yaml_header);
        assert_eq!(restored_board.kanban_footer, board.kanban_footer);
        assert_eq!(restored_board.board_settings, board.board_settings);
    }

    #[test]
    fn test_legacy_crdt_without_metadata_upgrades_gracefully() {
        // Board with no metadata
        let board_no_meta = KanbanBoard {
            valid: true,
            title: "Legacy".to_string(),
            columns: vec![KanbanColumn {
                id: "col-1".to_string(),
                title: "Todo".to_string(),
                cards: vec![make_card("aaaa0001", "Task", false)],
                include_source: None,
            }],
            rows: vec![],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        };

        let mut store = CrdtStore::from_board(&board_no_meta).unwrap();

        // to_board should work fine with empty metadata
        let current = store.to_board();
        assert!(current.yaml_header.is_none());
        assert!(current.kanban_footer.is_none());
        assert!(current.board_settings.is_none());

        // Now apply a board that has metadata
        let incoming = KanbanBoard {
            valid: true,
            title: "Legacy".to_string(),
            columns: vec![KanbanColumn {
                id: "col-1".to_string(),
                title: "Todo".to_string(),
                cards: vec![make_card("aaaa0001", "Task", false)],
                include_source: None,
            }],
            rows: vec![],
            yaml_header: Some("---\nkanban-plugin: board\n---".to_string()),
            kanban_footer: Some("New footer".to_string()),
            board_settings: Some(BoardSettings {
                column_width: Some("300px".to_string()),
                ..Default::default()
            }),
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        };

        store.apply_board(&incoming, &current).unwrap();

        let result = store.to_board();
        assert_eq!(
            result.yaml_header,
            Some("---\nkanban-plugin: board\n---".to_string())
        );
        assert_eq!(result.kanban_footer, Some("New footer".to_string()));
        assert_eq!(
            result.board_settings.as_ref().unwrap().column_width,
            Some("300px".to_string())
        );
    }

    #[test]
    fn test_concurrent_settings_changes_merge() {
        // Two peers change different settings fields concurrently.
        // Since each field is its own key in the CRDT map, both changes should merge.
        let mut board =
            make_legacy_board(vec![("Todo", vec![make_card("aaaa0001", "Task", false)])]);
        board.board_settings = Some(BoardSettings::default());

        let (mut peer_a, mut peer_b) = make_two_peers(&board);

        // Peer A changes font_size
        let base_a = peer_a.to_board();
        let mut updated_a = base_a.clone();
        updated_a.board_settings = Some(BoardSettings {
            font_size: Some("18px".to_string()),
            ..Default::default()
        });
        peer_a.apply_board(&updated_a, &base_a).unwrap();

        // Peer B changes column_width
        let base_b = peer_b.to_board();
        let mut updated_b = base_b.clone();
        updated_b.board_settings = Some(BoardSettings {
            column_width: Some("400px".to_string()),
            ..Default::default()
        });
        peer_b.apply_board(&updated_b, &base_b).unwrap();

        sync_peers(&mut peer_a, &mut peer_b);

        let result_a = peer_a.to_board();
        let result_b = peer_b.to_board();

        // Both peers should see both settings
        assert_eq!(
            result_a.board_settings, result_b.board_settings,
            "settings must converge across peers"
        );
        let settings = result_a.board_settings.unwrap();
        assert_eq!(settings.font_size, Some("18px".to_string()));
        assert_eq!(settings.column_width, Some("400px".to_string()));
    }

    // ── Round-trip ordering tests ────────────────────────────────────────
    // These test the exact scenario that causes the "content moves after save"
    // bug: apply_board → to_board must produce the SAME ordering as the input.

    /// Helper: extract ordered card kids from a board (flattened across all columns).
    fn card_order(board: &KanbanBoard) -> Vec<String> {
        board
            .all_columns()
            .iter()
            .flat_map(|col| col.cards.iter())
            .filter_map(|c| c.kid.clone())
            .collect()
    }

    /// Helper: extract ordered column titles from a board (flattened).
    fn column_order(board: &KanbanBoard) -> Vec<String> {
        board
            .all_columns()
            .iter()
            .map(|col| col.title.clone())
            .collect()
    }

    /// Helper: extract ordered card kids per column.
    fn cards_per_column(board: &KanbanBoard) -> Vec<(String, Vec<String>)> {
        board
            .all_columns()
            .iter()
            .map(|col| {
                let kids: Vec<String> = col.cards.iter().filter_map(|c| c.kid.clone()).collect();
                (col.title.clone(), kids)
            })
            .collect()
    }

    #[test]
    fn test_roundtrip_card_reorder_within_column() {
        // Cards [A, B, C] in a column → reorder to [C, A, B]
        let original = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("k001", "Card A", false),
                make_card("k002", "Card B", false),
                make_card("k003", "Card C", false),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let reordered = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("k003", "Card C", false),
                make_card("k001", "Card A", false),
                make_card("k002", "Card B", false),
            ],
        )]);

        store.apply_board(&reordered, &original).unwrap();
        let result = store.to_board();

        assert_eq!(
            card_order(&result),
            vec!["k003", "k001", "k002"],
            "CRDT must preserve card reorder within a column"
        );
    }

    #[test]
    fn test_roundtrip_card_move_to_specific_position() {
        // Move last card to the front of another column
        let original = make_legacy_board(vec![
            (
                "Todo",
                vec![
                    make_card("k001", "Card A", false),
                    make_card("k002", "Card B", false),
                ],
            ),
            (
                "Done",
                vec![
                    make_card("k003", "Card C", true),
                    make_card("k004", "Card D", true),
                ],
            ),
        ]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Move k002 from Todo to the front of Done
        let updated = make_legacy_board(vec![
            ("Todo", vec![make_card("k001", "Card A", false)]),
            (
                "Done",
                vec![
                    make_card("k002", "Card B", false),
                    make_card("k003", "Card C", true),
                    make_card("k004", "Card D", true),
                ],
            ),
        ]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(
            cards_per_column(&result),
            vec![
                ("Todo".to_string(), vec!["k001".to_string()]),
                (
                    "Done".to_string(),
                    vec!["k002".to_string(), "k003".to_string(), "k004".to_string()]
                ),
            ],
            "CRDT must place moved card at exact position"
        );
    }

    #[test]
    fn test_roundtrip_column_reorder_legacy() {
        let original = make_legacy_board(vec![
            ("Alpha", vec![make_card("k001", "A1", false)]),
            ("Beta", vec![make_card("k002", "B1", false)]),
            ("Gamma", vec![make_card("k003", "G1", false)]),
        ]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Reorder columns: Gamma, Alpha, Beta
        let reordered = make_legacy_board(vec![
            ("Gamma", vec![make_card("k003", "G1", false)]),
            ("Alpha", vec![make_card("k001", "A1", false)]),
            ("Beta", vec![make_card("k002", "B1", false)]),
        ]);

        store.apply_board(&reordered, &original).unwrap();
        let result = store.to_board();

        assert_eq!(
            column_order(&result),
            vec!["Gamma", "Alpha", "Beta"],
            "CRDT must preserve column reorder (legacy format)"
        );
        // Cards stay with their columns
        assert_eq!(
            cards_per_column(&result),
            vec![
                ("Gamma".to_string(), vec!["k003".to_string()]),
                ("Alpha".to_string(), vec!["k001".to_string()]),
                ("Beta".to_string(), vec!["k002".to_string()]),
            ]
        );
    }

    #[test]
    fn test_roundtrip_column_reorder_new_format() {
        let original = make_new_format_board(vec![(
            "Main",
            vec![(
                "Stack1",
                vec![
                    ("Col-A", vec![make_card("k001", "A1", false)]),
                    ("Col-B", vec![make_card("k002", "B1", false)]),
                    ("Col-C", vec![make_card("k003", "C1", false)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Reorder columns within the stack: C, A, B
        let reordered = make_new_format_board(vec![(
            "Main",
            vec![(
                "Stack1",
                vec![
                    ("Col-C", vec![make_card("k003", "C1", false)]),
                    ("Col-A", vec![make_card("k001", "A1", false)]),
                    ("Col-B", vec![make_card("k002", "B1", false)]),
                ],
            )],
        )]);

        store.apply_board(&reordered, &original).unwrap();
        let result = store.to_board();

        assert_eq!(
            column_order(&result),
            vec!["Col-C", "Col-A", "Col-B"],
            "CRDT must preserve column reorder (new format)"
        );
    }

    #[test]
    fn test_roundtrip_row_reorder() {
        let original = make_new_format_board(vec![
            (
                "Row1",
                vec![("S1", vec![("C1", vec![make_card("k001", "R1", false)])])],
            ),
            (
                "Row2",
                vec![("S2", vec![("C2", vec![make_card("k002", "R2", false)])])],
            ),
            (
                "Row3",
                vec![("S3", vec![("C3", vec![make_card("k003", "R3", false)])])],
            ),
        ]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Reorder rows: Row3, Row1, Row2
        let reordered = make_new_format_board(vec![
            (
                "Row3",
                vec![("S3", vec![("C3", vec![make_card("k003", "R3", false)])])],
            ),
            (
                "Row1",
                vec![("S1", vec![("C1", vec![make_card("k001", "R1", false)])])],
            ),
            (
                "Row2",
                vec![("S2", vec![("C2", vec![make_card("k002", "R2", false)])])],
            ),
        ]);

        store.apply_board(&reordered, &original).unwrap();
        let result = store.to_board();

        let row_titles: Vec<String> = result.rows.iter().map(|r| r.title.clone()).collect();
        assert_eq!(
            row_titles,
            vec!["Row3", "Row1", "Row2"],
            "CRDT must preserve row reorder"
        );
    }

    #[test]
    fn test_roundtrip_stack_reorder() {
        let original = make_new_format_board(vec![(
            "Row1",
            vec![
                ("StackA", vec![("CA", vec![make_card("k001", "A", false)])]),
                ("StackB", vec![("CB", vec![make_card("k002", "B", false)])]),
                ("StackC", vec![("CC", vec![make_card("k003", "C", false)])]),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Reorder stacks: C, A, B
        let reordered = make_new_format_board(vec![(
            "Row1",
            vec![
                ("StackC", vec![("CC", vec![make_card("k003", "C", false)])]),
                ("StackA", vec![("CA", vec![make_card("k001", "A", false)])]),
                ("StackB", vec![("CB", vec![make_card("k002", "B", false)])]),
            ],
        )]);

        store.apply_board(&reordered, &original).unwrap();
        let result = store.to_board();

        let stack_titles: Vec<String> = result.rows[0]
            .stacks
            .iter()
            .map(|s| s.title.clone())
            .collect();
        assert_eq!(
            stack_titles,
            vec!["StackC", "StackA", "StackB"],
            "CRDT must preserve stack reorder"
        );
    }

    #[test]
    fn test_repeated_apply_is_idempotent() {
        // Applying the same board twice must produce the same result.
        let original = make_legacy_board(vec![
            (
                "Todo",
                vec![
                    make_card("k001", "Card A", false),
                    make_card("k002", "Card B", false),
                    make_card("k003", "Card C", false),
                ],
            ),
            ("Done", vec![make_card("k004", "Card D", true)]),
        ]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Reorder cards
        let v2 = make_legacy_board(vec![
            (
                "Todo",
                vec![
                    make_card("k003", "Card C", false),
                    make_card("k001", "Card A", false),
                ],
            ),
            (
                "Done",
                vec![
                    make_card("k002", "Card B", true),
                    make_card("k004", "Card D", true),
                ],
            ),
        ]);

        store.apply_board(&v2, &original).unwrap();
        let after_first = store.to_board();

        // Apply the exact same board again (simulates double-save)
        store.apply_board(&v2, &v2).unwrap();
        let after_second = store.to_board();

        assert_eq!(
            cards_per_column(&after_first),
            cards_per_column(&after_second),
            "applying the same board twice must be idempotent"
        );
    }

    #[test]
    fn test_write_board_internal_roundtrip_preserves_order() {
        // Simulates the full write_board_internal path:
        // 1. Create CRDT from base board
        // 2. apply_board with reordered cards
        // 3. to_board must match the reordered input
        let base = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("k001", "First", false),
                make_card("k002", "Second", false),
                make_card("k003", "Third", false),
                make_card("k004", "Fourth", false),
            ],
        )]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // User reverses the card order
        let user_board = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("k004", "Fourth", false),
                make_card("k003", "Third", false),
                make_card("k002", "Second", false),
                make_card("k001", "First", false),
            ],
        )]);

        // This is what write_board_internal does:
        let current = store.to_board();
        store.apply_board(&user_board, &current).unwrap();
        let result = store.to_board();

        assert_eq!(
            card_order(&result),
            vec!["k004", "k003", "k002", "k001"],
            "CRDT must preserve reversed card order after write_board_internal flow"
        );
    }

    #[test]
    fn test_add_card_preserves_existing_order() {
        // Adding a new card must not disturb existing card order
        let original = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("k003", "Third", false),
                make_card("k001", "First", false),
                make_card("k002", "Second", false),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Add a new card at position 1 (between Third and First)
        let updated = make_legacy_board(vec![(
            "Todo",
            vec![
                make_card("k003", "Third", false),
                make_card("k005", "New card", false),
                make_card("k001", "First", false),
                make_card("k002", "Second", false),
            ],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(
            card_order(&result),
            vec!["k003", "k005", "k001", "k002"],
            "new card must appear at correct position without disturbing order"
        );
    }

    // ── Cross-container move tests ───────────────────────────────────

    #[test]
    fn test_column_move_between_stacks_preserves_cards() {
        let original = make_new_format_board(vec![(
            "Row1",
            vec![
                (
                    "StackA",
                    vec![
                        (
                            "ColX",
                            vec![
                                make_card("k001", "Card 1", false),
                                make_card("k002", "Card 2", true),
                            ],
                        ),
                        ("ColY", vec![make_card("k003", "Card 3", false)]),
                    ],
                ),
                (
                    "StackB",
                    vec![("ColZ", vec![make_card("k004", "Card 4", false)])],
                ),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Move ColX from StackA to StackB
        let updated = make_new_format_board(vec![(
            "Row1",
            vec![
                (
                    "StackA",
                    vec![("ColY", vec![make_card("k003", "Card 3", false)])],
                ),
                (
                    "StackB",
                    vec![
                        ("ColZ", vec![make_card("k004", "Card 4", false)]),
                        (
                            "ColX",
                            vec![
                                make_card("k001", "Card 1", false),
                                make_card("k002", "Card 2", true),
                            ],
                        ),
                    ],
                ),
            ],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(
            result.rows[0].stacks[0].columns.len(),
            1,
            "StackA should have 1 column"
        );
        assert_eq!(result.rows[0].stacks[0].columns[0].title, "ColY");
        assert_eq!(
            result.rows[0].stacks[1].columns.len(),
            2,
            "StackB should have 2 columns"
        );
        assert_eq!(result.rows[0].stacks[1].columns[0].title, "ColZ");
        assert_eq!(result.rows[0].stacks[1].columns[1].title, "ColX");
        // Verify cards preserved
        let col_x = &result.rows[0].stacks[1].columns[1];
        assert_eq!(col_x.cards.len(), 2, "ColX must keep its 2 cards");
        assert_eq!(col_x.cards[0].kid.as_deref(), Some("k001"));
        assert_eq!(col_x.cards[1].kid.as_deref(), Some("k002"));
    }

    #[test]
    fn test_stack_move_between_rows_preserves_columns_and_cards() {
        let original = make_new_format_board(vec![
            (
                "Row1",
                vec![
                    (
                        "StackA",
                        vec![("ColA", vec![make_card("k001", "A", false)])],
                    ),
                    (
                        "StackB",
                        vec![("ColB", vec![make_card("k002", "B", false)])],
                    ),
                ],
            ),
            (
                "Row2",
                vec![(
                    "StackC",
                    vec![("ColC", vec![make_card("k003", "C", false)])],
                )],
            ),
        ]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Move StackB from Row1 to Row2
        let updated = make_new_format_board(vec![
            (
                "Row1",
                vec![(
                    "StackA",
                    vec![("ColA", vec![make_card("k001", "A", false)])],
                )],
            ),
            (
                "Row2",
                vec![
                    (
                        "StackC",
                        vec![("ColC", vec![make_card("k003", "C", false)])],
                    ),
                    (
                        "StackB",
                        vec![("ColB", vec![make_card("k002", "B", false)])],
                    ),
                ],
            ),
        ]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 1, "Row1 should have 1 stack");
        assert_eq!(result.rows[0].stacks[0].title, "StackA");
        assert_eq!(result.rows[1].stacks.len(), 2, "Row2 should have 2 stacks");
        assert_eq!(result.rows[1].stacks[0].title, "StackC");
        assert_eq!(result.rows[1].stacks[1].title, "StackB");
        // Verify cards preserved in moved stack
        let stack_b = &result.rows[1].stacks[1];
        assert_eq!(stack_b.columns[0].title, "ColB");
        assert_eq!(stack_b.columns[0].cards.len(), 1);
        assert_eq!(stack_b.columns[0].cards[0].kid.as_deref(), Some("k002"));
    }

    #[test]
    fn test_column_move_with_simultaneous_card_edit() {
        let original = make_new_format_board(vec![(
            "Row1",
            vec![
                (
                    "SA",
                    vec![("C1", vec![make_card("k001", "Old content", false)])],
                ),
                ("SB", vec![("C2", vec![])]),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Move C1 to SB AND change card content
        let updated = make_new_format_board(vec![(
            "Row1",
            vec![
                ("SA", vec![]),
                (
                    "SB",
                    vec![
                        ("C2", vec![]),
                        ("C1", vec![make_card("k001", "New content", true)]),
                    ],
                ),
            ],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(
            result.rows[0].stacks[0].columns.len(),
            0,
            "SA should be empty"
        );
        assert_eq!(
            result.rows[0].stacks[1].columns.len(),
            2,
            "SB should have 2 columns"
        );
        let c1 = &result.rows[0].stacks[1].columns[1];
        assert_eq!(c1.title, "C1");
        assert_eq!(c1.cards.len(), 1);
        // Card content may be from CRDT extract (Old) or from diff (New) — either
        // is acceptable since the diff handler will update it. The key is the card
        // exists and the column moved.
        assert_eq!(c1.cards[0].kid.as_deref(), Some("k001"));
    }

    #[test]
    fn test_multiple_columns_swap_stacks() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![
                ("SA", vec![("C1", vec![make_card("k001", "A", false)])]),
                ("SB", vec![("C2", vec![make_card("k002", "B", false)])]),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Swap: C1 goes to SB, C2 goes to SA
        let updated = make_new_format_board(vec![(
            "R1",
            vec![
                ("SA", vec![("C2", vec![make_card("k002", "B", false)])]),
                ("SB", vec![("C1", vec![make_card("k001", "A", false)])]),
            ],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns[0].title, "C2");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
        assert_eq!(result.rows[0].stacks[1].columns[0].title, "C1");
        assert_eq!(
            result.rows[0].stacks[1].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
    }

    #[test]
    fn test_column_move_to_newly_created_stack() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "SA",
                vec![
                    ("C1", vec![make_card("k001", "A", false)]),
                    ("C2", vec![make_card("k002", "B", false)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Move C2 to a new stack SB (that didn't exist before)
        let updated = make_new_format_board(vec![(
            "R1",
            vec![
                ("SA", vec![("C1", vec![make_card("k001", "A", false)])]),
                ("SB", vec![("C2", vec![make_card("k002", "B", false)])]),
            ],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 2);
        assert_eq!(result.rows[0].stacks[0].columns[0].title, "C1");
        assert_eq!(result.rows[0].stacks[1].title, "SB");
        assert_eq!(result.rows[0].stacks[1].columns[0].title, "C2");
        assert_eq!(
            result.rows[0].stacks[1].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_stack_move_to_newly_created_row() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![
                ("SA", vec![("C1", vec![make_card("k001", "A", false)])]),
                ("SB", vec![("C2", vec![make_card("k002", "B", false)])]),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Move SB to a new row R2 (that didn't exist before)
        let updated = make_new_format_board(vec![
            (
                "R1",
                vec![("SA", vec![("C1", vec![make_card("k001", "A", false)])])],
            ),
            (
                "R2",
                vec![("SB", vec![("C2", vec![make_card("k002", "B", false)])])],
            ),
        ]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0].stacks.len(), 1);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(result.rows[1].stacks.len(), 1);
        assert_eq!(result.rows[1].stacks[0].title, "SB");
        assert_eq!(
            result.rows[1].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_no_cross_container_move_is_noop() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![("SA", vec![("C1", vec![make_card("k001", "A", false)])])],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Same structure, just modify card content
        let updated = make_new_format_board(vec![(
            "R1",
            vec![(
                "SA",
                vec![("C1", vec![make_card("k001", "A modified", false)])],
            )],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 1);
        assert_eq!(result.rows[0].stacks[0].columns.len(), 1);
        assert_eq!(result.rows[0].stacks[0].columns[0].cards.len(), 1);
    }

    #[test]
    fn test_unpark_last_stack_preserves_position() {
        // Simulates unparking: the last stack has a hidden tag in its title.
        // Unpark = remove the tag. Stack must stay at the last position.
        // IMPORTANT: IDs stay the same (only title changes), matching real app behavior.
        let parked = KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: Vec::new(),
            rows: vec![KanbanRow {
                id: "row-1".to_string(),
                title: "Row1".to_string(),
                stacks: vec![
                    KanbanStack {
                        id: "stack-1".to_string(),
                        title: "SA".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-1".to_string(),
                            title: "C1".to_string(),
                            cards: vec![make_card("k001", "A", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-2".to_string(),
                        title: "SB".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-2".to_string(),
                            title: "C2".to_string(),
                            cards: vec![make_card("k002", "B", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-3".to_string(),
                        title: "SC !!!park!!!".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-3".to_string(),
                            title: "C3".to_string(),
                            cards: vec![make_card("k003", "C", false)],
                            include_source: None,
                        }],
                    },
                ],
            }],
            yaml_header: Some("---\nkanban-plugin: board\n---".to_string()),
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        };
        let mut store = CrdtStore::from_board(&parked).unwrap();

        // Unpark: same board but title changed from "SC !!!park!!!" to "SC"
        // All IDs stay the same.
        let mut unparked = parked.clone();
        unparked.rows[0].stacks[2].title = "SC".to_string();

        store.apply_board(&unparked, &parked).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 3);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(result.rows[0].stacks[1].title, "SB");
        assert_eq!(
            result.rows[0].stacks[2].title, "SC",
            "Unparked stack must remain at the last position"
        );
        assert_eq!(
            result.rows[0].stacks[2].columns[0].cards[0].kid.as_deref(),
            Some("k003")
        );
    }

    #[test]
    fn test_unpark_last_stack_with_real_tag_preserves_position() {
        // Uses #hidden-internal-parked (the actual tag used by the frontend).
        // Verifies the CRDT handles the # character in titles correctly.
        let parked = KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: Vec::new(),
            rows: vec![KanbanRow {
                id: "row-1".to_string(),
                title: "Row1".to_string(),
                stacks: vec![
                    KanbanStack {
                        id: "stack-1".to_string(),
                        title: "SA".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-1".to_string(),
                            title: "C1".to_string(),
                            cards: vec![make_card("k001", "A", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-2".to_string(),
                        title: "SB".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-2".to_string(),
                            title: "C2".to_string(),
                            cards: vec![make_card("k002", "B", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-3".to_string(),
                        title: "SC #hidden-internal-parked".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-3".to_string(),
                            title: "C3".to_string(),
                            cards: vec![make_card("k003", "C", false)],
                            include_source: None,
                        }],
                    },
                ],
            }],
            yaml_header: Some("---\nkanban-plugin: board\n---".to_string()),
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        };
        let mut store = CrdtStore::from_board(&parked).unwrap();

        // Unpark: remove the tag
        let mut unparked = parked.clone();
        unparked.rows[0].stacks[2].title = "SC".to_string();

        store.apply_board(&unparked, &parked).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 3);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(result.rows[0].stacks[1].title, "SB");
        assert_eq!(
            result.rows[0].stacks[2].title, "SC",
            "Unparked stack with #hidden-internal-parked must remain at the last position"
        );
        assert_eq!(
            result.rows[0].stacks[2].columns[0].cards[0].kid.as_deref(),
            Some("k003")
        );
    }

    #[test]
    fn test_unpark_after_new_stack_added_preserves_order() {
        // Scenario: [SA, SB, SC-parked], user adds SD at end, then unparks SC
        // After: [SA, SB, SC-parked, SD] → unpark SC → [SA, SB, SC, SD]
        // SC must stay at position 2, SD at position 3.
        let initial = KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: Vec::new(),
            rows: vec![KanbanRow {
                id: "row-1".to_string(),
                title: "Row1".to_string(),
                stacks: vec![
                    KanbanStack {
                        id: "stack-1".to_string(),
                        title: "SA".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-1".to_string(),
                            title: "C1".to_string(),
                            cards: vec![make_card("k001", "A", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-2".to_string(),
                        title: "SB".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-2".to_string(),
                            title: "C2".to_string(),
                            cards: vec![make_card("k002", "B", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-3".to_string(),
                        title: "SC #hidden-internal-parked".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-3".to_string(),
                            title: "C3".to_string(),
                            cards: vec![make_card("k003", "C", false)],
                            include_source: None,
                        }],
                    },
                ],
            }],
            yaml_header: Some("---\nkanban-plugin: board\n---".to_string()),
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        };
        let mut store = CrdtStore::from_board(&initial).unwrap();

        // Step 1: User adds SD at the end (while SC is still parked)
        let mut with_sd = initial.clone();
        with_sd.rows[0].stacks.push(KanbanStack {
            id: "stack-4".to_string(),
            title: "SD".to_string(),
            columns: vec![KanbanColumn {
                id: "col-4".to_string(),
                title: "C4".to_string(),
                cards: vec![make_card("k004", "D", false)],
                include_source: None,
            }],
        });
        store.apply_board(&with_sd, &initial).unwrap();
        let after_add = store.to_board();
        assert_eq!(after_add.rows[0].stacks.len(), 4);
        assert_eq!(after_add.rows[0].stacks[3].title, "SD");

        // Step 2: Unpark SC
        let mut unparked = after_add.clone();
        unparked.rows[0].stacks[2].title = "SC".to_string();

        store.apply_board(&unparked, &after_add).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 4);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(result.rows[0].stacks[1].title, "SB");
        assert_eq!(
            result.rows[0].stacks[2].title, "SC",
            "Unparked SC must stay at original position 2"
        );
        assert_eq!(
            result.rows[0].stacks[3].title, "SD",
            "SD must remain at position 3 (last)"
        );
    }

    #[test]
    fn test_park_then_unpark_last_stack_multi_step_roundtrip() {
        // Full multi-step roundtrip: park → save → unpark → save
        // The last stack should stay at the last position throughout.
        let original = KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: Vec::new(),
            rows: vec![KanbanRow {
                id: "row-1".to_string(),
                title: "Row1".to_string(),
                stacks: vec![
                    KanbanStack {
                        id: "stack-1".to_string(),
                        title: "SA".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-1".to_string(),
                            title: "C1".to_string(),
                            cards: vec![make_card("k001", "A", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-2".to_string(),
                        title: "SB".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-2".to_string(),
                            title: "C2".to_string(),
                            cards: vec![make_card("k002", "B", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-3".to_string(),
                        title: "SC".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-3".to_string(),
                            title: "C3".to_string(),
                            cards: vec![make_card("k003", "C", false)],
                            include_source: None,
                        }],
                    },
                ],
            }],
            yaml_header: Some("---\nkanban-plugin: board\n---".to_string()),
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        };
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Step 1: Park SC (last stack)
        let mut parked = original.clone();
        parked.rows[0].stacks[2].title = "SC #hidden-internal-parked".to_string();
        store.apply_board(&parked, &original).unwrap();
        let after_park = store.to_board();
        assert_eq!(
            after_park.rows[0].stacks[2].title,
            "SC #hidden-internal-parked"
        );

        // Step 2: Unpark SC
        let mut unparked = after_park.clone();
        unparked.rows[0].stacks[2].title = "SC".to_string();
        store.apply_board(&unparked, &after_park).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 3);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(result.rows[0].stacks[1].title, "SB");
        assert_eq!(
            result.rows[0].stacks[2].title, "SC",
            "After park→unpark roundtrip, SC must remain at position 2 (last)"
        );
        assert_eq!(
            result.rows[0].stacks[2].columns[0].cards[0].kid.as_deref(),
            Some("k003")
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Column lifecycle
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_column_add_preserves_existing_cards() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "S1",
                vec![("ColA", vec![make_card("k001", "Task 1", false)])],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows[0].stacks[0].columns.push(KanbanColumn {
            id: "col-ColB".to_string(),
            title: "ColB".to_string(),
            cards: vec![make_card("k002", "Task 2", false)],
            include_source: None,
        });

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(result.rows[0].stacks[0].columns[0].title, "ColA");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[0].stacks[0].columns[1].title, "ColB");
        assert_eq!(
            result.rows[0].stacks[0].columns[1].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_column_delete_preserves_sibling_columns() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "S1",
                vec![
                    ("ColA", vec![make_card("k001", "A1", false)]),
                    ("ColB", vec![make_card("k002", "B1", false)]),
                    ("ColC", vec![make_card("k003", "C1", false)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows[0].stacks[0].columns.remove(1); // Remove ColB

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(result.rows[0].stacks[0].columns[0].title, "ColA");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[0].stacks[0].columns[1].title, "ColC");
        assert_eq!(
            result.rows[0].stacks[0].columns[1].cards[0].kid.as_deref(),
            Some("k003")
        );
    }

    #[test]
    fn test_column_title_rename_preserves_cards() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "S1",
                vec![(
                    "Todo",
                    vec![
                        make_card("k001", "Task", false),
                        make_card("k002", "Task2", true),
                    ],
                )],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows[0].stacks[0].columns[0].title = "Done".to_string();

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns[0].title, "Done");
        assert_eq!(result.rows[0].stacks[0].columns[0].cards.len(), 2);
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[0].stacks[0].columns[0].cards[1].checked, true);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Stack lifecycle
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_stack_add_preserves_existing_stacks() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![("SA", vec![("ColA", vec![make_card("k001", "Task", false)])])],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows[0].stacks.push(KanbanStack {
            id: "stack-SB".to_string(),
            title: "SB".to_string(),
            columns: vec![KanbanColumn {
                id: "col-ColB".to_string(),
                title: "ColB".to_string(),
                cards: vec![make_card("k002", "New", false)],
                include_source: None,
            }],
        });

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 2);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[0].stacks[1].title, "SB");
        assert_eq!(
            result.rows[0].stacks[1].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_stack_delete_preserves_sibling_stacks() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![
                ("SA", vec![("ColA", vec![make_card("k001", "A", false)])]),
                ("SB", vec![("ColB", vec![make_card("k002", "B", false)])]),
                ("SC", vec![("ColC", vec![make_card("k003", "C", false)])]),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows[0].stacks.remove(1); // Remove SB

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 2);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[0].stacks[1].title, "SC");
        assert_eq!(
            result.rows[0].stacks[1].columns[0].cards[0].kid.as_deref(),
            Some("k003")
        );
    }

    #[test]
    fn test_stack_title_rename_preserves_columns() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "OldName",
                vec![
                    ("ColA", vec![make_card("k001", "Task", false)]),
                    ("ColB", vec![make_card("k002", "Task2", false)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows[0].stacks[0].title = "NewName".to_string();

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].title, "NewName");
        assert_eq!(result.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(
            result.rows[0].stacks[0].columns[1].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Row lifecycle
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_row_add_preserves_existing_rows() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![("S1", vec![("Col1", vec![make_card("k001", "T1", false)])])],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows.push(KanbanRow {
            id: "row-R2".to_string(),
            title: "R2".to_string(),
            stacks: vec![KanbanStack {
                id: "stack-S2".to_string(),
                title: "S2".to_string(),
                columns: vec![KanbanColumn {
                    id: "col-Col2".to_string(),
                    title: "Col2".to_string(),
                    cards: vec![make_card("k002", "T2", false)],
                    include_source: None,
                }],
            }],
        });

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0].title, "R1");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[1].title, "R2");
        assert_eq!(
            result.rows[1].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_row_delete_preserves_sibling_rows() {
        let original = make_new_format_board(vec![
            (
                "R1",
                vec![("S1", vec![("Col1", vec![make_card("k001", "A", false)])])],
            ),
            (
                "R2",
                vec![("S2", vec![("Col2", vec![make_card("k002", "B", false)])])],
            ),
            (
                "R3",
                vec![("S3", vec![("Col3", vec![make_card("k003", "C", false)])])],
            ),
        ]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows.remove(1); // Remove R2

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0].title, "R1");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[1].title, "R3");
        assert_eq!(
            result.rows[1].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k003")
        );
    }

    #[test]
    fn test_row_title_rename_preserves_stacks() {
        let original = make_new_format_board(vec![(
            "OldRow",
            vec![
                ("SA", vec![("Col1", vec![make_card("k001", "T", false)])]),
                ("SB", vec![("Col2", vec![make_card("k002", "T2", false)])]),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows[0].title = "NewRow".to_string();

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].title, "NewRow");
        assert_eq!(result.rows[0].stacks.len(), 2);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(result.rows[0].stacks[1].title, "SB");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Duplicate operations
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_column_duplicate_roundtrip() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![("S1", vec![("ColA", vec![make_card("k001", "Task", false)])])],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        // Simulate duplication: clone ColA as ColA-Copy with new IDs and title
        updated.rows[0].stacks[0].columns.push(KanbanColumn {
            id: "col-ColA-Copy".to_string(),
            title: "ColA Copy".to_string(),
            cards: vec![make_card("k001-dup", "Task", false)],
            include_source: None,
        });

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(result.rows[0].stacks[0].columns[0].title, "ColA");
        assert_eq!(result.rows[0].stacks[0].columns[1].title, "ColA Copy");
        // Edit original column's card → clone should not change
        let step2 = result.clone();
        let mut edited = step2.clone();
        edited.rows[0].stacks[0].columns[0].cards[0] = make_card("k001", "Modified", false);
        store.apply_board(&edited, &step2).unwrap();
        let result2 = store.to_board();
        assert_eq!(
            result2.rows[0].stacks[0].columns[0].cards[0].content,
            "Modified"
        );
        assert_eq!(
            result2.rows[0].stacks[0].columns[1].cards[0].content,
            "Task"
        ); // unchanged
    }

    #[test]
    fn test_stack_duplicate_roundtrip() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![("SA", vec![("ColA", vec![make_card("k001", "Task", false)])])],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows[0].stacks.push(KanbanStack {
            id: "stack-SA-Copy".to_string(),
            title: "SA Copy".to_string(),
            columns: vec![KanbanColumn {
                id: "col-ColA-Copy".to_string(),
                title: "ColA Copy".to_string(),
                cards: vec![make_card("k002", "Task copy", false)],
                include_source: None,
            }],
        });

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 2);
        assert_eq!(result.rows[0].stacks[0].title, "SA");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[0].stacks[1].title, "SA Copy");
        assert_eq!(
            result.rows[0].stacks[1].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_row_duplicate_roundtrip() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![("S1", vec![("Col1", vec![make_card("k001", "Task", false)])])],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        updated.rows.push(KanbanRow {
            id: "row-R1-Copy".to_string(),
            title: "R1 Copy".to_string(),
            stacks: vec![KanbanStack {
                id: "stack-S1-Copy".to_string(),
                title: "S1 Copy".to_string(),
                columns: vec![KanbanColumn {
                    id: "col-Col1-Copy".to_string(),
                    title: "Col1 Copy".to_string(),
                    cards: vec![make_card("k002", "Task copy", false)],
                    include_source: None,
                }],
            }],
        });

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0].title, "R1");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[1].title, "R1 Copy");
        assert_eq!(
            result.rows[1].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Hidden items survive CRDT round-trip
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_hidden_card_survives_roundtrip() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "S1",
                vec![(
                    "Col1",
                    vec![
                        make_card("k001", "Visible task", false),
                        make_card("k002", "Deleted task #hidden-internal-deleted", false),
                        make_card("k003", "Another visible", false),
                    ],
                )],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns[0].cards.len(), 3);
        assert!(result.rows[0].stacks[0].columns[0].cards[1]
            .content
            .contains("#hidden-internal-deleted"));
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[2].kid.as_deref(),
            Some("k003")
        );
    }

    #[test]
    fn test_hidden_column_survives_roundtrip() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "S1",
                vec![
                    ("Visible #tag", vec![make_card("k001", "T1", false)]),
                    (
                        "Hidden #hidden-internal-parked",
                        vec![make_card("k002", "T2", false)],
                    ),
                    ("Also Visible", vec![make_card("k003", "T3", false)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns.len(), 3);
        assert!(result.rows[0].stacks[0].columns[1]
            .title
            .contains("#hidden-internal-parked"));
        assert_eq!(
            result.rows[0].stacks[0].columns[1].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_hidden_stack_survives_roundtrip() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![
                (
                    "Active",
                    vec![("Col1", vec![make_card("k001", "T1", false)])],
                ),
                (
                    "Archived #hidden-internal-archived",
                    vec![("Col2", vec![make_card("k002", "T2", false)])],
                ),
            ],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks.len(), 2);
        assert!(result.rows[0].stacks[1]
            .title
            .contains("#hidden-internal-archived"));
        assert_eq!(
            result.rows[0].stacks[1].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_hidden_row_survives_roundtrip() {
        let original = make_new_format_board(vec![
            (
                "Visible",
                vec![("S1", vec![("Col1", vec![make_card("k001", "T1", false)])])],
            ),
            (
                "Deleted #hidden-internal-deleted",
                vec![("S2", vec![("Col2", vec![make_card("k002", "T2", false)])])],
            ),
            (
                "Also Visible",
                vec![("S3", vec![("Col3", vec![make_card("k003", "T3", false)])])],
            ),
        ]);
        let mut store = CrdtStore::from_board(&original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows.len(), 3);
        assert!(result.rows[1].title.contains("#hidden-internal-deleted"));
        assert_eq!(
            result.rows[1].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k002")
        );
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(
            result.rows[2].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k003")
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Multi-step operations
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_add_column_then_add_card_to_it() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "S1",
                vec![("ColA", vec![make_card("k001", "Task1", false)])],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Step 1: Add ColB
        let mut step1 = original.clone();
        step1.rows[0].stacks[0].columns.push(KanbanColumn {
            id: "col-ColB".to_string(),
            title: "ColB".to_string(),
            cards: vec![],
            include_source: None,
        });
        store.apply_board(&step1, &original).unwrap();
        let after_step1 = store.to_board();
        assert_eq!(after_step1.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(after_step1.rows[0].stacks[0].columns[1].cards.len(), 0);

        // Step 2: Add card to ColB
        let mut step2 = after_step1.clone();
        step2.rows[0].stacks[0].columns[1]
            .cards
            .push(make_card("k002", "NewCard", false));
        store.apply_board(&step2, &after_step1).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k001")
        );
        assert_eq!(result.rows[0].stacks[0].columns[1].cards.len(), 1);
        assert_eq!(
            result.rows[0].stacks[0].columns[1].cards[0].kid.as_deref(),
            Some("k002")
        );
    }

    #[test]
    fn test_delete_column_then_reorder_remaining() {
        let original = make_new_format_board(vec![(
            "R1",
            vec![(
                "S1",
                vec![
                    ("ColA", vec![make_card("k001", "A", false)]),
                    ("ColB", vec![make_card("k002", "B", false)]),
                    ("ColC", vec![make_card("k003", "C", false)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Step 1: Delete ColB
        let mut step1 = original.clone();
        step1.rows[0].stacks[0].columns.remove(1);
        store.apply_board(&step1, &original).unwrap();
        let after_step1 = store.to_board();
        assert_eq!(after_step1.rows[0].stacks[0].columns.len(), 2);

        // Step 2: Reorder ColC before ColA
        let mut step2 = after_step1.clone();
        let col_c = step2.rows[0].stacks[0].columns.remove(1);
        step2.rows[0].stacks[0].columns.insert(0, col_c);
        store.apply_board(&step2, &after_step1).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(result.rows[0].stacks[0].columns[0].title, "ColC");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards[0].kid.as_deref(),
            Some("k003")
        );
        assert_eq!(result.rows[0].stacks[0].columns[1].title, "ColA");
        assert_eq!(
            result.rows[0].stacks[0].columns[1].cards[0].kid.as_deref(),
            Some("k001")
        );
    }

    // ── Bug reproduction: card duplication on structural change + move ────

    /// BUG REPRO: When a card is moved to a NEW column (in a new stack),
    /// sync_column_structure creates the column WITH its cards, then the
    /// card diff phase must NOT add the same card again.
    #[test]
    fn test_bug_new_column_with_cards_no_duplication() {
        let original = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    (
                        "ColA",
                        vec![
                            make_card("k001", "Card 1", false),
                            make_card("k002", "Card 2", false),
                        ],
                    ),
                    ("ColB", vec![make_card("k003", "Card 3", false)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // User adds a new stack with a column, and moves card1 into it
        let updated = make_new_format_board(vec![(
            "Row1",
            vec![
                (
                    "StackA",
                    vec![
                        ("ColA", vec![make_card("k002", "Card 2", false)]),
                        ("ColB", vec![make_card("k003", "Card 3", false)]),
                    ],
                ),
                (
                    "StackB",
                    vec![("ColNew", vec![make_card("k001", "Card 1", false)])],
                ),
            ],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        // card1 MUST appear exactly once — in ColNew, NOT in ColA
        let all_cards: Vec<_> = result
            .all_columns()
            .iter()
            .flat_map(|c| {
                c.cards
                    .iter()
                    .map(|card| (c.title.clone(), card.kid.clone()))
            })
            .collect();
        let k001_locations: Vec<_> = all_cards
            .iter()
            .filter(|(_, kid)| kid.as_deref() == Some("k001"))
            .map(|(col, _)| col.as_str())
            .collect();

        assert_eq!(
            k001_locations.len(),
            1,
            "card k001 should appear exactly once, found in: {:?}",
            k001_locations
        );
        assert_eq!(k001_locations[0], "ColNew", "card k001 should be in ColNew");
        assert_eq!(
            result.rows[0].stacks[0].columns[0].cards.len(),
            1,
            "ColA should have 1 card"
        );
        assert_eq!(
            result.rows[0].stacks[0].columns[1].cards.len(),
            1,
            "ColB should have 1 card"
        );
    }

    /// Card move between existing columns — no duplication.
    #[test]
    fn test_card_move_no_duplication_new_format() {
        let original = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    (
                        "Todo",
                        vec![
                            make_card("k001", "Task 1", false),
                            make_card("k002", "Task 2", false),
                        ],
                    ),
                    ("Done", vec![make_card("k003", "Task 3", true)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // Move k001 from Todo to Done
        let updated = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    ("Todo", vec![make_card("k002", "Task 2", false)]),
                    (
                        "Done",
                        vec![
                            make_card("k003", "Task 3", true),
                            make_card("k001", "Task 1", false),
                        ],
                    ),
                ],
            )],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        let all_cards: Vec<_> = result
            .all_columns()
            .iter()
            .flat_map(|c| {
                c.cards
                    .iter()
                    .map(|card| (c.title.clone(), card.kid.clone()))
            })
            .collect();
        let k001_locations: Vec<_> = all_cards
            .iter()
            .filter(|(_, kid)| kid.as_deref() == Some("k001"))
            .map(|(col, _)| col.as_str())
            .collect();

        assert_eq!(
            k001_locations.len(),
            1,
            "card k001 should appear exactly once, found in: {:?}",
            k001_locations
        );
        assert_eq!(k001_locations[0], "Done");
        assert_eq!(result.rows[0].stacks[0].columns[0].cards.len(), 1);
        assert_eq!(result.rows[0].stacks[0].columns[1].cards.len(), 2);
    }

    #[test]
    fn test_card_move_same_titled_columns_uses_column_ids() {
        let original = KanbanBoard {
            valid: true,
            title: "Test Board".to_string(),
            columns: Vec::new(),
            rows: vec![KanbanRow {
                id: "row-1".to_string(),
                title: "Row 1".to_string(),
                stacks: vec![
                    KanbanStack {
                        id: "stack-a".to_string(),
                        title: "Stack A".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-a".to_string(),
                            title: "Todo".to_string(),
                            cards: vec![make_card("k001", "Card 1", false)],
                            include_source: None,
                        }],
                    },
                    KanbanStack {
                        id: "stack-b".to_string(),
                        title: "Stack B".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-b".to_string(),
                            title: "Todo".to_string(),
                            cards: vec![make_card("k002", "Card 2", false)],
                            include_source: None,
                        }],
                    },
                ],
            }],
            yaml_header: Some("---\nkanban-plugin: board\n---".to_string()),
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        };
        let mut store = CrdtStore::from_board(&original).unwrap();

        let mut updated = original.clone();
        let moved = updated.rows[0].stacks[0].columns[0].cards.remove(0);
        updated.rows[0].stacks[1].columns[0].cards.insert(0, moved);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        assert_eq!(result.rows[0].stacks[0].columns[0].cards.len(), 0);
        let target_cards = &result.rows[0].stacks[1].columns[0].cards;
        assert_eq!(target_cards.len(), 2);
        assert_eq!(target_cards[0].kid.as_deref(), Some("k001"));
        assert_eq!(target_cards[1].kid.as_deref(), Some("k002"));
    }

    /// Multiple consecutive apply_board calls — no drift accumulation.
    #[test]
    fn test_multiple_applies_no_drift() {
        let board_v1 = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    (
                        "ColA",
                        vec![
                            make_card("k001", "Card 1", false),
                            make_card("k002", "Card 2", false),
                        ],
                    ),
                    ("ColB", vec![make_card("k003", "Card 3", false)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&board_v1).unwrap();

        // Move k001 from ColA to ColB
        let board_v2 = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    ("ColA", vec![make_card("k002", "Card 2", false)]),
                    (
                        "ColB",
                        vec![
                            make_card("k003", "Card 3", false),
                            make_card("k001", "Card 1", false),
                        ],
                    ),
                ],
            )],
        )]);
        store.apply_board(&board_v2, &board_v1).unwrap();
        let after_v2 = store.to_board();

        // Move k001 back from ColB to ColA
        let board_v3 = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    (
                        "ColA",
                        vec![
                            make_card("k002", "Card 2", false),
                            make_card("k001", "Card 1", false),
                        ],
                    ),
                    ("ColB", vec![make_card("k003", "Card 3", false)]),
                ],
            )],
        )]);
        store.apply_board(&board_v3, &after_v2).unwrap();
        let after_v3 = store.to_board();

        // Verify no duplication after two moves
        let all_kids: Vec<_> = after_v3
            .all_columns()
            .iter()
            .flat_map(|c| c.cards.iter().filter_map(|card| card.kid.clone()))
            .collect();
        let mut kid_set = std::collections::HashSet::new();
        for kid in &all_kids {
            assert!(kid_set.insert(kid.clone()), "Duplicate kid found: {}", kid);
        }
        assert_eq!(all_kids.len(), 3, "Should have exactly 3 cards total");
    }

    /// User scenario: add new stack + move card + rename column.
    #[test]
    fn test_user_scenario_add_delete_column_move_cards() {
        let original = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    (
                        "Todo",
                        vec![
                            make_card("k001", "Task 1", false),
                            make_card("k002", "Task 2", false),
                        ],
                    ),
                    ("InProgress", vec![make_card("k003", "Task 3", false)]),
                    ("Done", vec![make_card("k004", "Task 4", true)]),
                ],
            )],
        )]);
        let mut store = CrdtStore::from_board(&original).unwrap();

        // User: add new stack, hide Done column, move k001 to InProgress
        let updated = make_new_format_board(vec![(
            "Row1",
            vec![
                (
                    "StackA",
                    vec![
                        ("Todo", vec![make_card("k002", "Task 2", false)]),
                        (
                            "InProgress",
                            vec![
                                make_card("k003", "Task 3", false),
                                make_card("k001", "Task 1", false),
                            ],
                        ),
                        (
                            "Done #hidden-internal-deleted",
                            vec![make_card("k004", "Task 4", true)],
                        ),
                    ],
                ),
                ("StackNew", vec![("NewCol", vec![])]),
            ],
        )]);

        store.apply_board(&updated, &original).unwrap();
        let result = store.to_board();

        // Verify ALL cards appear exactly once
        let all_cards: Vec<_> = result
            .all_columns()
            .iter()
            .flat_map(|c| {
                c.cards
                    .iter()
                    .map(|card| (c.title.clone(), card.kid.clone()))
            })
            .collect();

        for kid_to_check in &["k001", "k002", "k003", "k004"] {
            let locations: Vec<_> = all_cards
                .iter()
                .filter(|(_, kid)| kid.as_deref() == Some(*kid_to_check))
                .map(|(col, _)| col.as_str())
                .collect();
            assert_eq!(
                locations.len(),
                1,
                "card {} should appear exactly once, found in: {:?}",
                kid_to_check,
                locations
            );
        }

        // k001 should be in InProgress
        let k001_col = all_cards
            .iter()
            .find(|(_, kid)| kid.as_deref() == Some("k001"))
            .map(|(col, _)| col.as_str());
        assert_eq!(k001_col, Some("InProgress"), "k001 should be in InProgress");
    }

    // ── Live sync roundtrip: simulates the full save flow ────────────────

    /// Simulates the exact live sync save flow:
    /// 1. Storage CRDT created from board
    /// 2. Live sync CRDT cloned from storage snapshot
    /// 3. User moves cards → apply_board on live sync CRDT
    /// 4. Export delta from live sync CRDT
    /// 5. Import delta into storage CRDT
    /// 6. Verify storage CRDT's to_board() matches expected state
    #[test]
    fn test_live_sync_roundtrip_card_move() {
        let original = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    (
                        "ColA",
                        vec![
                            make_card("k001", "Card 1", false),
                            make_card("k002", "Card 2", false),
                        ],
                    ),
                    ("ColB", vec![make_card("k003", "Card 3", false)]),
                ],
            )],
        )]);

        // Step 1: Create storage CRDT
        let mut storage_crdt = CrdtStore::from_board(&original).unwrap();

        // Step 2: Clone to live sync CRDT (via snapshot, like the real flow)
        let snapshot = storage_crdt.save().unwrap();
        let mut live_sync_crdt = CrdtStore::load(&snapshot).unwrap();
        live_sync_crdt.set_peer_id(12345).unwrap();

        // Step 3: User moves k001 from ColA to ColB
        let updated = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    ("ColA", vec![make_card("k002", "Card 2", false)]),
                    (
                        "ColB",
                        vec![
                            make_card("k003", "Card 3", false),
                            make_card("k001", "Card 1", false),
                        ],
                    ),
                ],
            )],
        )]);

        let before_vv = live_sync_crdt.oplog_vv();
        let current_board = live_sync_crdt.to_board();
        live_sync_crdt
            .apply_board(&updated, &current_board)
            .unwrap();

        // Step 4: Export delta
        let delta = live_sync_crdt.export_updates_since(&before_vv).unwrap();

        // Step 5: Import delta into storage CRDT
        storage_crdt.import_updates(&delta).unwrap();

        // Step 6: Verify storage CRDT matches
        let storage_board = storage_crdt.to_board();
        let all_cards: Vec<_> = storage_board
            .all_columns()
            .iter()
            .flat_map(|c| {
                c.cards
                    .iter()
                    .map(|card| (c.title.clone(), card.kid.clone()))
            })
            .collect();

        // k001 should be in ColB, not ColA
        let k001_locations: Vec<_> = all_cards
            .iter()
            .filter(|(_, kid)| kid.as_deref() == Some("k001"))
            .map(|(col, _)| col.as_str())
            .collect();
        assert_eq!(
            k001_locations.len(),
            1,
            "k001 should appear exactly once in storage CRDT, found in: {:?}",
            k001_locations
        );
        assert_eq!(
            k001_locations[0], "ColB",
            "k001 should be in ColB after live sync roundtrip"
        );

        // Verify no duplicates
        let all_kids: Vec<_> = all_cards
            .iter()
            .filter_map(|(_, kid)| kid.as_deref())
            .collect();
        assert_eq!(all_kids.len(), 3, "Should have exactly 3 cards total");
    }

    /// Live sync roundtrip with structural change (new stack + card move)
    #[test]
    fn test_live_sync_roundtrip_structural_change() {
        let original = make_new_format_board(vec![(
            "Row1",
            vec![(
                "StackA",
                vec![
                    (
                        "ColA",
                        vec![
                            make_card("k001", "Card 1", false),
                            make_card("k002", "Card 2", false),
                        ],
                    ),
                    ("ColB", vec![make_card("k003", "Card 3", false)]),
                ],
            )],
        )]);

        let mut storage_crdt = CrdtStore::from_board(&original).unwrap();
        let snapshot = storage_crdt.save().unwrap();
        let mut live_sync_crdt = CrdtStore::load(&snapshot).unwrap();
        live_sync_crdt.set_peer_id(12345).unwrap();

        // User adds new stack and moves k001 there
        let updated = make_new_format_board(vec![(
            "Row1",
            vec![
                (
                    "StackA",
                    vec![
                        ("ColA", vec![make_card("k002", "Card 2", false)]),
                        ("ColB", vec![make_card("k003", "Card 3", false)]),
                    ],
                ),
                (
                    "StackNew",
                    vec![("ColNew", vec![make_card("k001", "Card 1", false)])],
                ),
            ],
        )]);

        let before_vv = live_sync_crdt.oplog_vv();
        let current_board = live_sync_crdt.to_board();
        live_sync_crdt
            .apply_board(&updated, &current_board)
            .unwrap();
        let delta = live_sync_crdt.export_updates_since(&before_vv).unwrap();

        // Import into storage
        storage_crdt.import_updates(&delta).unwrap();
        let storage_board = storage_crdt.to_board();

        let all_cards: Vec<_> = storage_board
            .all_columns()
            .iter()
            .flat_map(|c| {
                c.cards
                    .iter()
                    .map(|card| (c.title.clone(), card.kid.clone()))
            })
            .collect();

        let k001_locations: Vec<_> = all_cards
            .iter()
            .filter(|(_, kid)| kid.as_deref() == Some("k001"))
            .map(|(col, _)| col.as_str())
            .collect();
        assert_eq!(
            k001_locations.len(),
            1,
            "k001 should appear exactly once after live sync structural change, found in: {:?}",
            k001_locations
        );
        assert_eq!(k001_locations[0], "ColNew");

        let all_kids: Vec<_> = all_cards
            .iter()
            .filter_map(|(_, kid)| kid.as_deref())
            .collect();
        assert_eq!(all_kids.len(), 3, "Should have exactly 3 cards total");
    }

    // ================================================================
    // 3-way structural merge tests
    // ================================================================

    /// Helper: simulate a peer adding a row to an existing CRDT by creating
    /// a second board and applying it.
    fn add_peer_row(store: &mut CrdtStore, base: &KanbanBoard, peer_row: (&str, Vec<(&str, Vec<(&str, Vec<KanbanCard>)>)>)) {
        let mut peer_board = base.clone();
        peer_board.rows.push(KanbanRow {
            id: format!("row-{}", peer_row.0),
            title: peer_row.0.to_string(),
            stacks: peer_row.1.into_iter().map(|(st, cols)| KanbanStack {
                id: format!("stack-{}", st),
                title: st.to_string(),
                columns: cols.into_iter().map(|(ct, cards)| KanbanColumn {
                    id: format!("col-{}", ct),
                    title: ct.to_string(),
                    cards,
                    include_source: None,
                }).collect(),
            }).collect(),
        });
        store.apply_board(&peer_board, base).unwrap();
    }

    #[test]
    fn test_3way_preserves_unknown_rows() {
        // Base: Row A, Row B
        let base = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
            ("B", vec![("SB", vec![("ColB", vec![make_card("k002", "B", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // Peer adds Row C (user never sees it)
        add_peer_row(&mut store, &base, ("C", vec![
            ("SC", vec![("ColC", vec![make_card("k003", "peer card", false)])])
        ]));

        // User sends back the same base (didn't change anything, never saw C)
        let incoming = base.clone();
        let current = base.clone();
        store.apply_board(&incoming, &current).unwrap();

        let result = store.to_board();
        assert_eq!(result.rows.len(), 3, "Row C from peer should be preserved");
        assert_eq!(result.rows[0].title, "A");
        assert_eq!(result.rows[1].title, "B");
        assert_eq!(result.rows[2].title, "C");
        // Verify peer's cards survived
        let peer_cards: Vec<_> = result.rows[2].stacks[0].columns[0].cards.iter()
            .filter_map(|c| c.kid.as_deref())
            .collect();
        assert!(peer_cards.contains(&"k003"), "Peer card should survive");
    }

    #[test]
    fn test_3way_deletes_intentionally_removed_rows() {
        // Base: Row A, Row B, Row C
        let base = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
            ("B", vec![("SB", vec![("ColB", vec![make_card("k002", "B", false)])])]),
            ("C", vec![("SC", vec![("ColC", vec![make_card("k003", "C", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // User deletes Row B
        let mut incoming = base.clone();
        incoming.rows.remove(1); // Remove B
        store.apply_board(&incoming, &base).unwrap();

        let result = store.to_board();
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0].title, "A");
        assert_eq!(result.rows[1].title, "C");
    }

    #[test]
    fn test_3way_combined_add_delete_preserve() {
        // Base: Row A, Row B, Row C
        let base = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
            ("B", vec![("SB", vec![("ColB", vec![make_card("k002", "B", false)])])]),
            ("C", vec![("SC", vec![("ColC", vec![make_card("k003", "C", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // Peer adds Row D while user is editing
        add_peer_row(&mut store, &base, ("D", vec![
            ("SD", vec![("ColD", vec![make_card("k004", "peer card D", false)])])
        ]));

        // User deletes B, adds E (never saw D)
        let incoming = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
            ("C", vec![("SC", vec![("ColC", vec![make_card("k003", "C", false)])])]),
            ("E", vec![("SE", vec![("ColE", vec![make_card("k005", "E", false)])])]),
        ]);
        store.apply_board(&incoming, &base).unwrap();

        let result = store.to_board();
        let row_titles: Vec<&str> = result.rows.iter().map(|r| r.title.as_str()).collect();
        assert!(row_titles.contains(&"A"), "A should remain");
        assert!(!row_titles.contains(&"B"), "B should be deleted (user removed it)");
        assert!(row_titles.contains(&"C"), "C should remain");
        assert!(row_titles.contains(&"D"), "D should be preserved (peer added, user never saw)");
        assert!(row_titles.contains(&"E"), "E should be added (user added)");
        assert_eq!(result.rows.len(), 4);
    }

    #[test]
    fn test_3way_preserves_unknown_stacks() {
        // Base: Row R1 with stacks SA, SB
        let base = make_new_format_board(vec![
            ("R1", vec![
                ("SA", vec![("ColA", vec![make_card("k001", "A", false)])]),
                ("SB", vec![("ColB", vec![make_card("k002", "B", false)])]),
            ]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // Peer adds stack SC to R1
        let mut peer_board = base.clone();
        peer_board.rows[0].stacks.push(KanbanStack {
            id: "stack-SC".to_string(),
            title: "SC".to_string(),
            columns: vec![KanbanColumn {
                id: "col-ColC".to_string(),
                title: "ColC".to_string(),
                cards: vec![make_card("k003", "peer stack card", false)],
                include_source: None,
            }],
        });
        store.apply_board(&peer_board, &base).unwrap();

        // User sends back base (never saw SC)
        store.apply_board(&base, &base).unwrap();

        let result = store.to_board();
        assert_eq!(result.rows[0].stacks.len(), 3, "Peer stack SC should be preserved");
        let stack_titles: Vec<&str> = result.rows[0].stacks.iter().map(|s| s.title.as_str()).collect();
        assert!(stack_titles.contains(&"SC"));
    }

    #[test]
    fn test_3way_preserves_unknown_columns() {
        // Base: Row R1, Stack S1, Column ColA
        let base = make_new_format_board(vec![
            ("R1", vec![
                ("S1", vec![("ColA", vec![make_card("k001", "A", false)])]),
            ]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // Peer adds ColB to S1
        let mut peer_board = base.clone();
        peer_board.rows[0].stacks[0].columns.push(KanbanColumn {
            id: "col-ColB".to_string(),
            title: "ColB".to_string(),
            cards: vec![make_card("k002", "peer column card", false)],
            include_source: None,
        });
        store.apply_board(&peer_board, &base).unwrap();

        // User sends back base (never saw ColB)
        store.apply_board(&base, &base).unwrap();

        let result = store.to_board();
        assert_eq!(result.rows[0].stacks[0].columns.len(), 2, "Peer column ColB should be preserved");
        let col_titles: Vec<&str> = result.rows[0].stacks[0].columns.iter().map(|c| c.title.as_str()).collect();
        assert!(col_titles.contains(&"ColB"));
    }

    #[test]
    fn test_3way_preserves_cards_in_unknown_rows() {
        // Base: just Row A
        let base = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // Peer adds Row X with multiple cards
        add_peer_row(&mut store, &base, ("X", vec![
            ("SX", vec![("ColX", vec![
                make_card("kx01", "peer card 1", false),
                make_card("kx02", "peer card 2", true),
                make_card("kx03", "peer card 3", false),
            ])])
        ]));

        // User edits only Row A (adds a card), never sees Row X
        let mut incoming = base.clone();
        incoming.rows[0].stacks[0].columns[0].cards.push(make_card("k002", "user added", false));
        store.apply_board(&incoming, &base).unwrap();

        let result = store.to_board();
        assert_eq!(result.rows.len(), 2, "Both rows should exist");

        // Verify peer cards survived
        let peer_row = result.rows.iter().find(|r| r.title == "X").unwrap();
        let peer_cards: Vec<_> = peer_row.stacks[0].columns[0].cards.iter()
            .filter_map(|c| c.kid.as_deref())
            .collect();
        assert_eq!(peer_cards.len(), 3, "All 3 peer cards should survive");
        assert!(peer_cards.contains(&"kx01"));
        assert!(peer_cards.contains(&"kx02"));
        assert!(peer_cards.contains(&"kx03"));

        // Verify user's card was added
        let user_row = result.rows.iter().find(|r| r.title == "A").unwrap();
        let user_kids: Vec<_> = user_row.stacks[0].columns[0].cards.iter()
            .filter_map(|c| c.kid.as_deref())
            .collect();
        assert!(user_kids.contains(&"k002"), "User's added card should be there");
    }

    #[test]
    fn test_3way_user_adds_row_while_peer_adds_row() {
        // Both user and peer independently add new rows
        let base = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // Peer adds Row P
        add_peer_row(&mut store, &base, ("P", vec![
            ("SP", vec![("ColP", vec![make_card("kp01", "peer row", false)])])
        ]));

        // User adds Row U
        let mut incoming = base.clone();
        incoming.rows.push(KanbanRow {
            id: "row-U".to_string(),
            title: "U".to_string(),
            stacks: vec![KanbanStack {
                id: "stack-SU".to_string(),
                title: "SU".to_string(),
                columns: vec![KanbanColumn {
                    id: "col-ColU".to_string(),
                    title: "ColU".to_string(),
                    cards: vec![make_card("ku01", "user row", false)],
                    include_source: None,
                }],
            }],
        });
        store.apply_board(&incoming, &base).unwrap();

        let result = store.to_board();
        let titles: Vec<&str> = result.rows.iter().map(|r| r.title.as_str()).collect();
        assert!(titles.contains(&"A"), "Original row preserved");
        assert!(titles.contains(&"P"), "Peer row preserved");
        assert!(titles.contains(&"U"), "User row added");
        assert_eq!(result.rows.len(), 3);
    }

    #[test]
    fn test_3way_hidden_deleted_rows_preserved_when_not_in_current() {
        // Simulates the exact bug: hidden-deleted rows exist in CRDT
        // but frontend loads without them
        let full_board = make_new_format_board(vec![
            ("Deleted1 #hidden-internal-deleted", vec![
                ("Default", vec![("Col1", vec![make_card("k001", "trash", false)])]),
            ]),
            ("Board", vec![
                ("Stack1", vec![("ColA", vec![
                    make_card("k002", "visible card", false),
                    make_card("k003", "another card", false),
                ])]),
            ]),
        ]);
        let mut store = CrdtStore::from_board(&full_board).unwrap();

        // Frontend loads only the visible row (current has both, but incoming
        // scenario: current = what frontend started with = full board)
        // User edits only the Board row
        let mut incoming = full_board.clone();
        incoming.rows[1].stacks[0].columns[0].cards.push(
            make_card("k004", "user added card", false)
        );

        // current = full_board (frontend started with all rows)
        store.apply_board(&incoming, &full_board).unwrap();

        let result = store.to_board();
        assert_eq!(result.rows.len(), 2, "Hidden-deleted row should still exist");
        assert_eq!(result.rows[0].title, "Deleted1 #hidden-internal-deleted");
    }

    #[test]
    fn test_3way_snapshot_missing_rows_does_not_lose_them() {
        // THE critical bug scenario: frontend's fullBoardData gets replaced
        // with a snapshot missing rows, then sends it as incoming.
        // With 3-way merge, if the rows were never in `current`, they're preserved.
        let full_board = make_new_format_board(vec![
            ("HiddenRow #hidden-internal-deleted", vec![
                ("Default", vec![("HCol", vec![make_card("kh01", "hidden card", false)])]),
            ]),
            ("Board", vec![
                ("MainStack", vec![("MainCol", vec![
                    make_card("km01", "main card 1", false),
                    make_card("km02", "main card 2", false),
                ])]),
            ]),
        ]);
        let mut store = CrdtStore::from_board(&full_board).unwrap();

        // Scenario: snapshot only has "Board" row (HiddenRow got lost somehow).
        // But `current` also only has "Board" row (because the snapshot was
        // adopted by the frontend as both fullBoardData AND saveBase).
        let snapshot = make_new_format_board(vec![
            ("Board", vec![
                ("MainStack", vec![("MainCol", vec![
                    make_card("km01", "main card 1", false),
                    make_card("km02", "main card 2", false),
                ])]),
            ]),
        ]);

        // current = snapshot (frontend started from the incomplete snapshot)
        // incoming = snapshot (user didn't change anything)
        store.apply_board(&snapshot, &snapshot).unwrap();

        let result = store.to_board();
        // HiddenRow should be preserved because it wasn't in `current`
        assert_eq!(result.rows.len(), 2, "HiddenRow should be preserved (not in current, so not intentionally deleted)");
        let titles: Vec<&str> = result.rows.iter().map(|r| r.title.as_str()).collect();
        assert!(titles.contains(&"HiddenRow #hidden-internal-deleted"));
        assert!(titles.contains(&"Board"));
    }

    #[test]
    fn test_3way_user_renames_row_title() {
        let base = make_new_format_board(vec![
            ("OldTitle", vec![("S1", vec![("Col1", vec![make_card("k001", "card", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        let mut incoming = base.clone();
        incoming.rows[0].title = "NewTitle".to_string();
        store.apply_board(&incoming, &base).unwrap();

        let result = store.to_board();
        assert_eq!(result.rows[0].title, "NewTitle");
        assert_eq!(result.rows[0].stacks[0].columns[0].cards.len(), 1);
    }

    #[test]
    fn test_3way_user_reorders_rows() {
        let base = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
            ("B", vec![("SB", vec![("ColB", vec![make_card("k002", "B", false)])])]),
            ("C", vec![("SC", vec![("ColC", vec![make_card("k003", "C", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // User reorders: C, A, B
        let incoming = make_new_format_board(vec![
            ("C", vec![("SC", vec![("ColC", vec![make_card("k003", "C", false)])])]),
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
            ("B", vec![("SB", vec![("ColB", vec![make_card("k002", "B", false)])])]),
        ]);
        store.apply_board(&incoming, &base).unwrap();

        let result = store.to_board();
        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.rows[0].title, "C");
        assert_eq!(result.rows[1].title, "A");
        assert_eq!(result.rows[2].title, "B");
    }

    #[test]
    fn test_3way_multiple_sequential_edits() {
        // Simulates a realistic editing session with multiple saves
        let base = make_new_format_board(vec![
            ("R1", vec![("S1", vec![("Col1", vec![make_card("k001", "card1", false)])])]),
            ("R2", vec![("S2", vec![("Col2", vec![make_card("k002", "card2", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&base).unwrap();

        // Edit 1: User adds a card to R1
        let mut edit1 = base.clone();
        edit1.rows[0].stacks[0].columns[0].cards.push(make_card("k003", "new card", false));
        store.apply_board(&edit1, &base).unwrap();
        let after_edit1 = store.to_board();

        // Edit 2: User adds a new row R3 (current = result of edit 1)
        let mut edit2 = after_edit1.clone();
        edit2.rows.push(KanbanRow {
            id: "row-R3".to_string(),
            title: "R3".to_string(),
            stacks: vec![KanbanStack {
                id: "stack-S3".to_string(),
                title: "S3".to_string(),
                columns: vec![KanbanColumn {
                    id: "col-Col3".to_string(),
                    title: "Col3".to_string(),
                    cards: vec![make_card("k004", "row3 card", false)],
                    include_source: None,
                }],
            }],
        });
        store.apply_board(&edit2, &after_edit1).unwrap();
        let after_edit2 = store.to_board();

        // Edit 3: User deletes R2 (current = result of edit 2)
        let mut edit3 = after_edit2.clone();
        edit3.rows.retain(|r| r.title != "R2");
        store.apply_board(&edit3, &after_edit2).unwrap();

        let final_result = store.to_board();
        let titles: Vec<&str> = final_result.rows.iter().map(|r| r.title.as_str()).collect();
        assert!(titles.contains(&"R1"));
        assert!(!titles.contains(&"R2"), "R2 should be deleted");
        assert!(titles.contains(&"R3"));
        assert_eq!(final_result.rows.len(), 2);

        // Verify card from edit 1 survived
        let r1 = final_result.rows.iter().find(|r| r.title == "R1").unwrap();
        assert!(r1.stacks[0].columns[0].cards.len() >= 2, "Added card should survive through edits");
    }

    #[test]
    fn test_3way_empty_current_preserves_all_crdt_items() {
        // When current is empty (e.g., first sync), nothing should be deleted
        let board = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
            ("B", vec![("SB", vec![("ColB", vec![make_card("k002", "B", false)])])]),
        ]);
        let mut store = CrdtStore::from_board(&board).unwrap();

        // Empty current = first sync, incoming only has row A
        let incoming = make_new_format_board(vec![
            ("A", vec![("SA", vec![("ColA", vec![make_card("k001", "A", false)])])]),
        ]);
        let empty_current = make_new_format_board(vec![]);

        store.apply_board(&incoming, &empty_current).unwrap();

        let result = store.to_board();
        // Row B should be preserved because it wasn't in current
        assert_eq!(result.rows.len(), 2, "Row B should be preserved (not in empty current)");
    }
}
