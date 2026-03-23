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
pub struct CrdtStore {
    doc: LoroDoc,
    undo_mgr: UndoManager,
    /// Markdown-only metadata not tracked in the CRDT (Phase 1).
    yaml_header: Option<String>,
    kanban_footer: Option<String>,
    board_settings: Option<BoardSettings>,
}

impl std::fmt::Debug for CrdtStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CrdtStore")
            .field("yaml_header", &self.yaml_header)
            .field("kanban_footer", &self.kanban_footer)
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
        let col_map: LoroMap = columns_list.push_container(LoroMap::new()).map_err(loro_err)?;
        col_map.insert("id", col.id.as_str()).map_err(loro_err)?;
        col_map.insert("title", col.title.as_str()).map_err(loro_err)?;
        let cards_list: LoroMovableList = col_map
            .insert_container("cards", LoroMovableList::new())
            .map_err(loro_err)?;
        for card in &col.cards {
            insert_card(&cards_list, card)?;
        }
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

        let is_new_format = !board.rows.is_empty();
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
            let columns_list: LoroMovableList = root
                .insert_container("columns", LoroMovableList::new())
                .map_err(loro_err)?;
            populate_columns_list(&columns_list, &board.columns)?;
        }

        doc.commit();
        let undo_mgr = UndoManager::new(&doc);

        Ok(CrdtStore {
            doc,
            undo_mgr,
            yaml_header: board.yaml_header.clone(),
            kanban_footer: board.kanban_footer.clone(),
            board_settings: board.board_settings.clone(),
        })
    }

    /// Reconstruct a KanbanBoard from the CRDT state.
    pub fn to_board(&self) -> KanbanBoard {
        let root = self.doc.get_map("root");
        let title = get_string(&root, "title");
        let format = get_string(&root, "format");

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
                yaml_header: self.yaml_header.clone(),
                kanban_footer: self.kanban_footer.clone(),
                board_settings: self.board_settings.clone(),
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
                yaml_header: self.yaml_header.clone(),
                kanban_footer: self.kanban_footer.clone(),
                board_settings: self.board_settings.clone(),
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
        if changes.is_empty() {
            return Ok(());
        }

        // Update title if changed
        if incoming.title != current.title {
            let root = self.doc.get_map("root");
            root.insert("title", incoming.title.as_str()).map_err(loro_err)?;
        }

        // Update markdown metadata
        self.yaml_header = incoming.yaml_header.clone();
        self.kanban_footer = incoming.kanban_footer.clone();
        self.board_settings = incoming.board_settings.clone();

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
        } else {
            // Legacy format — add missing columns
            if let Some(columns_list) = get_movable_list(&root, "columns") {
                let existing_titles: Vec<String> = (0..columns_list.len())
                    .filter_map(|i| get_map_at(&columns_list, i).map(|m| get_string(&m, "title")))
                    .collect();

                for col in &incoming.columns {
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
        Ok(CrdtStore {
            doc,
            undo_mgr,
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
        })
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

    /// Update the stored markdown metadata (yaml_header, kanban_footer, board_settings).
    pub fn set_metadata(
        &mut self,
        yaml_header: Option<String>,
        kanban_footer: Option<String>,
        board_settings: Option<BoardSettings>,
    ) {
        self.yaml_header = yaml_header;
        self.kanban_footer = kanban_footer;
        self.board_settings = board_settings;
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

        let mut restored_store = CrdtStore::load(&bytes).unwrap();
        // Set metadata since it's not persisted in the CRDT bytes
        restored_store.set_metadata(
            board.yaml_header.clone(),
            board.kanban_footer.clone(),
            board.board_settings.clone(),
        );
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
        client_store.set_metadata(base.yaml_header.clone(), None, None);

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

        let mut restored = CrdtStore::load_from_file(tmp.path()).unwrap();
        restored.set_metadata(board.yaml_header.clone(), None, None);
        let restored_board = restored.to_board();

        assert_eq!(restored_board.columns[0].cards.len(), 1);
        assert!(restored_board.columns[0].cards[0]
            .content
            .contains("Persistent task"));
    }
}
