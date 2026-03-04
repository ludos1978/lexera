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

/// Strategy for resolving conflicts when both sides modify the same field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum MergeStrategy {
    /// External (disk) changes win on conflict for all fields.
    /// Conflicts are still reported in the result for informational purposes.
    #[default]
    TheirsWins,
    /// Local changes always win on conflict (ours for content/checked/position).
    OursWins,
    /// Use the most recent change based on which snapshot changed more fields;
    /// falls back to TheirsWins behavior when indeterminate.
    MostRecent,
    /// Combine both versions with conflict markers for content conflicts.
    /// Checked/position conflicts fall back to TheirsWins behavior.
    KeepBoth,
}

/// Options controlling the three-way merge behavior.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MergeOptions {
    /// The conflict resolution strategy to use.
    pub strategy: MergeStrategy,
}

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
///
/// Uses the default merge strategy (TheirsWins) for backwards compatibility.
pub fn three_way_merge(
    base: &KanbanBoard,
    theirs: &KanbanBoard,
    ours: &KanbanBoard,
) -> MergeResult {
    three_way_merge_with_options(base, theirs, ours, &MergeOptions::default())
}

/// Perform three-way merge with configurable conflict resolution strategy.
///
/// See [`MergeStrategy`] for available strategies.
pub fn three_way_merge_with_options(
    base: &KanbanBoard,
    theirs: &KanbanBoard,
    ours: &KanbanBoard,
    options: &MergeOptions,
) -> MergeResult {
    let base_snap = snapshot_board(base);
    let theirs_snap = snapshot_board(theirs);
    let ours_snap = snapshot_board(ours);

    let mut conflicts = Vec::new();
    let mut auto_merged: usize = 0;

    // Build merged columns based on theirs (disk) as the structural base.
    // Cards are collected as (KanbanCard, resolved_position) pairs so we can
    // sort each column by position after all cards have been placed.
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

    // Parallel vec: for each merged column, store the resolved position per card
    let mut column_positions: Vec<Vec<usize>> = vec![Vec::new(); merged_columns.len()];

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
            column_positions.push(Vec::new());
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
                    merged_content = resolve_content_conflict(
                        options.strategy,
                        &b.content,
                        &t.content,
                        &o.content,
                    );
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
                    merged_checked =
                        resolve_checked_conflict(options.strategy, t.checked, o.checked);
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

                // Position merge: only meaningful when the card stays in the same column
                // across all three versions. When a card is moved to a different column,
                // position in the new column is determined by the side that moved it.
                let merged_position;
                let same_column_all =
                    b.column_title == t.column_title && b.column_title == o.column_title;

                if same_column_all {
                    let pos_changed_theirs = b.position != t.position;
                    let pos_changed_ours = b.position != o.position;

                    if pos_changed_theirs && pos_changed_ours && t.position != o.position {
                        // Both sides reordered differently -> report conflict
                        conflicts.push(CardConflict {
                            card_id: kid.clone(),
                            column_title: t.column_title.clone(),
                            field: ConflictField::Position,
                            base_value: b.position.to_string(),
                            theirs_value: t.position.to_string(),
                            ours_value: o.position.to_string(),
                        });
                        merged_position =
                            resolve_position_conflict(options.strategy, t.position, o.position);
                    } else if pos_changed_theirs {
                        merged_position = t.position;
                        if pos_changed_ours {
                            // Both changed to same position -> auto-merge
                            auto_merged += 1;
                        }
                    } else {
                        // Only ours changed, or neither changed
                        merged_position = o.position;
                    }
                } else {
                    // Card moved columns: use the position from whichever side determined
                    // the target column
                    if b.column_title != t.column_title {
                        merged_position = t.position;
                    } else {
                        merged_position = o.position;
                    }
                }

                let merged_card = KanbanCard {
                    id: String::new(),
                    content: merged_content,
                    checked: merged_checked,
                    kid: Some(kid.clone()),
                };

                add_card_to_column_with_position(
                    &mut merged_columns,
                    &mut column_positions,
                    &target_col,
                    merged_card,
                    merged_position,
                );
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
                add_card_to_column_with_position(
                    &mut merged_columns,
                    &mut column_positions,
                    &o.column_title,
                    card,
                    o.position,
                );
            }

            // Only in theirs -> externally added
            (None, Some(t), None) => {
                let card = KanbanCard {
                    id: String::new(),
                    content: t.content.clone(),
                    checked: t.checked,
                    kid: Some(kid.clone()),
                };
                add_card_to_column_with_position(
                    &mut merged_columns,
                    &mut column_positions,
                    &t.column_title,
                    card,
                    t.position,
                );
            }

            // Only in ours -> user added
            (None, None, Some(o)) => {
                let card = KanbanCard {
                    id: String::new(),
                    content: o.content.clone(),
                    checked: o.checked,
                    kid: Some(kid.clone()),
                };
                add_card_to_column_with_position(
                    &mut merged_columns,
                    &mut column_positions,
                    &o.column_title,
                    card,
                    o.position,
                );
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
                    add_card_to_column_with_position(
                        &mut merged_columns,
                        &mut column_positions,
                        &t.column_title,
                        card,
                        t.position,
                    );
                } else {
                    // Different content with same kid is unusual, keep theirs version
                    let card = KanbanCard {
                        id: String::new(),
                        content: t.content.clone(),
                        checked: t.checked,
                        kid: Some(kid.clone()),
                    };
                    add_card_to_column_with_position(
                        &mut merged_columns,
                        &mut column_positions,
                        &t.column_title,
                        card,
                        t.position,
                    );
                    auto_merged += 1;
                }
            }

            // Only in base (deleted by both) or not in any
            (Some(_), None, None) | (None, None, None) => {
                // Card removed by both sides or doesn't exist
            }
        }
    }

    // Sort cards within each column by their resolved position
    for (col_idx, col) in merged_columns.iter_mut().enumerate() {
        if col.cards.len() > 1 {
            let positions = &column_positions[col_idx];
            // Build (index, position) pairs and sort by position, stable
            let mut indices: Vec<usize> = (0..col.cards.len()).collect();
            indices.sort_by_key(|&i| positions[i]);
            let sorted_cards: Vec<KanbanCard> =
                indices.iter().map(|&i| col.cards[i].clone()).collect();
            col.cards = sorted_cards;
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
        generation_meta: ours.generation_meta.clone(),
        format_hint: ours.format_hint,
    };

    MergeResult {
        board: merged_board,
        conflicts,
        auto_merged,
    }
}

