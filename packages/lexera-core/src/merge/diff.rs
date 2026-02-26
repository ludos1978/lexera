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
        column_title: String,
        card: KanbanCard,
    },
    Removed {
        kid: String,
        column_title: String,
    },
    Modified {
        kid: String,
        column_title: String,
        old_content: String,
        new_content: String,
        old_checked: bool,
        new_checked: bool,
    },
    Moved {
        kid: String,
        old_column: String,
        new_column: String,
    },
}

/// Snapshot of a card's state for comparison.
#[derive(Debug, Clone)]
pub struct CardSnapshot {
    pub kid: String,
    pub column_title: String,
    pub content: String,
    pub checked: bool,
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
                    column_title: col.title.clone(),
                    content: card_identity::strip_kid(&card.content),
                    checked: card.checked,
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
                    column_title: old_card.column_title.clone(),
                });
            }
            Some(new_card) => {
                if old_card.column_title != new_card.column_title {
                    changes.push(CardChange::Moved {
                        kid: kid.clone(),
                        old_column: old_card.column_title.clone(),
                        new_column: new_card.column_title.clone(),
                    });
                }
                if old_card.content != new_card.content || old_card.checked != new_card.checked {
                    changes.push(CardChange::Modified {
                        kid: kid.clone(),
                        column_title: new_card.column_title.clone(),
                        old_content: old_card.content.clone(),
                        new_content: new_card.content.clone(),
                        old_checked: old_card.checked,
                        new_checked: new_card.checked,
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
                column_title: new_card.column_title.clone(),
                card: KanbanCard {
                    id: String::new(),
                    content: new_card.content.clone(),
                    checked: new_card.checked,
                    kid: Some(kid.clone()),
                },
            });
        }
    }

    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{KanbanBoard, KanbanColumn, KanbanRow, KanbanStack};

    fn make_card(kid: &str, content: &str, checked: bool) -> KanbanCard {
        KanbanCard {
            id: "test".to_string(),
            content: format!("{} <!-- kid:{} -->", content, kid),
            checked,
            kid: Some(kid.to_string()),
        }
    }

    fn make_board(columns: Vec<(&str, Vec<KanbanCard>)>) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test".to_string(),
            columns: columns
                .into_iter()
                .map(|(title, cards)| KanbanColumn {
                    id: "col".to_string(),
                    title: title.to_string(),
                    cards,
                    include_source: None,
                })
                .collect(),
            rows: Vec::new(),
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
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
            |c| matches!(c, CardChange::Moved { kid, old_column, new_column }
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
                                })
                                .collect(),
                        })
                        .collect(),
                })
                .collect(),
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
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
            |c| matches!(c, CardChange::Moved { kid, old_column, new_column }
                if kid == "aaaa0001" && old_column == "Todo" && new_column == "Done"
            )
        ));
    }
}
