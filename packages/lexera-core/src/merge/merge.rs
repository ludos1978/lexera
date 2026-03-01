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

use super::diff::snapshot_board;
use crate::types::{KanbanBoard, KanbanCard, KanbanColumn};

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
    let mut merged_columns: Vec<KanbanColumn> = theirs
        .all_columns()
        .iter()
        .map(|col| KanbanColumn {
            id: col.id.clone(),
            title: col.title.clone(),
            cards: Vec::new(),
            include_source: col.include_source.clone(),
        })
        .collect();

    // Add any columns that exist only in ours
    for our_col in ours.all_columns() {
        if !merged_columns.iter().any(|c| c.title == our_col.title) {
            if base.all_columns().iter().any(|c| c.title == our_col.title) {
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
    for kid in base_snap.keys() {
        all_kids.insert(kid.clone());
    }
    for kid in theirs_snap.keys() {
        all_kids.insert(kid.clone());
    }
    for kid in ours_snap.keys() {
        all_kids.insert(kid.clone());
    }

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
                    if content_changed_ours {
                        auto_merged += 1;
                    }
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
                    if checked_changed_ours {
                        auto_merged += 1;
                    }
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
    // For new-format boards, reconstruct the rows/stacks hierarchy with merged card data
    let (final_columns, final_rows) = if !ours.rows.is_empty() {
        let mut rows = ours.rows.clone();
        for row in &mut rows {
            for stack in &mut row.stacks {
                for col in &mut stack.columns {
                    if let Some(mc) = merged_columns.iter().find(|mc| mc.title == col.title) {
                        col.cards = mc.cards.clone();
                    }
                }
            }
        }
        // Columns added by theirs that don't exist in ours' structure -> add to first stack of first row
        for mc in &merged_columns {
            let exists_in_rows = rows.iter().any(|r| {
                r.stacks
                    .iter()
                    .any(|s| s.columns.iter().any(|c| c.title == mc.title))
            });
            if !exists_in_rows && !mc.cards.is_empty() {
                if let Some(first_stack) = rows.first_mut().and_then(|r| r.stacks.first_mut()) {
                    first_stack.columns.push(mc.clone());
                }
            }
        }
        (Vec::new(), rows)
    } else {
        (merged_columns, Vec::new())
    };

    let merged_board = KanbanBoard {
        valid: ours.valid,
        title: ours.title.clone(),
        columns: final_columns,
        rows: final_rows,
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
    use crate::types::{KanbanRow, KanbanStack};

    fn make_card(kid: &str, content: &str, checked: bool) -> KanbanCard {
        KanbanCard {
            id: "test".to_string(),
            content: content.to_string(),
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
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", false)])]);
        // Theirs: changed content
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Task 1 edited", false)],
        )]);
        // Ours: changed checked
        let ours = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", true)])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());

        let merged_cards = &result.board.columns[0].cards;
        assert_eq!(merged_cards.len(), 1);
        assert_eq!(merged_cards[0].content, "Task 1 edited");
        assert!(merged_cards[0].checked);
    }

    #[test]
    fn test_merge_content_conflict() {
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", false)])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Task 1 by Alice", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Task 1 by Bob", false)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].field, ConflictField::Content);
    }

    #[test]
    fn test_merge_card_added_by_theirs() {
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "New from Alice", false)],
        )]);
        let ours = make_board(vec![("Todo", vec![])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert_eq!(result.board.columns[0].cards.len(), 1);
    }

    #[test]
    fn test_merge_card_added_by_ours() {
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![("Todo", vec![])]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "New from Bob", false)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert_eq!(result.board.columns[0].cards.len(), 1);
    }

    #[test]
    fn test_merge_card_deleted_by_ours() {
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", false)])]);
        let theirs = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", false)])]);
        let ours = make_board(vec![("Todo", vec![])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert!(result.board.columns[0].cards.is_empty());
    }

    #[test]
    fn test_merge_card_deleted_by_theirs_kept_conservative() {
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", false)])]);
        let theirs = make_board(vec![("Todo", vec![])]);
        let ours = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", false)])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        // Conservative: keep ours
        assert_eq!(result.board.columns[0].cards.len(), 1);
    }

    #[test]
    fn test_merge_both_add_cards() {
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Alice's task", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("bbb00001", "Bob's task", false)],
        )]);

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
    fn test_merge_new_format_no_conflicts() {
        let base = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![("Todo", vec![make_card("aaa00001", "Task 1", false)])],
            )],
        )]);
        // Theirs: changed content
        let theirs = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![("Todo", vec![make_card("aaa00001", "Task 1 edited", false)])],
            )],
        )]);
        // Ours: changed checked
        let ours = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![("Todo", vec![make_card("aaa00001", "Task 1", true)])],
            )],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());

        // Result should be new format (rows, not flat columns)
        assert!(result.board.columns.is_empty());
        assert_eq!(result.board.rows.len(), 1);
        let merged_col = &result.board.rows[0].stacks[0].columns[0];
        assert_eq!(merged_col.cards.len(), 1);
        assert_eq!(merged_col.cards[0].content, "Task 1 edited");
        assert!(merged_col.cards[0].checked);
    }

    #[test]
    fn test_merge_new_format_preserves_structure() {
        let base = make_new_format_board(vec![(
            "Row 1",
            vec![
                (
                    "Stack A",
                    vec![
                        ("Todo", vec![make_card("aaa00001", "Task 1", false)]),
                        ("Done", vec![]),
                    ],
                ),
                (
                    "Stack B",
                    vec![("Review", vec![make_card("bbb00001", "Task 2", false)])],
                ),
            ],
        )]);
        let theirs = base.clone();
        let ours = base.clone();

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());

        // Structure should be preserved: 1 row, 2 stacks, 3 columns total
        assert_eq!(result.board.rows.len(), 1);
        assert_eq!(result.board.rows[0].stacks.len(), 2);
        assert_eq!(result.board.rows[0].stacks[0].columns.len(), 2);
        assert_eq!(result.board.rows[0].stacks[1].columns.len(), 1);
        assert_eq!(result.board.rows[0].stacks[0].columns[0].title, "Todo");
        assert_eq!(result.board.rows[0].stacks[0].columns[1].title, "Done");
        assert_eq!(result.board.rows[0].stacks[1].columns[0].title, "Review");
    }

    #[test]
    fn test_merge_new_format_card_added_by_theirs() {
        let base =
            make_new_format_board(vec![("Row 1", vec![("Stack A", vec![("Todo", vec![])])])]);
        let theirs = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![("Todo", vec![make_card("aaa00001", "New from Alice", false)])],
            )],
        )]);
        let ours = base.clone();

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert_eq!(result.board.rows[0].stacks[0].columns[0].cards.len(), 1);
    }

    // ---------------------------------------------------------------
    // Complex multi-card merge (many cards, mixed operations)
    // ---------------------------------------------------------------

    #[test]
    fn test_merge_complex_multi_card() {
        // Base has 4 cards across 2 columns
        let base = make_board(vec![
            (
                "Todo",
                vec![
                    make_card("aaa00001", "Task A", false),
                    make_card("aaa00002", "Task B", false),
                ],
            ),
            (
                "Done",
                vec![
                    make_card("aaa00003", "Task C", true),
                    make_card("aaa00004", "Task D", true),
                ],
            ),
        ]);

        // Theirs: modified Task A content, deleted Task D, added Task E
        let theirs = make_board(vec![
            (
                "Todo",
                vec![
                    make_card("aaa00001", "Task A updated by theirs", false),
                    make_card("aaa00002", "Task B", false),
                ],
            ),
            (
                "Done",
                vec![
                    make_card("aaa00003", "Task C", true),
                    // Task D removed
                    make_card("aaa00005", "Task E new", false),
                ],
            ),
        ]);

        // Ours: checked Task B, moved Task A to Done, deleted Task C
        let ours = make_board(vec![
            (
                "Todo",
                vec![make_card("aaa00002", "Task B", true)],
            ),
            (
                "Done",
                vec![
                    // Task C removed by us
                    make_card("aaa00001", "Task A", false),
                    make_card("aaa00004", "Task D", true),
                ],
            ),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);

        // Task A: theirs changed content, ours moved to Done. Content should be theirs',
        // column should use theirs' column since b.column_title (Todo) != t.column_title (Todo) is false,
        // so it uses ours column (Done).
        // Actually: base col=Todo, theirs col=Todo, ours col=Done.
        // theirs didn't move it (base=theirs=Todo), so target = ours col = Done.
        let all_cards: Vec<_> = result
            .board
            .columns
            .iter()
            .flat_map(|c| c.cards.iter().map(move |card| (c.title.clone(), card)))
            .collect();

        let task_a = all_cards
            .iter()
            .find(|(_, card)| card.kid.as_deref() == Some("aaa00001"));
        assert!(task_a.is_some());
        let (col, card) = task_a.unwrap();
        assert_eq!(card.content, "Task A updated by theirs");
        assert_eq!(col, "Done");

        // Task B: ours checked it, no content change from either side
        let task_b = all_cards
            .iter()
            .find(|(_, card)| card.kid.as_deref() == Some("aaa00002"));
        assert!(task_b.is_some());
        assert!(task_b.unwrap().1.checked);

        // Task C: in base+theirs, not in ours => user deleted, should be removed
        let task_c = all_cards
            .iter()
            .find(|(_, card)| card.kid.as_deref() == Some("aaa00003"));
        assert!(task_c.is_none());

        // Task D: in base+ours, not in theirs => externally deleted, conservative keeps ours
        let task_d = all_cards
            .iter()
            .find(|(_, card)| card.kid.as_deref() == Some("aaa00004"));
        assert!(task_d.is_some());

        // Task E: only in theirs => added externally, should be included
        let task_e = all_cards
            .iter()
            .find(|(_, card)| card.kid.as_deref() == Some("aaa00005"));
        assert!(task_e.is_some());
        assert_eq!(task_e.unwrap().1.content, "Task E new");

        assert!(result.conflicts.is_empty());
    }

    // ---------------------------------------------------------------
    // Both content AND checked changed on different sides
    // ---------------------------------------------------------------

    #[test]
    fn test_merge_content_theirs_checked_ours() {
        // Theirs changes content, ours changes checked => auto-merge, no conflict
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Original", false)])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Updated by theirs", false)],
        )]);
        let ours = make_board(vec![("Todo", vec![make_card("aaa00001", "Original", true)])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let card = &result.board.columns[0].cards[0];
        assert_eq!(card.content, "Updated by theirs");
        assert!(card.checked);
    }

    #[test]
    fn test_merge_content_ours_checked_theirs() {
        // Ours changes content, theirs changes checked => auto-merge, no conflict
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Original", false)])]);
        let theirs = make_board(vec![("Todo", vec![make_card("aaa00001", "Original", true)])]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Updated by ours", false)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let card = &result.board.columns[0].cards[0];
        assert_eq!(card.content, "Updated by ours");
        assert!(card.checked);
    }

    #[test]
    fn test_merge_both_content_and_checked_conflict() {
        // Both sides change content differently AND both change checked differently
        // => two conflicts (one for content, one for checked)
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Original", false)])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Theirs version", true)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Ours version", true)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        // Content conflict (different content), but checked is the same (both true) => no checked conflict
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].field, ConflictField::Content);
    }

    #[test]
    fn test_merge_both_content_and_checked_two_conflicts() {
        // Both sides change content differently AND checked differently
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Original", false)])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Theirs version", true)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Ours version", false)],
        )]);

        // base checked=false, theirs=true, ours=false. Both changed from base? No:
        // ours checked (false) == base checked (false), so only theirs changed checked.
        // That means checked takes theirs' value, no conflict on checked.
        // Content: both changed differently => conflict on content.
        let result = three_way_merge(&base, &theirs, &ours);
        let content_conflicts: Vec<_> = result
            .conflicts
            .iter()
            .filter(|c| c.field == ConflictField::Content)
            .collect();
        assert_eq!(content_conflicts.len(), 1);
        // Checked should be theirs' value (true) since only theirs changed it
        let card = &result.board.columns[0].cards[0];
        assert!(card.checked);
    }

    #[test]
    fn test_merge_real_two_conflicts_content_and_checked() {
        // Construct a scenario where BOTH content and checked produce conflicts.
        // base: content="Original", checked=false
        // theirs: content="Theirs edit", checked=true
        // ours: content="Ours edit", checked=false  -- wait, ours checked == base checked, no conflict
        // Need: base checked differs from both theirs and ours, and theirs != ours for checked.
        // That's impossible with bool if base=false: theirs=true, ours must be true (no conflict) or false (== base).
        // With base=true: theirs=false, ours=false => theirs==ours, no conflict.
        // So checked can only truly conflict when base=false, theirs=true, ours=true... but those are equal.
        // Or base=true, theirs=false, ours=false... equal again.
        // Actually: base=true, theirs=false, ours=false means both changed but to the same value => auto-merge.
        // Boolean can never produce a true conflict where theirs != ours AND both changed from base,
        // because there are only two boolean values. If both changed from base, they must have gone to the same value.
        // This test verifies that understanding.
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Original", true)])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Theirs edit", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Ours edit", false)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        // Both changed checked from true->false (same), so auto-merge on checked.
        // Both changed content differently => conflict on content only.
        let checked_conflicts: Vec<_> = result
            .conflicts
            .iter()
            .filter(|c| c.field == ConflictField::Checked)
            .collect();
        assert_eq!(checked_conflicts.len(), 0);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].field, ConflictField::Content);
        // Checked should be false (both agree)
        let card = &result.board.columns[0].cards[0];
        assert!(!card.checked);
    }

    // ---------------------------------------------------------------
    // Fallback column behavior when target column missing
    // ---------------------------------------------------------------

    #[test]
    fn test_merge_fallback_column_when_target_missing() {
        // Card wants to go to "Review" column but that column doesn't exist in merged result.
        // The fallback should put it in the first column.
        let base = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task A", false)]),
            ("Review", vec![]),
        ]);
        // Theirs: removed Review column entirely
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Task A", false)],
        )]);
        // Ours: moved card to Review
        let ours = make_board(vec![
            ("Todo", vec![]),
            ("Review", vec![make_card("aaa00001", "Task A", false)]),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);

        // The card target column is "Review" (ours moved it).
        // "Review" is re-added by the column merge logic (it was in base+ours but not theirs).
        // So the card should end up in Review.
        let all_cards: Vec<_> = result
            .board
            .columns
            .iter()
            .flat_map(|c| c.cards.iter().map(move |card| (c.title.clone(), card)))
            .collect();
        let task_a = all_cards
            .iter()
            .find(|(_, card)| card.kid.as_deref() == Some("aaa00001"));
        assert!(task_a.is_some());
        // Conservative merge keeps the Review column from ours, so card lands there
        assert_eq!(task_a.unwrap().0, "Review");
    }

    #[test]
    fn test_add_card_to_column_fallback_first() {
        // Directly test add_card_to_column with a missing target column
        let mut columns = vec![
            KanbanColumn {
                id: "c1".into(),
                title: "First".into(),
                cards: vec![],
                include_source: None,
            },
            KanbanColumn {
                id: "c2".into(),
                title: "Second".into(),
                cards: vec![],
                include_source: None,
            },
        ];
        let card = make_card("aaa00001", "Orphan card", false);
        add_card_to_column(&mut columns, "Nonexistent", card);

        // Should fall back to the first column
        assert_eq!(columns[0].cards.len(), 1);
        assert_eq!(columns[0].cards[0].content, "Orphan card");
        assert_eq!(columns[1].cards.len(), 0);
    }

    // ---------------------------------------------------------------
    // Card appearing in both sides with modifications
    // ---------------------------------------------------------------

    #[test]
    fn test_merge_card_in_theirs_and_ours_not_base_same_content() {
        // Both sides independently add a card with the same kid and same content
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Shared idea", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Shared idea", false)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        // Same content+checked => deduplicated to one card
        let total_cards: usize = result.board.columns.iter().map(|c| c.cards.len()).sum();
        assert_eq!(total_cards, 1);
    }

    #[test]
    fn test_merge_card_in_theirs_and_ours_not_base_different_content() {
        // Both sides independently add a card with the same kid but different content
        let base = make_board(vec![("Todo", vec![])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Version A", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Version B", true)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        // Different content with same kid, not in base => keeps theirs, auto_merged +1
        assert!(result.conflicts.is_empty());
        assert!(result.auto_merged >= 1);
        let card = &result.board.columns[0].cards[0];
        assert_eq!(card.content, "Version A");
    }

    #[test]
    fn test_merge_card_both_deleted() {
        // Card in base but deleted by both theirs and ours
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Old task", false)])]);
        let theirs = make_board(vec![("Todo", vec![])]);
        let ours = make_board(vec![("Todo", vec![])]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        assert!(result.board.columns[0].cards.is_empty());
    }

    #[test]
    fn test_merge_card_moved_by_theirs() {
        // Theirs moves card to a different column, ours leaves it
        let base = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task A", false)]),
            ("Done", vec![]),
        ]);
        let theirs = make_board(vec![
            ("Todo", vec![]),
            ("Done", vec![make_card("aaa00001", "Task A", false)]),
        ]);
        let ours = make_board(vec![
            ("Todo", vec![make_card("aaa00001", "Task A", false)]),
            ("Done", vec![]),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        // Theirs moved it: base col=Todo, theirs col=Done, ours col=Todo.
        // Since b.column_title (Todo) != t.column_title (Done), target = theirs col = Done.
        let done_cards = &result
            .board
            .columns
            .iter()
            .find(|c| c.title == "Done")
            .unwrap()
            .cards;
        assert_eq!(done_cards.len(), 1);
        assert_eq!(done_cards[0].kid.as_deref(), Some("aaa00001"));
    }

    #[test]
    fn test_merge_many_cards_mixed_operations() {
        // Stress test with 6 cards and various operations
        let base = make_board(vec![
            (
                "Backlog",
                vec![
                    make_card("c001", "Card 1", false),
                    make_card("c002", "Card 2", false),
                    make_card("c003", "Card 3", false),
                ],
            ),
            (
                "Active",
                vec![
                    make_card("c004", "Card 4", false),
                    make_card("c005", "Card 5", false),
                ],
            ),
            ("Done", vec![make_card("c006", "Card 6", true)]),
        ]);

        let theirs = make_board(vec![
            (
                "Backlog",
                vec![
                    make_card("c001", "Card 1 theirs-edit", false), // modified
                    make_card("c002", "Card 2", false),             // unchanged
                    // c003 removed by theirs
                ],
            ),
            (
                "Active",
                vec![
                    make_card("c004", "Card 4", false),
                    make_card("c005", "Card 5", false),
                    make_card("c007", "Card 7 new-theirs", false), // added by theirs
                ],
            ),
            ("Done", vec![make_card("c006", "Card 6", true)]),
        ]);

        let ours = make_board(vec![
            (
                "Backlog",
                vec![
                    make_card("c001", "Card 1", false),     // unchanged
                    make_card("c002", "Card 2", true),       // checked by ours
                    make_card("c003", "Card 3", false),      // kept by ours
                ],
            ),
            (
                "Active",
                vec![
                    make_card("c004", "Card 4", true),       // checked by ours
                    // c005 moved to Done by ours
                ],
            ),
            (
                "Done",
                vec![
                    make_card("c006", "Card 6", true),
                    make_card("c005", "Card 5 done", true),   // moved+modified by ours
                    make_card("c008", "Card 8 new-ours", false), // added by ours
                ],
            ),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);

        let all_cards: Vec<_> = result
            .board
            .columns
            .iter()
            .flat_map(|c| c.cards.iter().map(move |card| (c.title.clone(), card)))
            .collect();

        // c001: theirs changed content, ours unchanged => theirs content wins
        let c001 = all_cards.iter().find(|(_, c)| c.kid.as_deref() == Some("c001")).unwrap();
        assert_eq!(c001.1.content, "Card 1 theirs-edit");

        // c002: ours checked it => should be checked
        let c002 = all_cards.iter().find(|(_, c)| c.kid.as_deref() == Some("c002")).unwrap();
        assert!(c002.1.checked);

        // c003: in base+ours, not in theirs => conservative: keep ours
        let c003 = all_cards.iter().find(|(_, c)| c.kid.as_deref() == Some("c003"));
        assert!(c003.is_some());

        // c004: ours checked it
        let c004 = all_cards.iter().find(|(_, c)| c.kid.as_deref() == Some("c004")).unwrap();
        assert!(c004.1.checked);

        // c005: ours moved to Done and modified content. Theirs left it in Active.
        // base col=Active, theirs col=Active, ours col=Done. theirs didn't move (b==t),
        // so target = ours col = Done.
        let c005 = all_cards.iter().find(|(_, c)| c.kid.as_deref() == Some("c005")).unwrap();
        assert_eq!(c005.0, "Done");

        // c006: unchanged by both => present
        let c006 = all_cards.iter().find(|(_, c)| c.kid.as_deref() == Some("c006"));
        assert!(c006.is_some());

        // c007: only in theirs => included
        let c007 = all_cards.iter().find(|(_, c)| c.kid.as_deref() == Some("c007"));
        assert!(c007.is_some());

        // c008: only in ours => included
        let c008 = all_cards.iter().find(|(_, c)| c.kid.as_deref() == Some("c008"));
        assert!(c008.is_some());

        // Total: c001-c008 present (c003 kept conservatively) = 8 cards
        assert_eq!(all_cards.len(), 8);
    }
}
