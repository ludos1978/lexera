/// Three-way merge at card level.
///
/// Given three board versions:
/// - base: last known common state
/// - theirs: current disk content (external changes)
/// - ours: the changes we want to apply
///
/// Merge logic per card (matched by kid):
/// - In all three, unchanged -> keep as-is
/// - Changed only in theirs -> accept theirs
/// - Changed only in ours -> accept ours
/// - Changed in both, different fields -> auto-merge
/// - Changed in both, same field, different values -> CONFLICT
/// - In base+theirs, not in ours -> user deleted, remove
/// - In base+ours, not in theirs -> external deleted, keep ours (conservative)
/// - Only in theirs -> added externally, include
/// - Only in ours -> added by user, include

use serde::{Deserialize, Serialize};

use crate::types::{KanbanBoard, KanbanCard, KanbanColumn};
use super::diff::snapshot_board;

/// Result of a three-way merge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    /// Merged board (best effort, even with conflicts)
    pub board: KanbanBoard,
    /// Unresolved conflicts
    pub conflicts: Vec<CardConflict>,
    /// Count of automatically merged changes
    pub auto_merged: usize,
}

/// A conflict on a specific card field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardConflict {
    pub card_id: String,
    pub column_title: String,
    pub field: ConflictField,
    pub base_value: String,
    pub theirs_value: String,
    pub ours_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictField {
    Content,
    Checked,
    Position,
}

/// Perform three-way merge between base, theirs (disk), and ours (incoming).
pub fn three_way_merge(
    base: &KanbanBoard,
    theirs: &KanbanBoard,
    ours: &KanbanBoard,
) -> MergeResult {
    let base_snap = snapshot_board(base);
    let theirs_snap = snapshot_board(theirs);
    let ours_snap = snapshot_board(ours);

    let mut conflicts = Vec::new();
    let mut auto_merged: usize = 0;

    // Build merged columns based on theirs (disk) as the structural base
    let mut merged_columns: Vec<KanbanColumn> = theirs.columns.iter().map(|col| {
        KanbanColumn {
            id: col.id.clone(),
            title: col.title.clone(),
            cards: Vec::new(),
            include_source: col.include_source.clone(),
        }
    }).collect();

    // Add any columns that exist only in ours
    for our_col in &ours.columns {
        if !merged_columns.iter().any(|c| c.title == our_col.title) {
            if base.columns.iter().any(|c| c.title == our_col.title) {
                // Column was in base and ours but not theirs -> externally deleted
                // Conservative: keep it
                merged_columns.push(KanbanColumn {
                    id: our_col.id.clone(),
                    title: our_col.title.clone(),
                    cards: Vec::new(),
                    include_source: our_col.include_source.clone(),
                });
            } else {
                // Column only in ours -> user added it
                merged_columns.push(KanbanColumn {
                    id: our_col.id.clone(),
                    title: our_col.title.clone(),
                    cards: Vec::new(),
                    include_source: our_col.include_source.clone(),
                });
            }
        }
    }

    // Collect all known kids
    let mut all_kids = std::collections::HashSet::new();
    for kid in base_snap.keys() { all_kids.insert(kid.clone()); }
    for kid in theirs_snap.keys() { all_kids.insert(kid.clone()); }
    for kid in ours_snap.keys() { all_kids.insert(kid.clone()); }

    // Process each card
    for kid in &all_kids {
        let in_base = base_snap.get(kid);
        let in_theirs = theirs_snap.get(kid);
        let in_ours = ours_snap.get(kid);

        match (in_base, in_theirs, in_ours) {
            // In all three
            (Some(b), Some(t), Some(o)) => {
                let content_changed_theirs = b.content != t.content;
                let content_changed_ours = b.content != o.content;
                let checked_changed_theirs = b.checked != t.checked;
                let checked_changed_ours = b.checked != o.checked;

                let merged_content;
                let merged_checked;

                // Content merge
                if content_changed_theirs && content_changed_ours && t.content != o.content {
                    // Both changed content differently -> conflict
                    conflicts.push(CardConflict {
                        card_id: kid.clone(),
                        column_title: t.column_title.clone(),
                        field: ConflictField::Content,
                        base_value: b.content.clone(),
                        theirs_value: t.content.clone(),
                        ours_value: o.content.clone(),
                    });
                    merged_content = o.content.clone(); // Default to ours for conflict resolution
                } else if content_changed_theirs {
                    merged_content = t.content.clone();
                    if content_changed_ours { auto_merged += 1; }
                } else {
                    merged_content = o.content.clone();
                }

                // Checked merge
                if checked_changed_theirs && checked_changed_ours && t.checked != o.checked {
                    conflicts.push(CardConflict {
                        card_id: kid.clone(),
                        column_title: t.column_title.clone(),
                        field: ConflictField::Checked,
                        base_value: b.checked.to_string(),
                        theirs_value: t.checked.to_string(),
                        ours_value: o.checked.to_string(),
                    });
                    merged_checked = o.checked;
                } else if checked_changed_theirs {
                    merged_checked = t.checked;
                    if checked_changed_ours { auto_merged += 1; }
                } else {
                    merged_checked = o.checked;
                }

                // Determine target column (use theirs if they moved it, ours if we moved it)
                let target_col = if b.column_title != t.column_title {
                    t.column_title.clone()
                } else {
                    o.column_title.clone()
                };

                let merged_card = KanbanCard {
                    id: String::new(),
                    content: merged_content,
                    checked: merged_checked,
                    kid: Some(kid.clone()),
                };

                add_card_to_column(&mut merged_columns, &target_col, merged_card);
            }

            // In base and theirs, not in ours -> user deleted
            (Some(_), Some(_), None) => {
                // User intentionally deleted this card, don't include it
            }

            // In base and ours, not in theirs -> externally deleted, keep ours (conservative)
            (Some(_), None, Some(o)) => {
                let card = KanbanCard {
                    id: String::new(),
                    content: o.content.clone(),
                    checked: o.checked,
                    kid: Some(kid.clone()),
                };
                add_card_to_column(&mut merged_columns, &o.column_title, card);
            }

            // Only in theirs -> externally added
            (None, Some(t), None) => {
                let card = KanbanCard {
                    id: String::new(),
                    content: t.content.clone(),
                    checked: t.checked,
                    kid: Some(kid.clone()),
                };
                add_card_to_column(&mut merged_columns, &t.column_title, card);
            }

            // Only in ours -> user added
            (None, None, Some(o)) => {
                let card = KanbanCard {
                    id: String::new(),
                    content: o.content.clone(),
                    checked: o.checked,
                    kid: Some(kid.clone()),
                };
                add_card_to_column(&mut merged_columns, &o.column_title, card);
            }

            // In theirs and ours, not in base -> both added independently
            (None, Some(t), Some(o)) => {
                // Keep both, but if content is the same, keep just one
                if t.content == o.content && t.checked == o.checked {
                    let card = KanbanCard {
                        id: String::new(),
                        content: t.content.clone(),
                        checked: t.checked,
                        kid: Some(kid.clone()),
                    };
                    add_card_to_column(&mut merged_columns, &t.column_title, card);
                } else {
                    // Different content with same kid is unusual, keep theirs version
                    let card = KanbanCard {
                        id: String::new(),
                        content: t.content.clone(),
                        checked: t.checked,
                        kid: Some(kid.clone()),
                    };
                    add_card_to_column(&mut merged_columns, &t.column_title, card);
                    auto_merged += 1;
                }
            }

            // Only in base (deleted by both) or not in any
            (Some(_), None, None) | (None, None, None) => {
                // Card removed by both sides or doesn't exist
            }
        }
    }

    // Copy board metadata from ours (the user's intent)
    let merged_board = KanbanBoard {
        valid: ours.valid,
        title: ours.title.clone(),
        columns: merged_columns,
        rows: ours.rows.clone(),
        yaml_header: ours.yaml_header.clone(),
        kanban_footer: ours.kanban_footer.clone(),
        board_settings: ours.board_settings.clone(),
    };

    MergeResult {
        board: merged_board,
        conflicts,
        auto_merged,
    }
}

