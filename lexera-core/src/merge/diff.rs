use super::card_identity;
use crate::types::{KanbanBoard, KanbanCard};
/// Card-level diff between two board versions.
///
/// Compares boards at the card level using kid (persistent card identity).
/// Produces a list of changes: added, removed, modified, moved cards.
use std::collections::HashMap;

/// A single card change between two board versions.
#[derive(Debug, Clone, PartialEq)]
pub enum CardChange {
    Added {
        kid: String,
        column_id: String,
        column_title: String,
        card: KanbanCard,
    },
    Removed {
        kid: String,
        column_id: String,
        column_title: String,
    },
    Modified {
        kid: String,
        column_id: String,
        column_title: String,
        old_content: String,
        new_content: String,
        old_checked: bool,
        new_checked: bool,
        old_params: HashMap<String, String>,
        new_params: HashMap<String, String>,
    },
    Moved {
        kid: String,
        old_column_id: String,
        old_column: String,
        new_column_id: String,
        new_column: String,
    },
}

impl CardChange {
    /// The kid of the card this change concerns.
    pub fn kid(&self) -> &str {
        match self {
            CardChange::Added { kid, .. }
            | CardChange::Removed { kid, .. }
            | CardChange::Modified { kid, .. }
            | CardChange::Moved { kid, .. } => kid,
        }
    }
}

/// Snapshot of a card's state for comparison.
#[derive(Debug, Clone)]
pub struct CardSnapshot {
    pub kid: String,
    pub column_id: String,
    pub column_title: String,
    pub content: String,
    pub checked: bool,
    pub params: HashMap<String, String>,
    pub position: usize,
}

/// Build a map of kid -> CardSnapshot from a board.
pub fn snapshot_board(board: &KanbanBoard) -> HashMap<String, CardSnapshot> {
    let mut map = HashMap::new();
    for col in board.all_columns() {
        for (pos, card) in col.cards.iter().enumerate() {
            let kid = card
                .kid
                .clone()
                .unwrap_or_else(|| card_identity::extract_kid(&card.content).unwrap_or_default());
            if kid.is_empty() {
                continue; // Can't track cards without kid
            }
            map.insert(
                kid.clone(),
                CardSnapshot {
                    kid,
                    column_id: col.id.clone(),
                    column_title: col.title.clone(),
                    content: card_identity::strip_kid(&card.content),
                    checked: card.checked,
                    params: card.params.clone(),
                    position: pos,
                },
            );
        }
    }
    map
}

/// Compute changes between two board versions.
pub fn diff_boards(old_board: &KanbanBoard, new_board: &KanbanBoard) -> Vec<CardChange> {
    let old_snap = snapshot_board(old_board);
    let new_snap = snapshot_board(new_board);
    let mut changes = Vec::new();

    // Find removed and modified cards
    for (kid, old_card) in &old_snap {
        match new_snap.get(kid) {
            None => {
                changes.push(CardChange::Removed {
                    kid: kid.clone(),
                    column_id: old_card.column_id.clone(),
                    column_title: old_card.column_title.clone(),
                });
            }
            Some(new_card) => {
                if old_card.column_id != new_card.column_id {
                    changes.push(CardChange::Moved {
                        kid: kid.clone(),
                        old_column_id: old_card.column_id.clone(),
                        old_column: old_card.column_title.clone(),
                        new_column_id: new_card.column_id.clone(),
                        new_column: new_card.column_title.clone(),
                    });
                }
                if old_card.content != new_card.content
                    || old_card.checked != new_card.checked
                    || old_card.params != new_card.params
                {
                    changes.push(CardChange::Modified {
                        kid: kid.clone(),
                        column_id: new_card.column_id.clone(),
                        column_title: new_card.column_title.clone(),
                        old_content: old_card.content.clone(),
                        new_content: new_card.content.clone(),
                        old_checked: old_card.checked,
                        new_checked: new_card.checked,
                        old_params: old_card.params.clone(),
                        new_params: new_card.params.clone(),
                    });
                }
            }
        }
    }

    // Find added cards
    for (kid, new_card) in &new_snap {
        if !old_snap.contains_key(kid) {
            // Reconstruct a minimal KanbanCard for the Added variant
            changes.push(CardChange::Added {
                kid: kid.clone(),
                column_id: new_card.column_id.clone(),
                column_title: new_card.column_title.clone(),
                card: KanbanCard {
                    id: String::new(),
                    content: new_card.content.clone(),
                    checked: new_card.checked,
                    kid: Some(kid.clone()),
                    params: new_card.params.clone(),
                },
            });
        }
    }

    changes
}

/// Locate the `(column_index, card_index)` of a card by kid across all
/// columns (rows→stacks→columns flattened, or legacy flat columns).
fn locate_card_by_kid(board: &KanbanBoard, kid: &str) -> Option<(usize, usize)> {
    for (ci, col) in board.all_columns().iter().enumerate() {
        for (ki, card) in col.cards.iter().enumerate() {
            let card_kid = card
                .kid
                .clone()
                .unwrap_or_else(|| card_identity::extract_kid(&card.content).unwrap_or_default());
            if !card_kid.is_empty() && card_kid == kid {
                return Some((ci, ki));
            }
        }
    }
    None
}

