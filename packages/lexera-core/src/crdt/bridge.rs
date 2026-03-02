/// CRDT bridge between KanbanBoard and Loro document.
///
/// Converts boards to/from a Loro CRDT representation, applies diffs as
/// minimal CRDT operations, and provides undo/redo and persistence.
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
        let yaml = meta.as_ref().and_then(|m| get_optional_string(m, "yaml_header"));
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

// ── Metadata helpers ─────────────────────────────────────────────────────────

/// Write board metadata (yaml_header, footer, settings) into a CRDT metadata map.
fn write_metadata_to_map(
    meta: &LoroMap,
    board: &KanbanBoard,
) -> io::Result<()> {
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

/// Read board metadata from the CRDT metadata map.
fn read_metadata_from_map(meta: &LoroMap) -> (Option<String>, Option<String>, Option<BoardSettings>) {
    let yaml_header = get_optional_string(meta, "yaml_header")
        .filter(|s| !s.is_empty());
    let footer = get_optional_string(meta, "footer")
        .filter(|s| !s.is_empty());
    let settings = get_sub_map(meta, "settings")
        .map(|sm| read_settings_from_map(&sm))
        .filter(|s| s != &BoardSettings::default());
    (yaml_header, footer, settings)
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

// ── Building CRDT from Board ─────────────────────────────────────────────────

fn insert_card(cards_list: &LoroMovableList, card: &KanbanCard) -> io::Result<()> {
    let card_map: LoroMap = cards_list.push_container(LoroMap::new()).map_err(loro_err)?;
    let kid = card_identity::resolve_kid(&card.content, card.kid.as_deref());
    let content = card_identity::strip_kid(&card.content);
    card_map.insert("kid", kid.as_str()).map_err(loro_err)?;
    card_map.insert("content", content.as_str()).map_err(loro_err)?;
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

fn populate_single_column(
    columns_list: &LoroMovableList,
    col: &KanbanColumn,
) -> io::Result<()> {
    let col_map: LoroMap = columns_list.push_container(LoroMap::new()).map_err(loro_err)?;
    col_map.insert("id", col.id.as_str()).map_err(loro_err)?;
    col_map.insert("title", col.title.as_str()).map_err(loro_err)?;
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
        root.insert("title", board.title.as_str()).map_err(loro_err)?;

        let is_new_format = board.format_hint == BoardFormat::New;
        root.insert("format", if is_new_format { "new" } else { "legacy" })
            .map_err(loro_err)?;

        if is_new_format {
            let rows_list: LoroMovableList = root
                .insert_container("rows", LoroMovableList::new())
                .map_err(loro_err)?;
            for row in &board.rows {
                let row_map: LoroMap = rows_list.push_container(LoroMap::new()).map_err(loro_err)?;
                row_map.insert("id", row.id.as_str()).map_err(loro_err)?;
                row_map.insert("title", row.title.as_str()).map_err(loro_err)?;
                let stacks_list: LoroMovableList = row_map
                    .insert_container("stacks", LoroMovableList::new())
                    .map_err(loro_err)?;
                for stack in &row.stacks {
                    let stack_map: LoroMap =
                        stacks_list.push_container(LoroMap::new()).map_err(loro_err)?;
                    stack_map.insert("id", stack.id.as_str()).map_err(loro_err)?;
                    stack_map.insert("title", stack.title.as_str()).map_err(loro_err)?;
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

        Ok(CrdtStore {
            doc,
            undo_mgr,
        })
    }

    /// Reconstruct a KanbanBoard from the CRDT state.
    pub fn to_board(&self) -> KanbanBoard {
        let root = self.doc.get_map("root");
        let title = get_string(&root, "title");
        let format = get_string(&root, "format");

        // Read metadata from CRDT (backwards compatible: returns None if missing)
        let (yaml_header, kanban_footer, board_settings) =
            if let Some(meta) = get_sub_map(&root, "metadata") {
                read_metadata_from_map(&meta)
            } else {
                (None, None, None)
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
                format_hint: BoardFormat::Legacy,
            }
        }
    }

    /// Apply changes from an incoming board by diffing against the current CRDT state.
    pub fn apply_board(
        &mut self,
        incoming: &KanbanBoard,
        current: &KanbanBoard,
    ) -> io::Result<()> {
        let changes = diff::diff_boards(current, incoming);
        let has_structural_change = self.has_structural_diff(incoming);
        let has_metadata_change = self.has_metadata_diff(incoming);
        let has_title_change = incoming.title != current.title;
        if changes.is_empty() && !has_structural_change && !has_metadata_change && !has_title_change {
            return Ok(());
        }

        // Update title if changed
        if has_title_change {
            let root = self.doc.get_map("root");
            root.insert("title", incoming.title.as_str()).map_err(loro_err)?;
        }

        // Sync metadata into CRDT
        if has_metadata_change {
            self.sync_metadata(incoming)?;
        }

        for change in &changes {
            match change {
                CardChange::Added {
                    kid,
                    column_title,
                    card,
                } => {
                    if let Some(cards_list) = self.find_column_cards_list(column_title) {
                        let card_map: LoroMap =
                            cards_list.push_container(LoroMap::new()).map_err(loro_err)?;
                        let content = card_identity::strip_kid(&card.content);
                        card_map.insert("kid", kid.as_str()).map_err(loro_err)?;
                        card_map.insert("content", content.as_str()).map_err(loro_err)?;
                        card_map.insert("checked", card.checked).map_err(loro_err)?;
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
                    kid, new_column, ..
                } => {
                    // Remove from old location and add to new
                    let old_data = if let Some((cards_list, pos)) = self.find_card_position(kid) {
                        // Read card data before removing
                        let card_map = get_map_at(&cards_list, pos);
                        let data = card_map.map(|m| {
                            (
                                get_string(&m, "kid"),
                                get_string(&m, "content"),
                                get_bool(&m, "checked"),
                            )
                        });
                        cards_list.delete(pos, 1).map_err(loro_err)?;
                        data
                    } else {
                        None
                    };

                    if let Some((kid_val, content, checked)) = old_data {
                        if let Some(target_cards) = self.find_column_cards_list(new_column) {
                            let card_map: LoroMap =
                                target_cards.push_container(LoroMap::new()).map_err(loro_err)?;
                            card_map.insert("kid", kid_val.as_str()).map_err(loro_err)?;
                            card_map.insert("content", content.as_str()).map_err(loro_err)?;
                            card_map.insert("checked", checked).map_err(loro_err)?;
                        }
                    }
                }
            }
        }

        // Handle structural changes: new columns added in incoming
        self.sync_column_structure(incoming)?;

        self.doc.commit();
        Ok(())
    }

    /// Check whether the incoming board has different metadata than the CRDT.
    fn has_metadata_diff(&self, incoming: &KanbanBoard) -> bool {
        let root = self.doc.get_map("root");
        let (crdt_yaml, crdt_footer, crdt_settings) =
            if let Some(meta) = get_sub_map(&root, "metadata") {
                read_metadata_from_map(&meta)
            } else {
                // No metadata map in CRDT: any non-None incoming metadata is a diff
                return incoming.yaml_header.is_some()
                    || incoming.kanban_footer.is_some()
                    || incoming.board_settings.is_some();
            };

        crdt_yaml != incoming.yaml_header
            || crdt_footer != incoming.kanban_footer
            || crdt_settings != incoming.board_settings
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
                                    if let Some(cols_list) =
                                        get_movable_list(&stack_map, "columns")
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

    /// Synchronize column structure — ensure the CRDT's row/stack/column
    /// structure matches the incoming board exactly (add missing, remove extra).
    fn sync_column_structure(&self, incoming: &KanbanBoard) -> io::Result<()> {
        let root = self.doc.get_map("root");
        let format = get_string(&root, "format");

        if format == "new" {
            if let Some(rows_list) = get_movable_list(&root, "rows") {
                // First pass: add missing rows and sync stacks/columns within each row
                for (ri, row) in incoming.rows.iter().enumerate() {
                    // Add missing rows
                    if ri >= rows_list.len() {
                        let row_map: LoroMap =
                            rows_list.push_container(LoroMap::new()).map_err(loro_err)?;
                        row_map.insert("id", row.id.as_str()).map_err(loro_err)?;
                        row_map.insert("title", row.title.as_str()).map_err(loro_err)?;
                        let stacks_list: LoroMovableList = row_map
                            .insert_container("stacks", LoroMovableList::new())
                            .map_err(loro_err)?;
                        for stack in &row.stacks {
                            let stack_map: LoroMap =
                                stacks_list.push_container(LoroMap::new()).map_err(loro_err)?;
                            stack_map.insert("id", stack.id.as_str()).map_err(loro_err)?;
                            stack_map.insert("title", stack.title.as_str()).map_err(loro_err)?;
                            let cols_list: LoroMovableList = stack_map
                                .insert_container("columns", LoroMovableList::new())
                                .map_err(loro_err)?;
                            for col in &stack.columns {
                                let col_map: LoroMap =
                                    cols_list.push_container(LoroMap::new()).map_err(loro_err)?;
                                col_map.insert("id", col.id.as_str()).map_err(loro_err)?;
                                col_map.insert("title", col.title.as_str()).map_err(loro_err)?;
                                let _: LoroMovableList = col_map
                                    .insert_container("cards", LoroMovableList::new())
                                    .map_err(loro_err)?;
                            }
                        }
                        continue;
                    }

                    if let Some(row_map) = get_map_at(&rows_list, ri) {
                        // Update row title/id if changed
                        row_map.insert("id", row.id.as_str()).map_err(loro_err)?;
                        row_map.insert("title", row.title.as_str()).map_err(loro_err)?;

                        if let Some(stacks_list) = get_movable_list(&row_map, "stacks") {
                            for (si, stack) in row.stacks.iter().enumerate() {
                                if si >= stacks_list.len() {
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
                                        let col_map: LoroMap = cols_list
                                            .push_container(LoroMap::new())
                                            .map_err(loro_err)?;
                                        col_map
                                            .insert("id", col.id.as_str())
                                            .map_err(loro_err)?;
                                        col_map
                                            .insert("title", col.title.as_str())
                                            .map_err(loro_err)?;
                                        let _: LoroMovableList = col_map
                                            .insert_container("cards", LoroMovableList::new())
                                            .map_err(loro_err)?;
                                    }
                                    continue;
                                }

                                if let Some(stack_map) = get_map_at(&stacks_list, si) {
                                    // Update stack title/id if changed
                                    stack_map
                                        .insert("id", stack.id.as_str())
                                        .map_err(loro_err)?;
                                    stack_map
                                        .insert("title", stack.title.as_str())
                                        .map_err(loro_err)?;

                                    if let Some(cols_list) = get_movable_list(&stack_map, "columns")
                                    {
                                        for (ci, col) in stack.columns.iter().enumerate() {
                                            if ci >= cols_list.len() {
                                                let col_map: LoroMap = cols_list
                                                    .push_container(LoroMap::new())
                                                    .map_err(loro_err)?;
                                                col_map
                                                    .insert("id", col.id.as_str())
                                                    .map_err(loro_err)?;
                                                col_map
                                                    .insert("title", col.title.as_str())
                                                    .map_err(loro_err)?;
                                                let _: LoroMovableList = col_map
                                                    .insert_container(
                                                        "cards",
                                                        LoroMovableList::new(),
                                                    )
                                                    .map_err(loro_err)?;
                                            } else if let Some(col_map) = get_map_at(&cols_list, ci)
                                            {
                                                // Update column title/id if changed
                                                col_map
                                                    .insert("id", col.id.as_str())
                                                    .map_err(loro_err)?;
                                                col_map
                                                    .insert("title", col.title.as_str())
                                                    .map_err(loro_err)?;
                                            }
                                        }
                                        // Remove extra columns (deleted from end to avoid index shift)
                                        while cols_list.len() > stack.columns.len() {
                                            let _ = cols_list.delete(cols_list.len() - 1, 1);
                                        }
                                    }
                                }
                            }
                            // Remove extra stacks
                            while stacks_list.len() > row.stacks.len() {
                                let _ = stacks_list.delete(stacks_list.len() - 1, 1);
                            }
                        }
                    }
                }
                // Remove extra rows
                while rows_list.len() > incoming.rows.len() {
                    let _ = rows_list.delete(rows_list.len() - 1, 1);
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
                row_map.insert("title", row.title.as_str()).map_err(loro_err)?;
                let stacks_list: LoroMovableList = row_map
                    .insert_container("stacks", LoroMovableList::new())
                    .map_err(loro_err)?;
                for stack in &row.stacks {
                    let stack_map: LoroMap =
                        stacks_list.push_container(LoroMap::new()).map_err(loro_err)?;
                    stack_map.insert("id", stack.id.as_str()).map_err(loro_err)?;
                    stack_map.insert("title", stack.title.as_str()).map_err(loro_err)?;
                    let cols_list: LoroMovableList = stack_map
                        .insert_container("columns", LoroMovableList::new())
                        .map_err(loro_err)?;
                    for col in &stack.columns {
                        let col_map: LoroMap =
                            cols_list.push_container(LoroMap::new()).map_err(loro_err)?;
                        col_map.insert("id", col.id.as_str()).map_err(loro_err)?;
                        col_map.insert("title", col.title.as_str()).map_err(loro_err)?;
                        let cards_list: LoroMovableList = col_map
                            .insert_container("cards", LoroMovableList::new())
                            .map_err(loro_err)?;
                        // Populate cards from the incoming board
                        for card in &col.cards {
                            let card_map: LoroMap =
                                cards_list.push_container(LoroMap::new()).map_err(loro_err)?;
                            let kid = card.kid.as_deref().unwrap_or("");
                            let content = card_identity::strip_kid(&card.content);
                            card_map.insert("kid", kid).map_err(loro_err)?;
                            card_map.insert("content", content.as_str()).map_err(loro_err)?;
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
                        let col_map: LoroMap =
                            columns_list.push_container(LoroMap::new()).map_err(loro_err)?;
                        col_map.insert("id", col.id.as_str()).map_err(loro_err)?;
                        col_map.insert("title", col.title.as_str()).map_err(loro_err)?;
                        let _: LoroMovableList = col_map
                            .insert_container("cards", LoroMovableList::new())
                            .map_err(loro_err)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Find the cards LoroMovableList for a column by title.
    fn find_column_cards_list(&self, column_title: &str) -> Option<LoroMovableList> {
        let root = self.doc.get_map("root");
        let format = get_string(&root, "format");

        if format == "new" {
            let rows_list = get_movable_list(&root, "rows")?;
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
        self.doc.export(ExportMode::Snapshot).map_err(loro_err)
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
    ) {
        let board_for_meta = KanbanBoard {
            valid: true,
            title: String::new(),
            columns: Vec::new(),
            rows: Vec::new(),
            yaml_header,
            kanban_footer,
            board_settings,
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
        self.doc
            .export(ExportMode::updates(vv))
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))
    }

    /// Import remote CRDT updates into the local document.
    pub fn import_updates(&mut self, bytes: &[u8]) -> Result<loro::ImportStatus, io::Error> {
        let status = self
            .doc
            .import(bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        Ok(status)
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
        board.all_columns().iter()
            .flat_map(|col| col.cards.iter())
            .filter_map(|card| card.kid.clone())
            .collect()
    }

    #[test]
    fn test_concurrent_edit_different_cards() {
        let base = make_legacy_board(vec![
            ("Todo", vec![
                make_card("aaaa0001", "Card A", false),
                make_card("aaaa0002", "Card B", false),
            ]),
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

        let a_contents: Vec<&str> = result_a.columns[0].cards.iter().map(|c| c.content.as_str()).collect();
        let b_contents: Vec<&str> = result_b.columns[0].cards.iter().map(|c| c.content.as_str()).collect();

        assert!(a_contents.contains(&"Card A edited by peer A"));
        assert!(a_contents.contains(&"Card B edited by peer B"));
        assert_eq!(a_contents, b_contents);
    }

    #[test]
    fn test_concurrent_edit_same_card_lww() {
        let base = make_legacy_board(vec![
            ("Todo", vec![make_card("aaaa0001", "Original content", false)]),
        ]);
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
        assert_eq!(content_a, content_b, "both peers must converge to the same content");
        assert!(
            content_a == "Peer A version" || content_a == "Peer B version",
            "converged content must be one of the two writes, got: {}",
            content_a
        );

        let checked_a = result_a.columns[0].cards[0].checked;
        let checked_b = result_b.columns[0].cards[0].checked;
        assert_eq!(checked_a, checked_b, "both peers must converge to the same checked state");

        let kids_a = collect_kids(&result_a);
        let kids_b = collect_kids(&result_b);
        assert_eq!(kids_a, kids_b, "card identities must match after merge");
        assert!(kids_a.contains("aaaa0001"), "original card identity must survive");
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
            ("Todo", vec![
                make_card("aaaa0001", "Movable card", false),
                make_card("aaaa0002", "New card by peer A", false),
            ]),
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
        let base = make_legacy_board(vec![
            ("Todo", vec![
                make_card("aaaa0001", "Card to conflict", false),
                make_card("aaaa0002", "Survivor card", false),
            ]),
        ]);
        let (mut peer_a, mut peer_b) = make_two_peers(&base);

        let base_a = peer_a.to_board();
        let board_a = make_legacy_board(vec![
            ("Todo", vec![
                make_card("aaaa0002", "Survivor card", false),
            ]),
        ]);
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
        assert_eq!(kids_a, kids_b, "both peers must converge to the same card set");

        assert!(kids_a.contains("aaaa0002"), "uncontested card must survive");

        let total_a: usize = result_a.all_columns().iter().map(|c| c.cards.len()).sum();
        let total_b: usize = result_b.all_columns().iter().map(|c| c.cards.len()).sum();
        assert_eq!(total_a, total_b, "both peers must have the same total card count");
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
}