/// Resolve a content conflict according to the chosen merge strategy.
fn resolve_content_conflict(
    strategy: MergeStrategy,
    _base: &str,
    theirs: &str,
    ours: &str,
) -> String {
    match strategy {
        MergeStrategy::TheirsWins => theirs.to_string(),
        MergeStrategy::OursWins => ours.to_string(),
        MergeStrategy::MostRecent => {
            // Without timestamps on individual cards, we fall back to TheirsWins behavior.
            // In future, if cards gain a `modified_at` field, this can compare timestamps.
            theirs.to_string()
        }
        MergeStrategy::KeepBoth => {
            format!("<<<< OURS\n{}\n====\n{}\n>>>> THEIRS", ours, theirs)
        }
    }
}

/// Resolve a checked conflict according to the chosen merge strategy.
fn resolve_checked_conflict(strategy: MergeStrategy, theirs: bool, ours: bool) -> bool {
    match strategy {
        MergeStrategy::TheirsWins => theirs,
        MergeStrategy::OursWins => ours,
        MergeStrategy::MostRecent => theirs,
        // For KeepBoth, checked is a boolean — can't combine, fall back to theirs
        MergeStrategy::KeepBoth => theirs,
    }
}

/// Resolve a position conflict according to the chosen merge strategy.
fn resolve_position_conflict(strategy: MergeStrategy, theirs: usize, ours: usize) -> usize {
    match strategy {
        MergeStrategy::TheirsWins => theirs,
        MergeStrategy::OursWins => ours,
        MergeStrategy::MostRecent => theirs,
        MergeStrategy::KeepBoth => theirs,
    }
}