/// Pick a destination column index: prefer matching `id`, then `title`,
/// then fall back to the first column. Returns `None` only for a board
/// with no columns at all.
fn resolve_target_column(board: &KanbanBoard, column_id: &str, column_title: &str) -> Option<usize> {
    let cols = board.all_columns();
    if cols.is_empty() {
        return None;
    }
    if let Some(idx) = cols.iter().position(|c| c.id == column_id) {
        return Some(idx);
    }
    if let Some(idx) = cols.iter().position(|c| c.title == column_title) {
        return Some(idx);
    }
    Some(0)
}

/// Apply a single [`CardChange`] onto `board` in place, identifying cards
/// by kid. Returns `true` when the change was applied, `false` when it was
/// a no-op (target missing / nothing to do). This is the building block of
/// the non-CRDT card-identity 3-way merge: changes from one source are
/// replayed onto the other source's board.
pub fn apply_change(board: &mut KanbanBoard, change: &CardChange) -> bool {
    match change {
        CardChange::Added {
            kid,
            column_id,
            column_title,
            card,
        } => {
            if locate_card_by_kid(board, kid).is_some() {
                return false; // already present — caller decides conflict
            }
            let Some(target) = resolve_target_column(board, column_id, column_title) else {
                return false;
            };
            let mut new_card = card.clone();
            new_card.kid = Some(kid.clone());
            let mut cols = board.all_columns_mut();
            cols[target].cards.push(new_card);
            true
        }
        CardChange::Removed { kid, .. } => {
            let Some((ci, ki)) = locate_card_by_kid(board, kid) else {
                return false;
            };
            let mut cols = board.all_columns_mut();
            cols[ci].cards.remove(ki);
            true
        }
        CardChange::Modified {
            kid,
            new_content,
            new_checked,
            new_params,
            ..
        } => {
            let Some((ci, ki)) = locate_card_by_kid(board, kid) else {
                return false;
            };
            let mut cols = board.all_columns_mut();
            let card = &mut cols[ci].cards[ki];
            card.content = new_content.clone();
            card.checked = *new_checked;
            card.params = new_params.clone();
            true
        }
        CardChange::Moved {
            kid,
            new_column_id,
            new_column,
            ..
        } => {
            let Some((ci, ki)) = locate_card_by_kid(board, kid) else {
                return false;
            };
            let Some(target) = resolve_target_column(board, new_column_id, new_column) else {
                return false;
            };
            if target == ci {
                return false;
            }
            let mut cols = board.all_columns_mut();
            let card = cols[ci].cards.remove(ki);
            cols[target].cards.push(card);
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BoardFormat, KanbanBoard, KanbanColumn, KanbanRow, KanbanStack};

    fn make_card(kid: &str, content: &str, checked: bool) -> KanbanCard {
        KanbanCard {
            id: "test".to_string(),
            content: content.to_string(),
            checked,
            kid: Some(kid.to_string()),
            params: HashMap::new(),
        }
    }

    fn make_board(columns: Vec<(&str, Vec<KanbanCard>)>) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test".to_string(),
            columns: columns
                .into_iter()
                .enumerate()
                .map(|(i, (title, cards))| KanbanColumn {
                    id: format!("col-{}", i),
                    title: title.to_string(),
                    cards,
                    include_source: None,
                    params: HashMap::new(),
                })
                .collect(),
            rows: Vec::new(),
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            format_hint: BoardFormat::Legacy,
            generation_meta: None,
        }
    }

    #[test]
    fn test_diff_no_changes() {
        let board = make_board(vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])]);
        let changes = diff_boards(&board, &board);
        assert!(changes.is_empty());
    }

    #[test]
    fn test_diff_added_card() {
        let old = make_board(vec![("Todo", vec![])]);
        let new = make_board(vec![(
            "Todo",
            vec![make_card("aaaa0001", "New task", false)],
        )]);
        let changes = diff_boards(&old, &new);
        assert_eq!(changes.len(), 1);
        assert!(matches!(&changes[0], CardChange::Added { kid, .. } if kid == "aaaa0001"));
    }

    #[test]
    fn test_diff_removed_card() {
        let old = make_board(vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])]);
        let new = make_board(vec![("Todo", vec![])]);
        let changes = diff_boards(&old, &new);
        assert_eq!(changes.len(), 1);
        assert!(matches!(&changes[0], CardChange::Removed { kid, .. } if kid == "aaaa0001"));
    }

    #[test]
    fn test_diff_modified_card() {
        let old = make_board(vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])]);
        let new = make_board(vec![(
            "Todo",
            vec![make_card("aaaa0001", "Task 1 updated", true)],
        )]);
        let changes = diff_boards(&old, &new);
        assert_eq!(changes.len(), 1);
        assert!(matches!(&changes[0], CardChange::Modified { kid, .. } if kid == "aaaa0001"));
    }

    #[test]
    fn test_diff_moved_card() {
        let old = make_board(vec![
            ("Todo", vec![make_card("aaaa0001", "Task 1", false)]),
            ("Done", vec![]),
        ]);
        let new = make_board(vec![
            ("Todo", vec![]),
            ("Done", vec![make_card("aaaa0001", "Task 1", false)]),
        ]);
        let changes = diff_boards(&old, &new);
        assert!(changes.iter().any(
            |c| matches!(c, CardChange::Moved { kid, old_column, new_column, .. }
                if kid == "aaaa0001" && old_column == "Todo" && new_column == "Done"
            )
        ));
    }

    fn make_new_format_board(
        rows: Vec<(&str, Vec<(&str, Vec<(&str, Vec<KanbanCard>)>)>)>,
    ) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test".to_string(),
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
                                    params: HashMap::new(),
                                })
                                .collect(),
                            params: HashMap::new(),
                        })
                        .collect(),
                    params: HashMap::new(),
                })
                .collect(),
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        }
    }

    #[test]
    fn test_snapshot_new_format_board() {
        let board = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![
                    ("Todo", vec![make_card("aaaa0001", "Task 1", false)]),
                    ("Done", vec![make_card("aaaa0002", "Task 2", true)]),
                ],
            )],
        )]);
        let snap = snapshot_board(&board);
        assert_eq!(snap.len(), 2);
        assert!(snap.contains_key("aaaa0001"));
        assert!(snap.contains_key("aaaa0002"));
        assert_eq!(snap["aaaa0001"].column_title, "Todo");
        assert_eq!(snap["aaaa0002"].column_title, "Done");
    }

    #[test]
    fn test_diff_new_format_no_changes() {
        let board = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])],
            )],
        )]);
        let changes = diff_boards(&board, &board);
        assert!(changes.is_empty());
    }

    #[test]
    fn test_diff_new_format_modified_card() {
        let old = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])],
            )],
        )]);
        let new = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![("Todo", vec![make_card("aaaa0001", "Task 1 updated", true)])],
            )],
        )]);
        let changes = diff_boards(&old, &new);
        assert_eq!(changes.len(), 1);
        assert!(matches!(&changes[0], CardChange::Modified { kid, .. } if kid == "aaaa0001"));
    }

    #[test]
    fn test_diff_new_format_moved_across_stacks() {
        let old = make_new_format_board(vec![(
            "Row 1",
            vec![
                (
                    "Stack A",
                    vec![("Todo", vec![make_card("aaaa0001", "Task 1", false)])],
                ),
                ("Stack B", vec![("Done", vec![])]),
            ],
        )]);
        let new = make_new_format_board(vec![(
            "Row 1",
            vec![
                ("Stack A", vec![("Todo", vec![])]),
                (
                    "Stack B",
                    vec![("Done", vec![make_card("aaaa0001", "Task 1", false)])],
                ),
            ],
        )]);
        let changes = diff_boards(&old, &new);
        assert!(changes.iter().any(
            |c| matches!(c, CardChange::Moved { kid, old_column, new_column, .. }
                if kid == "aaaa0001" && old_column == "Todo" && new_column == "Done"
            )
        ));
    }

    #[test]
    fn test_diff_detects_move_between_same_titled_columns_by_id() {
        let card = make_card("aaaa0001", "Task 1", false);
        let old = KanbanBoard {
            valid: true,
            title: "Test".to_string(),
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
                            cards: vec![card.clone()],
                            include_source: None,
                            params: HashMap::new(),
                        }],
                        params: HashMap::new(),
                    },
                    KanbanStack {
                        id: "stack-b".to_string(),
                        title: "Stack B".to_string(),
                        columns: vec![KanbanColumn {
                            id: "col-b".to_string(),
                            title: "Todo".to_string(),
                            cards: vec![],
                            include_source: None,
                            params: HashMap::new(),
                        }],
                        params: HashMap::new(),
                    },
                ],
                params: HashMap::new(),
            }],
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::New,
        };
        let new = KanbanBoard {
            rows: vec![KanbanRow {
                stacks: vec![
                    KanbanStack {
                        columns: vec![KanbanColumn {
                            cards: vec![],
                            ..old.rows[0].stacks[0].columns[0].clone()
                        }],
                        ..old.rows[0].stacks[0].clone()
                    },
                    KanbanStack {
                        columns: vec![KanbanColumn {
                            cards: vec![card],
                            ..old.rows[0].stacks[1].columns[0].clone()
                        }],
                        ..old.rows[0].stacks[1].clone()
                    },
                ],
                ..old.rows[0].clone()
            }],
            ..old.clone()
        };

        let changes = diff_boards(&old, &new);
        assert!(changes.iter().any(|c| {
            matches!(
                c,
                CardChange::Moved {
                    kid,
                    old_column_id,
                    old_column,
                    new_column_id,
                    new_column,
                }
                if kid == "aaaa0001"
                    && old_column_id == "col-a"
                    && old_column == "Todo"
                    && new_column_id == "col-b"
                    && new_column == "Todo"
            )
        }));
    }
}