/// Add a card to the appropriate column in the merged columns list.
fn add_card_to_column(columns: &mut [KanbanColumn], column_title: &str, card: KanbanCard) {
    if let Some(col) = columns.iter_mut().find(|c| c.title == column_title) {
        col.cards.push(card);
    } else if let Some(first) = columns.first_mut() {
        // Fallback: if target column doesn't exist, put in first column
        first.cards.push(card);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_merge_no_conflicts() {
        let base = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1", false)]),
        ]);
        // Theirs: changed content
        let theirs = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1 edited", false)]),
        ]);
        // Ours: changed checked
        let ours = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1", true)]),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());

        let merged_cards = &result.board.columns[0].cards;
        assert_eq!(merged_cards.len(), 1);
        assert_eq!(merged_cards[0].content, "Task 1 edited");
        assert!(merged_cards[0].checked);
    }

    #[test]
    fn test_merge_content_conflict() {
        let base = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1", false)]),
        ]);
        let theirs = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1 by Alice", false)]),
        ]);
        let ours = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1 by Bob", false)]),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].field, ConflictField::Content);
    }

    #[test]
    fn test_merge_card_added_by_theirs() {
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "New from Alice", false)]),
        ]);
        let ours = make_board(vec![("Todo", vec![])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert_eq!(result.board.columns[0].cards.len(), 1);
    }

    #[test]
    fn test_merge_card_added_by_ours() {
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![("Todo", vec![])]);
        let ours = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "New from Bob", false)]),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert_eq!(result.board.columns[0].cards.len(), 1);
    }

    #[test]
    fn test_merge_card_deleted_by_ours() {
        let base = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1", false)]),
        ]);
        let theirs = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1", false)]),
        ]);
        let ours = make_board(vec![("Todo", vec![])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert!(result.board.columns[0].cards.is_empty());
    }

    #[test]
    fn test_merge_card_deleted_by_theirs_kept_conservative() {
        let base = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1", false)]),
        ]);
        let theirs = make_board(vec![("Todo", vec![])]);
        let ours = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task 1", false)]),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        // Conservative: keep ours
        assert_eq!(result.board.columns[0].cards.len(), 1);
    }

    #[test]
    fn test_merge_both_add_cards() {
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Alice's task", false)]),
        ]);
        let ours = make_board(vec![
            ("Todo", vec![make_card("bbb00001", "Bob's task", false)]),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert_eq!(result.board.columns[0].cards.len(), 2);
    }

    #[test]
    fn test_merge_empty_boards() {
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![("Todo", vec![])]);
        let ours = make_board(vec![("Todo", vec![])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert!(result.board.columns[0].cards.is_empty());
    }
}