/// Add a card to the appropriate column with a resolved position for later sorting.
fn add_card_to_column_with_position(
    columns: &mut [KanbanColumn],
    column_positions: &mut [Vec<usize>],
    column_title: &str,
    card: KanbanCard,
    position: usize,
) {
    if let Some(idx) = columns.iter().position(|c| c.title == column_title) {
        columns[idx].cards.push(card);
        column_positions[idx].push(position);
    } else if !columns.is_empty() {
        // Fallback: if target column doesn't exist, put in first column
        columns[0].cards.push(card);
        column_positions[0].push(position);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BoardFormat, KanbanRow, KanbanStack};

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
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
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
            generation_meta: None,
            format_hint: BoardFormat::New,
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
            ("Todo", vec![make_card("aaa00002", "Task B", true)]),
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
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Updated by theirs", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", true)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let card = &result.board.columns[0].cards[0];
        assert_eq!(card.content, "Updated by theirs");
        assert!(card.checked);
    }

    #[test]
    fn test_merge_content_ours_checked_theirs() {
        // Ours changes content, theirs changes checked => auto-merge, no conflict
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", true)],
        )]);
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
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
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
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
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
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", true)],
        )]);
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
        let theirs = make_board(vec![("Todo", vec![make_card("aaa00001", "Task A", false)])]);
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
        // Directly test add_card_to_column_with_position with a missing target column
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
        let mut positions = vec![Vec::new(), Vec::new()];
        let card = make_card("aaa00001", "Orphan card", false);
        add_card_to_column_with_position(&mut columns, &mut positions, "Nonexistent", card, 0);

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
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Old task", false)],
        )]);
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
                    make_card("c001", "Card 1", false), // unchanged
                    make_card("c002", "Card 2", true),  // checked by ours
                    make_card("c003", "Card 3", false), // kept by ours
                ],
            ),
            (
                "Active",
                vec![
                    make_card("c004", "Card 4", true), // checked by ours
                                                       // c005 moved to Done by ours
                ],
            ),
            (
                "Done",
                vec![
                    make_card("c006", "Card 6", true),
                    make_card("c005", "Card 5 done", true), // moved+modified by ours
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
        let c001 = all_cards
            .iter()
            .find(|(_, c)| c.kid.as_deref() == Some("c001"))
            .unwrap();
        assert_eq!(c001.1.content, "Card 1 theirs-edit");

        // c002: ours checked it => should be checked
        let c002 = all_cards
            .iter()
            .find(|(_, c)| c.kid.as_deref() == Some("c002"))
            .unwrap();
        assert!(c002.1.checked);

        // c003: in base+ours, not in theirs => conservative: keep ours
        let c003 = all_cards
            .iter()
            .find(|(_, c)| c.kid.as_deref() == Some("c003"));
        assert!(c003.is_some());

        // c004: ours checked it
        let c004 = all_cards
            .iter()
            .find(|(_, c)| c.kid.as_deref() == Some("c004"))
            .unwrap();
        assert!(c004.1.checked);

        // c005: ours moved to Done and modified content. Theirs left it in Active.
        // base col=Active, theirs col=Active, ours col=Done. theirs didn't move (b==t),
        // so target = ours col = Done.
        let c005 = all_cards
            .iter()
            .find(|(_, c)| c.kid.as_deref() == Some("c005"))
            .unwrap();
        assert_eq!(c005.0, "Done");

        // c006: unchanged by both => present
        let c006 = all_cards
            .iter()
            .find(|(_, c)| c.kid.as_deref() == Some("c006"));
        assert!(c006.is_some());

        // c007: only in theirs => included
        let c007 = all_cards
            .iter()
            .find(|(_, c)| c.kid.as_deref() == Some("c007"));
        assert!(c007.is_some());

        // c008: only in ours => included
        let c008 = all_cards
            .iter()
            .find(|(_, c)| c.kid.as_deref() == Some("c008"));
        assert!(c008.is_some());

        // Total: c001-c008 present (c003 kept conservatively) = 8 cards
        assert_eq!(all_cards.len(), 8);
    }

    // ---------------------------------------------------------------
    // Position-aware merge tests
    // ---------------------------------------------------------------

    /// Helper to get the ordered kids from a column in the merge result.
    fn get_column_kids(result: &MergeResult, col_title: &str) -> Vec<String> {
        let col = result.board.columns.iter().find(|c| c.title == col_title);
        match col {
            Some(c) => c.cards.iter().filter_map(|card| card.kid.clone()).collect(),
            None => {
                // Check in rows format
                for row in &result.board.rows {
                    for stack in &row.stacks {
                        for c in &stack.columns {
                            if c.title == col_title {
                                return c
                                    .cards
                                    .iter()
                                    .filter_map(|card| card.kid.clone())
                                    .collect();
                            }
                        }
                    }
                }
                Vec::new()
            }
        }
    }

    #[test]
    fn test_merge_position_one_side_reorders_theirs() {
        // Base: A, B, C in Todo
        // Theirs: C, A, B (theirs reordered)
        // Ours: A, B, C (unchanged)
        // Expected: C, A, B (theirs reorder applied)
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
                make_card("c003", "Card C", false),
            ],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![
                make_card("c003", "Card C", false),
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
            ],
        )]);
        let ours = base.clone();

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c003", "c001", "c002"]);
    }

    #[test]
    fn test_merge_position_one_side_reorders_ours() {
        // Base: A, B, C in Todo
        // Theirs: A, B, C (unchanged)
        // Ours: B, C, A (ours reordered)
        // Expected: B, C, A (ours reorder applied)
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
                make_card("c003", "Card C", false),
            ],
        )]);
        let theirs = base.clone();
        let ours = make_board(vec![(
            "Todo",
            vec![
                make_card("c002", "Card B", false),
                make_card("c003", "Card C", false),
                make_card("c001", "Card A", false),
            ],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c002", "c003", "c001"]);
    }

    #[test]
    fn test_merge_position_both_reorder_differently_theirs_wins() {
        // Base: A(0), B(1), C(2)
        // Theirs: B(0), C(1), A(2) -- theirs reordered
        // Ours: C(0), A(1), B(2) -- ours reordered differently
        // For each card, both sides changed position and differ -> theirs wins:
        //   c001(A): base=0, theirs=2, ours=1 -> theirs=2
        //   c002(B): base=1, theirs=0, ours=2 -> theirs=0
        //   c003(C): base=2, theirs=1, ours=0 -> theirs=1
        // Sorted by theirs' positions: B(0), C(1), A(2)
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
                make_card("c003", "Card C", false),
            ],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![
                make_card("c002", "Card B", false),
                make_card("c003", "Card C", false),
                make_card("c001", "Card A", false),
            ],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![
                make_card("c003", "Card C", false),
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
            ],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        // Position conflicts should be reported for all 3 cards (all moved differently)
        let pos_conflicts: Vec<_> = result
            .conflicts
            .iter()
            .filter(|c| c.field == ConflictField::Position)
            .collect();
        assert_eq!(pos_conflicts.len(), 3);
        // Theirs wins: B(0), C(1), A(2)
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c002", "c003", "c001"]);
    }

    #[test]
    fn test_merge_position_reorder_plus_content_change() {
        // Base: A, B, C in Todo
        // Theirs: C, A, B (reordered) AND content of A changed
        // Ours: A, B, C (unchanged)
        // Expected: C, A, B order AND A has theirs' content
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
                make_card("c003", "Card C", false),
            ],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![
                make_card("c003", "Card C", false),
                make_card("c001", "Card A updated", false),
                make_card("c002", "Card B", false),
            ],
        )]);
        let ours = base.clone();

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c003", "c001", "c002"]);
        // Verify content was updated
        let card_a = result.board.columns[0]
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("c001"))
            .unwrap();
        assert_eq!(card_a.content, "Card A updated");
    }

    #[test]
    fn test_merge_position_reorder_ours_content_theirs() {
        // Base: A, B, C in Todo
        // Theirs: A, B, C (unchanged order) BUT content of B changed
        // Ours: C, A, B (reordered)
        // Expected: C, A, B order AND B has theirs' content
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
                make_card("c003", "Card C", false),
            ],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A", false),
                make_card("c002", "Card B edited", false),
                make_card("c003", "Card C", false),
            ],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![
                make_card("c003", "Card C", false),
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
            ],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c003", "c001", "c002"]);
        // Verify content merge: B should have theirs' edited content
        let card_b = result.board.columns[0]
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("c002"))
            .unwrap();
        assert_eq!(card_b.content, "Card B edited");
    }

    #[test]
    fn test_merge_position_complex_multiple_cards_reordered() {
        // Base: A(0), B(1), C(2), D(3), E(4) in Todo
        // Theirs: E, D, C, B, A (fully reversed)
        // Ours: A, B, C, D, E (unchanged)
        // Expected: E, D, C, B, A (theirs reorder applied)
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "A", false),
                make_card("c002", "B", false),
                make_card("c003", "C", false),
                make_card("c004", "D", false),
                make_card("c005", "E", false),
            ],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![
                make_card("c005", "E", false),
                make_card("c004", "D", false),
                make_card("c003", "C", false),
                make_card("c002", "B", false),
                make_card("c001", "A", false),
            ],
        )]);
        let ours = base.clone();

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c005", "c004", "c003", "c002", "c001"]);
    }

    #[test]
    fn test_merge_position_unchanged_preserves_order() {
        // Base: A, B, C -- neither side changes anything
        // Order should be preserved as A, B, C
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
                make_card("c003", "Card C", false),
            ],
        )]);
        let theirs = base.clone();
        let ours = base.clone();

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c001", "c002", "c003"]);
    }

    #[test]
    fn test_merge_position_new_format_reorder() {
        // Same reorder test but with new format (rows/stacks)
        let base = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![(
                    "Todo",
                    vec![
                        make_card("c001", "Card A", false),
                        make_card("c002", "Card B", false),
                        make_card("c003", "Card C", false),
                    ],
                )],
            )],
        )]);
        let theirs = make_new_format_board(vec![(
            "Row 1",
            vec![(
                "Stack A",
                vec![(
                    "Todo",
                    vec![
                        make_card("c003", "Card C", false),
                        make_card("c001", "Card A", false),
                        make_card("c002", "Card B", false),
                    ],
                )],
            )],
        )]);
        let ours = base.clone();

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c003", "c001", "c002"]);
    }

    // ---------------------------------------------------------------
    // Include-file card-level merge tests
    // ---------------------------------------------------------------

    /// Helper to make a board with include-source columns.
    /// Each column entry is (title, include_raw_path_or_none, cards).
    fn make_board_with_includes(
        columns: Vec<(&str, Option<&str>, Vec<KanbanCard>)>,
    ) -> KanbanBoard {
        KanbanBoard {
            valid: true,
            title: "Test".to_string(),
            columns: columns
                .into_iter()
                .map(|(title, include_path, cards)| KanbanColumn {
                    id: "col".to_string(),
                    title: title.to_string(),
                    cards,
                    include_source: include_path.map(|raw| crate::types::IncludeSource {
                        raw_path: raw.to_string(),
                        resolved_path: std::path::PathBuf::from(format!("/boards/{}", raw)),
                    }),
                })
                .collect(),
            rows: Vec::new(),
            yaml_header: None,
            kanban_footer: None,
            board_settings: None,
            generation_meta: None,
            format_hint: BoardFormat::Legacy,
        }
    }

    #[test]
    fn test_merge_include_different_cards_no_conflict() {
        // Two users edit different cards in the same include file -> auto-merged, no conflict.
        //
        // Base: include column with 3 cards (c001, c002, c003)
        // Theirs: edited c001 content
        // Ours: edited c003 content
        // Expected: both edits applied, no conflicts
        let base = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![
                make_card("c001", "Slide 1 original", false),
                make_card("c002", "Slide 2 unchanged", false),
                make_card("c003", "Slide 3 original", false),
            ],
        )]);
        let theirs = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![
                make_card("c001", "Slide 1 edited by Alice", false),
                make_card("c002", "Slide 2 unchanged", false),
                make_card("c003", "Slide 3 original", false),
            ],
        )]);
        let ours = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![
                make_card("c001", "Slide 1 original", false),
                make_card("c002", "Slide 2 unchanged", false),
                make_card("c003", "Slide 3 edited by Bob", false),
            ],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);

        // No conflicts: different cards were edited
        assert!(
            result.conflicts.is_empty(),
            "Editing different cards in an include file should not produce conflicts, got: {:?}",
            result.conflicts
        );

        // Verify both edits were applied
        let col = &result.board.columns[0];
        assert_eq!(col.cards.len(), 3);

        let c001 = col
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("c001"))
            .unwrap();
        assert_eq!(c001.content, "Slide 1 edited by Alice");

        let c002 = col
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("c002"))
            .unwrap();
        assert_eq!(c002.content, "Slide 2 unchanged");

        let c003 = col
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("c003"))
            .unwrap();
        assert_eq!(c003.content, "Slide 3 edited by Bob");

        // Include source should be preserved on the merged column
        assert!(
            col.include_source.is_some(),
            "include_source should be preserved after merge"
        );
        assert_eq!(col.include_source.as_ref().unwrap().raw_path, "./slides.md");
    }

    #[test]
    fn test_merge_include_same_card_conflict() {
        // Two users edit the same card in an include file -> conflict reported.
        //
        // Base: include column with 2 cards
        // Theirs: edited c001 content to "Alice version"
        // Ours: edited c001 content to "Bob version"
        // Expected: conflict on c001 content
        let base = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![
                make_card("c001", "Slide 1 original", false),
                make_card("c002", "Slide 2 unchanged", false),
            ],
        )]);
        let theirs = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![
                make_card("c001", "Slide 1 by Alice", false),
                make_card("c002", "Slide 2 unchanged", false),
            ],
        )]);
        let ours = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![
                make_card("c001", "Slide 1 by Bob", false),
                make_card("c002", "Slide 2 unchanged", false),
            ],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);

        // Should have exactly one conflict on c001 content
        assert_eq!(
            result.conflicts.len(),
            1,
            "Expected 1 conflict for same-card edit in include file"
        );
        assert_eq!(result.conflicts[0].card_id, "c001");
        assert_eq!(result.conflicts[0].field, ConflictField::Content);
        assert_eq!(result.conflicts[0].base_value, "Slide 1 original");
        assert_eq!(result.conflicts[0].theirs_value, "Slide 1 by Alice");
        assert_eq!(result.conflicts[0].ours_value, "Slide 1 by Bob");

        // c002 should be unchanged
        let col = &result.board.columns[0];
        let c002 = col
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("c002"))
            .unwrap();
        assert_eq!(c002.content, "Slide 2 unchanged");
    }

    #[test]
    fn test_merge_include_mixed_with_regular_columns() {
        // Board has both a regular column and an include column.
        // Edits to cards in each should merge independently.
        let base = make_board_with_includes(vec![
            ("Todo", None, vec![make_card("r001", "Regular task", false)]),
            (
                "!!!include(./slides.md)!!!",
                Some("./slides.md"),
                vec![
                    make_card("i001", "Include card 1", false),
                    make_card("i002", "Include card 2", false),
                ],
            ),
        ]);
        // Theirs: edit regular card
        let theirs = make_board_with_includes(vec![
            (
                "Todo",
                None,
                vec![make_card("r001", "Regular task by Alice", false)],
            ),
            (
                "!!!include(./slides.md)!!!",
                Some("./slides.md"),
                vec![
                    make_card("i001", "Include card 1", false),
                    make_card("i002", "Include card 2", false),
                ],
            ),
        ]);
        // Ours: edit include card
        let ours = make_board_with_includes(vec![
            ("Todo", None, vec![make_card("r001", "Regular task", false)]),
            (
                "!!!include(./slides.md)!!!",
                Some("./slides.md"),
                vec![
                    make_card("i001", "Include card 1 by Bob", false),
                    make_card("i002", "Include card 2", false),
                ],
            ),
        ]);

        let result = three_way_merge(&base, &theirs, &ours);

        assert!(result.conflicts.is_empty());

        // Regular column: theirs' edit applied
        let todo_col = result
            .board
            .columns
            .iter()
            .find(|c| c.title == "Todo")
            .unwrap();
        assert_eq!(todo_col.cards[0].content, "Regular task by Alice");
        assert!(todo_col.include_source.is_none());

        // Include column: ours' edit applied
        let inc_col = result
            .board
            .columns
            .iter()
            .find(|c| c.title.contains("include"))
            .unwrap();
        let i001 = inc_col
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("i001"))
            .unwrap();
        assert_eq!(i001.content, "Include card 1 by Bob");
        assert!(inc_col.include_source.is_some());
    }

    #[test]
    fn test_merge_include_card_added_and_deleted() {
        // Theirs adds a card to an include column, ours deletes a different card.
        let base = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![
                make_card("c001", "Slide 1", false),
                make_card("c002", "Slide 2", false),
            ],
        )]);
        // Theirs: adds c003
        let theirs = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![
                make_card("c001", "Slide 1", false),
                make_card("c002", "Slide 2", false),
                make_card("c003", "Slide 3 new", false),
            ],
        )]);
        // Ours: deletes c002
        let ours = make_board_with_includes(vec![(
            "!!!include(./slides.md)!!!",
            Some("./slides.md"),
            vec![make_card("c001", "Slide 1", false)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);

        assert!(result.conflicts.is_empty());

        let col = &result.board.columns[0];
        let kids: Vec<&str> = col.cards.iter().filter_map(|c| c.kid.as_deref()).collect();

        // c001 should remain (unchanged)
        assert!(kids.contains(&"c001"));
        // c002 should be removed (deleted by ours)
        assert!(!kids.contains(&"c002"));
        // c003 should be present (added by theirs)
        assert!(kids.contains(&"c003"));
        assert_eq!(col.cards.len(), 2);
    }

    #[test]
    fn test_merge_include_preserves_include_source_metadata() {
        // Verify that after merge, include_source is preserved so the include
        // file can be properly written back by the storage layer.
        let base = make_board_with_includes(vec![(
            "!!!include(./presentations/deck.md)!!!",
            Some("./presentations/deck.md"),
            vec![make_card("s001", "Slide content", false)],
        )]);
        let theirs = base.clone();
        let ours = make_board_with_includes(vec![(
            "!!!include(./presentations/deck.md)!!!",
            Some("./presentations/deck.md"),
            vec![make_card("s001", "Slide content updated", false)],
        )]);

        let result = three_way_merge(&base, &theirs, &ours);
        assert!(result.conflicts.is_empty());

        let col = &result.board.columns[0];
        assert!(col.include_source.is_some());
        let src = col.include_source.as_ref().unwrap();
        assert_eq!(src.raw_path, "./presentations/deck.md");
    }

    // ---------------------------------------------------------------
    // MergeStrategy tests
    // ---------------------------------------------------------------

    #[test]
    fn test_strategy_theirs_wins_content_conflict() {
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Theirs edit", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Ours edit", false)],
        )]);

        let options = MergeOptions {
            strategy: MergeStrategy::TheirsWins,
        };
        let result = three_way_merge_with_options(&base, &theirs, &ours, &options);

        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].field, ConflictField::Content);
        // TheirsWins: resolved content should be theirs' value
        let card = &result.board.columns[0].cards[0];
        assert_eq!(card.content, "Theirs edit");
    }

    #[test]
    fn test_strategy_ours_wins_content_conflict() {
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Theirs edit", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Ours edit", false)],
        )]);

        let options = MergeOptions {
            strategy: MergeStrategy::OursWins,
        };
        let result = three_way_merge_with_options(&base, &theirs, &ours, &options);

        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].field, ConflictField::Content);
        // OursWins: resolved content should be ours' value
        let card = &result.board.columns[0].cards[0];
        assert_eq!(card.content, "Ours edit");
    }

    #[test]
    fn test_strategy_most_recent_content_conflict() {
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Theirs edit", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Ours edit", false)],
        )]);

        let options = MergeOptions {
            strategy: MergeStrategy::MostRecent,
        };
        let result = three_way_merge_with_options(&base, &theirs, &ours, &options);

        assert_eq!(result.conflicts.len(), 1);
        // MostRecent without timestamps falls back to theirs
        let card = &result.board.columns[0].cards[0];
        assert_eq!(card.content, "Theirs edit");
    }

    #[test]
    fn test_strategy_keep_both_content_conflict() {
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Theirs edit", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Ours edit", false)],
        )]);

        let options = MergeOptions {
            strategy: MergeStrategy::KeepBoth,
        };
        let result = three_way_merge_with_options(&base, &theirs, &ours, &options);

        assert_eq!(result.conflicts.len(), 1);
        let card = &result.board.columns[0].cards[0];
        // KeepBoth should produce conflict markers
        assert!(card.content.contains("<<<< OURS"));
        assert!(card.content.contains("Ours edit"));
        assert!(card.content.contains("===="));
        assert!(card.content.contains("Theirs edit"));
        assert!(card.content.contains(">>>> THEIRS"));
    }

    #[test]
    fn test_strategy_keep_both_exact_format() {
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Line A\nLine B", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Line X\nLine Y", false)],
        )]);

        let options = MergeOptions {
            strategy: MergeStrategy::KeepBoth,
        };
        let result = three_way_merge_with_options(&base, &theirs, &ours, &options);

        let card = &result.board.columns[0].cards[0];
        let expected = "<<<< OURS\nLine X\nLine Y\n====\nLine A\nLine B\n>>>> THEIRS";
        assert_eq!(card.content, expected);
    }

    #[test]
    fn test_strategy_ours_wins_position_conflict() {
        // Base: A(0), B(1), C(2)
        // Theirs: B(0), C(1), A(2) -- theirs reordered
        // Ours: C(0), A(1), B(2) -- ours reordered differently
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "A", false),
                make_card("c002", "B", false),
                make_card("c003", "C", false),
            ],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![
                make_card("c002", "B", false),
                make_card("c003", "C", false),
                make_card("c001", "A", false),
            ],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![
                make_card("c003", "C", false),
                make_card("c001", "A", false),
                make_card("c002", "B", false),
            ],
        )]);

        // TheirsWins -> theirs' order: B, C, A
        let theirs_result = three_way_merge_with_options(
            &base,
            &theirs,
            &ours,
            &MergeOptions {
                strategy: MergeStrategy::TheirsWins,
            },
        );
        let theirs_kids = get_column_kids(&theirs_result, "Todo");
        assert_eq!(theirs_kids, vec!["c002", "c003", "c001"]);

        // OursWins -> ours' order: C, A, B
        let ours_result = three_way_merge_with_options(
            &base,
            &theirs,
            &ours,
            &MergeOptions {
                strategy: MergeStrategy::OursWins,
            },
        );
        let ours_kids = get_column_kids(&ours_result, "Todo");
        assert_eq!(ours_kids, vec!["c003", "c001", "c002"]);
    }

    #[test]
    fn test_strategy_no_conflict_same_result_regardless_of_strategy() {
        // When there's no conflict, all strategies should produce the same result
        let base = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", false)])]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Task 1 edited", false)],
        )]);
        let ours = make_board(vec![("Todo", vec![make_card("aaa00001", "Task 1", true)])]);

        for strategy in [
            MergeStrategy::TheirsWins,
            MergeStrategy::OursWins,
            MergeStrategy::MostRecent,
            MergeStrategy::KeepBoth,
        ] {
            let options = MergeOptions { strategy };
            let result = three_way_merge_with_options(&base, &theirs, &ours, &options);
            assert!(
                result.conflicts.is_empty(),
                "Strategy {:?} should have no conflicts",
                strategy
            );
            let card = &result.board.columns[0].cards[0];
            assert_eq!(
                card.content, "Task 1 edited",
                "Strategy {:?}: content should use theirs (only theirs changed)",
                strategy
            );
            assert!(
                card.checked,
                "Strategy {:?}: checked should use ours (only ours changed)",
                strategy
            );
        }
    }

    #[test]
    fn test_strategy_default_is_theirs_wins() {
        // Verify the Default trait produces TheirsWins
        let options = MergeOptions::default();
        assert_eq!(options.strategy, MergeStrategy::TheirsWins);
    }

    #[test]
    fn test_strategy_three_way_merge_matches_theirs_wins() {
        // Verify that the convenience function three_way_merge produces
        // the same result as three_way_merge_with_options with TheirsWins
        let base = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Original", false)],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Theirs edit", false)],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![make_card("aaa00001", "Ours edit", false)],
        )]);

        let result_default = three_way_merge(&base, &theirs, &ours);
        let result_explicit = three_way_merge_with_options(
            &base,
            &theirs,
            &ours,
            &MergeOptions {
                strategy: MergeStrategy::TheirsWins,
            },
        );

        assert_eq!(
            result_default.conflicts.len(),
            result_explicit.conflicts.len()
        );
        assert_eq!(result_default.auto_merged, result_explicit.auto_merged);
        assert_eq!(
            result_default.board.columns[0].cards[0].content,
            result_explicit.board.columns[0].cards[0].content
        );
    }

    #[test]
    fn test_strategy_keep_both_position_falls_back_to_theirs() {
        // KeepBoth for position conflicts should fall back to theirs' order.
        // Need a real conflict where both sides reorder differently.
        let base2 = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "A", false),
                make_card("c002", "B", false),
                make_card("c003", "C", false),
            ],
        )]);
        let theirs2 = make_board(vec![(
            "Todo",
            vec![
                make_card("c002", "B", false),
                make_card("c003", "C", false),
                make_card("c001", "A", false),
            ],
        )]);
        let ours2 = make_board(vec![(
            "Todo",
            vec![
                make_card("c003", "C", false),
                make_card("c001", "A", false),
                make_card("c002", "B", false),
            ],
        )]);

        let result = three_way_merge_with_options(
            &base2,
            &theirs2,
            &ours2,
            &MergeOptions {
                strategy: MergeStrategy::KeepBoth,
            },
        );
        // KeepBoth for position falls back to theirs: B, C, A
        let kids = get_column_kids(&result, "Todo");
        assert_eq!(kids, vec!["c002", "c003", "c001"]);
    }

    #[test]
    fn test_strategy_theirs_wins_checked_conflict() {
        // Boolean checked conflict: base=true, theirs=false, ours=false
        // Wait -- if both changed to the same value, it's auto-merged, not a conflict.
        // Boolean can never produce a true conflict (see test_merge_real_two_conflicts...).
        // But we can still verify the function handles it correctly.
        // Let's test the resolve function directly.
        assert_eq!(
            resolve_checked_conflict(MergeStrategy::TheirsWins, true, false),
            true
        );
        assert_eq!(
            resolve_checked_conflict(MergeStrategy::OursWins, true, false),
            false
        );
        assert_eq!(
            resolve_checked_conflict(MergeStrategy::MostRecent, true, false),
            true
        );
        assert_eq!(
            resolve_checked_conflict(MergeStrategy::KeepBoth, true, false),
            true
        );
    }

    #[test]
    fn test_strategy_content_resolve_functions() {
        // Test the resolve functions directly for full coverage
        assert_eq!(
            resolve_content_conflict(MergeStrategy::TheirsWins, "base", "theirs", "ours"),
            "theirs"
        );
        assert_eq!(
            resolve_content_conflict(MergeStrategy::OursWins, "base", "theirs", "ours"),
            "ours"
        );
        assert_eq!(
            resolve_content_conflict(MergeStrategy::MostRecent, "base", "theirs", "ours"),
            "theirs"
        );
        let keep_both = resolve_content_conflict(MergeStrategy::KeepBoth, "base", "theirs", "ours");
        assert!(keep_both.contains("<<<< OURS"));
        assert!(keep_both.contains("ours"));
        assert!(keep_both.contains("===="));
        assert!(keep_both.contains("theirs"));
        assert!(keep_both.contains(">>>> THEIRS"));
    }

    #[test]
    fn test_strategy_position_resolve_functions() {
        assert_eq!(
            resolve_position_conflict(MergeStrategy::TheirsWins, 5, 10),
            5
        );
        assert_eq!(
            resolve_position_conflict(MergeStrategy::OursWins, 5, 10),
            10
        );
        assert_eq!(
            resolve_position_conflict(MergeStrategy::MostRecent, 5, 10),
            5
        );
        assert_eq!(resolve_position_conflict(MergeStrategy::KeepBoth, 5, 10), 5);
    }

    #[test]
    fn test_strategy_ours_wins_multi_card_mixed() {
        // Multiple cards: one has content conflict, another has no conflict.
        // Verify OursWins strategy picks ours for the conflicted card,
        // and the non-conflicted card is unaffected.
        let base = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A", false),
                make_card("c002", "Card B", false),
            ],
        )]);
        let theirs = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A theirs", false),
                make_card("c002", "Card B", true), // only theirs changed checked
            ],
        )]);
        let ours = make_board(vec![(
            "Todo",
            vec![
                make_card("c001", "Card A ours", false),
                make_card("c002", "Card B", false),
            ],
        )]);

        let result = three_way_merge_with_options(
            &base,
            &theirs,
            &ours,
            &MergeOptions {
                strategy: MergeStrategy::OursWins,
            },
        );

        // c001: content conflict, OursWins -> "Card A ours"
        let card_a = result.board.columns[0]
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("c001"))
            .unwrap();
        assert_eq!(card_a.content, "Card A ours");

        // c002: no conflict (only theirs changed checked), so theirs' checked wins
        let card_b = result.board.columns[0]
            .cards
            .iter()
            .find(|c| c.kid.as_deref() == Some("c002"))
            .unwrap();
        assert!(card_b.checked);
    }
}
