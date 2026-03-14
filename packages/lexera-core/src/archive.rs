/// Archive operations for kanban boards.
///
/// Identifies completed/checked cards and moves them to a designated
/// archive column. Supports archiving by completion status (checkbox or
/// tags) and by temporal date threshold.
use std::collections::HashMap;

use chrono::{Local, NaiveDate};

use crate::parser::generate_id;
use crate::search::{extract_temporal_tags, parse_temporal_to_date};
use crate::types::{KanbanBoard, KanbanCard, KanbanColumn, KanbanStack};

/// Result of an archive operation.
#[derive(Debug, Clone)]
pub struct ArchiveResult {
    /// Number of cards moved to the archive column.
    pub moved_count: usize,
    /// Title of the archive column used.
    pub archive_column: String,
    /// Non-fatal errors encountered during the operation.
    pub errors: Vec<String>,
}

/// Information about a completed card found during scanning.
#[derive(Debug, Clone)]
pub struct CompletedCardInfo {
    /// Index of the card within its column.
    pub card_index: usize,
    /// Flattened column index (across all rows/stacks).
    pub column_index: usize,
    /// Row index within board.rows.
    pub row_index: usize,
    /// Stack index within the row.
    pub stack_index: usize,
    /// First line of the card content (for display).
    pub card_title: String,
}

/// Check whether a card is considered "completed" / "done".
///
/// A card is completed if:
/// - Its `checked` field is true (parsed from `[x]` checkbox), OR
/// - Its content contains `#done` or `#archived` as a tag.
pub fn is_completed_card(card: &KanbanCard) -> bool {
    if card.checked {
        return true;
    }
    has_done_or_archived_tag(&card.content)
}

/// Scan all columns in the board and return info about completed cards.
pub fn find_completed_cards(board: &KanbanBoard) -> Vec<CompletedCardInfo> {
    let mut results = Vec::new();
    let mut flat_col_index = 0;

    if !board.rows.is_empty() {
        for (row_idx, row) in board.rows.iter().enumerate() {
            for (stack_idx, stack) in row.stacks.iter().enumerate() {
                for (_, col) in stack.columns.iter().enumerate() {
                    for (card_idx, card) in col.cards.iter().enumerate() {
                        if is_completed_card(card) {
                            let title = card.content.lines().next().unwrap_or("").to_string();
                            results.push(CompletedCardInfo {
                                card_index: card_idx,
                                column_index: flat_col_index,
                                row_index: row_idx,
                                stack_index: stack_idx,
                                card_title: title,
                            });
                        }
                    }
                    flat_col_index += 1;
                }
            }
        }
    } else {
        // Legacy board.columns path (programmatic boards without rows)
        for (col_idx, col) in board.columns.iter().enumerate() {
            for (card_idx, card) in col.cards.iter().enumerate() {
                if is_completed_card(card) {
                    let title = card.content.lines().next().unwrap_or("").to_string();
                    results.push(CompletedCardInfo {
                        card_index: card_idx,
                        column_index: col_idx,
                        row_index: 0,
                        stack_index: 0,
                        card_title: title,
                    });
                }
            }
        }
    }

    results
}

/// Move all completed cards to an archive column.
///
/// If the archive column does not exist it is created and appended to the
/// first row's first stack (or to `board.columns` for legacy boards).
///
/// Cards are removed from their source columns and appended to the archive
/// column. Removal iterates in reverse order to avoid index shifting.
pub fn archive_completed_cards(
    board: &mut KanbanBoard,
    archive_column_title: &str,
) -> ArchiveResult {
    let mut collected: Vec<KanbanCard> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    if !board.rows.is_empty() {
        collect_completed_from_rows(&mut board.rows, archive_column_title, &mut collected);
    } else {
        collect_completed_from_columns(&mut board.columns, archive_column_title, &mut collected);
    }

    // Ensure archive column exists and push collected cards into it.
    let moved_count = collected.len();
    if moved_count > 0 {
        let archive_col = ensure_archive_column(board, archive_column_title, &mut errors);
        archive_col.cards.extend(collected);
    }

    ArchiveResult {
        moved_count,
        archive_column: archive_column_title.to_string(),
        errors,
    }
}

/// Archive cards whose temporal date (`@date`) is before `before_date`.
///
/// The `before_date` string is parsed using the same temporal tag parser
/// used by the search module. Cards with at least one temporal tag that
/// resolves to a date strictly before the threshold are moved.
pub fn archive_cards_by_date(
    board: &mut KanbanBoard,
    before_date: &str,
    archive_column_title: &str,
) -> ArchiveResult {
    let today = Local::now().date_naive();
    let threshold = match parse_temporal_to_date(before_date, today) {
        Some(d) => d,
        None => {
            return ArchiveResult {
                moved_count: 0,
                archive_column: archive_column_title.to_string(),
                errors: vec![format!("Could not parse date threshold: '{}'", before_date)],
            };
        }
    };

    let mut collected: Vec<KanbanCard> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    if !board.rows.is_empty() {
        collect_by_date_from_rows(
            &mut board.rows,
            archive_column_title,
            threshold,
            today,
            &mut collected,
        );
    } else {
        collect_by_date_from_columns(
            &mut board.columns,
            archive_column_title,
            threshold,
            today,
            &mut collected,
        );
    }

    let moved_count = collected.len();
    if moved_count > 0 {
        let archive_col = ensure_archive_column(board, archive_column_title, &mut errors);
        archive_col.cards.extend(collected);
    }

    ArchiveResult {
        moved_count,
        archive_column: archive_column_title.to_string(),
        errors,
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Check whether card content contains `#done` or `#archived` as a tag.
fn has_done_or_archived_tag(content: &str) -> bool {
    // We look for whole-word tags: #done or #archived, bounded by whitespace
    // or start/end of string. The tag could also have trailing punctuation
    // that the regex in search would strip, but for robustness we do a simple
    // word-boundary check ourselves.
    for word in content.split_whitespace() {
        let tag = word.trim_end_matches(|c: char| ",.;:!?)".contains(c));
        let lower = tag.to_ascii_lowercase();
        if lower == "#done" || lower == "#archived" {
            return true;
        }
    }
    false
}

/// Check whether a card has a temporal tag whose date is before `threshold`.
fn card_has_date_before(card: &KanbanCard, threshold: NaiveDate, today: NaiveDate) -> bool {
    let tags = extract_temporal_tags(&card.content);
    for tag in &tags {
        if let Some(date) = parse_temporal_to_date(tag, today) {
            if date < threshold {
                return true;
            }
        }
    }
    false
}

/// Collect completed cards from rows, removing them from source columns.
/// Skips the archive column itself to avoid re-archiving already archived cards.
fn collect_completed_from_rows(
    rows: &mut [crate::types::KanbanRow],
    archive_title: &str,
    out: &mut Vec<KanbanCard>,
) {
    for row in rows.iter_mut() {
        for stack in row.stacks.iter_mut() {
            collect_completed_from_columns(&mut stack.columns, archive_title, out);
        }
    }
}

/// Collect completed cards from a slice of columns (shared between rows and
/// legacy paths). Iterates cards in reverse to avoid index-shift issues,
/// then reverses the per-column batch to preserve original order.
fn collect_completed_from_columns(
    columns: &mut [KanbanColumn],
    archive_title: &str,
    out: &mut Vec<KanbanCard>,
) {
    for col in columns.iter_mut() {
        if col.title == archive_title {
            continue; // don't re-archive cards already in the archive column
        }
        let start = out.len();
        let mut i = col.cards.len();
        while i > 0 {
            i -= 1;
            if is_completed_card(&col.cards[i]) {
                let card = col.cards.remove(i);
                out.push(card);
            }
        }
        // Reverse only the batch from this column to restore original order.
        out[start..].reverse();
    }
}

/// Collect cards with temporal dates before threshold from rows.
fn collect_by_date_from_rows(
    rows: &mut [crate::types::KanbanRow],
    archive_title: &str,
    threshold: NaiveDate,
    today: NaiveDate,
    out: &mut Vec<KanbanCard>,
) {
    for row in rows.iter_mut() {
        for stack in row.stacks.iter_mut() {
            collect_by_date_from_columns(&mut stack.columns, archive_title, threshold, today, out);
        }
    }
}

/// Collect cards by date from a slice of columns.
fn collect_by_date_from_columns(
    columns: &mut [KanbanColumn],
    archive_title: &str,
    threshold: NaiveDate,
    today: NaiveDate,
    out: &mut Vec<KanbanCard>,
) {
    for col in columns.iter_mut() {
        if col.title == archive_title {
            continue;
        }
        let start = out.len();
        let mut i = col.cards.len();
        while i > 0 {
            i -= 1;
            if card_has_date_before(&col.cards[i], threshold, today) {
                let card = col.cards.remove(i);
                out.push(card);
            }
        }
        out[start..].reverse();
    }
}

/// Find or create the archive column. Always in the first row's first stack
/// for hierarchical boards, or appended to `board.columns` for legacy boards.
fn ensure_archive_column<'a>(
    board: &'a mut KanbanBoard,
    title: &str,
    errors: &mut Vec<String>,
) -> &'a mut KanbanColumn {
    if !board.rows.is_empty() {
        // Look in all rows/stacks for an existing column with the title.
        for row in board.rows.iter() {
            for stack in row.stacks.iter() {
                for col in stack.columns.iter() {
                    if col.title == title {
                        // Found — now we need a mutable reference. We know the
                        // title is unique enough to locate again.
                        // Drop the immutable borrows and do a mutable search.
                        return find_column_mut_in_rows(&mut board.rows, title)
                            .expect("column just found");
                    }
                }
            }
        }

        // Not found — create in first row, first stack.
        if board.rows.is_empty() {
            errors.push("Board has no rows; cannot create archive column".to_string());
            // Create a fallback row/stack.
            board.rows.push(crate::types::KanbanRow {
                id: generate_id("row"),
                title: "Default".to_string(),
                stacks: vec![KanbanStack {
                    id: generate_id("stack"),
                    title: "Default".to_string(),
                    columns: Vec::new(),
                    params: HashMap::new(),
                }],
                params: HashMap::new(),
            });
        }
        let stack = &mut board.rows[0].stacks[0];
        stack.columns.push(KanbanColumn {
            id: generate_id("col"),
            title: title.to_string(),
            cards: Vec::new(),
            include_source: None,
            params: HashMap::new(),
        });
        let last = stack.columns.len() - 1;
        &mut stack.columns[last]
    } else {
        // Legacy board.columns
        if let Some(pos) = board.columns.iter().position(|c| c.title == title) {
            return &mut board.columns[pos];
        }
        board.columns.push(KanbanColumn {
            id: generate_id("col"),
            title: title.to_string(),
            cards: Vec::new(),
            include_source: None,
            params: HashMap::new(),
        });
        let last = board.columns.len() - 1;
        &mut board.columns[last]
    }
}

/// Helper: find a column by title in the rows hierarchy (mutable).
fn find_column_mut_in_rows<'a>(
    rows: &'a mut [crate::types::KanbanRow],
    title: &str,
) -> Option<&'a mut KanbanColumn> {
    for row in rows.iter_mut() {
        for stack in row.stacks.iter_mut() {
            for col in stack.columns.iter_mut() {
                if col.title == title {
                    return Some(col);
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_markdown;

    /// Helper to build a simple board from markdown.
    fn board(md: &str) -> KanbanBoard {
        parse_markdown(md)
    }

    // -- is_completed_card --------------------------------------------------

    #[test]
    fn test_is_completed_detects_checked_card() {
        let card = KanbanCard {
            id: "t1".into(),
            content: "Buy milk".into(),
            checked: true,
            kid: None,
            params: HashMap::new(),
        };
        assert!(is_completed_card(&card));
    }

    #[test]
    fn test_is_completed_detects_done_tag() {
        let card = KanbanCard {
            id: "t2".into(),
            content: "Finish report #done".into(),
            checked: false,
            kid: None,
            params: HashMap::new(),
        };
        assert!(is_completed_card(&card));
    }

    #[test]
    fn test_is_completed_detects_archived_tag() {
        let card = KanbanCard {
            id: "t3".into(),
            content: "Old task #archived".into(),
            checked: false,
            kid: None,
            params: HashMap::new(),
        };
        assert!(is_completed_card(&card));
    }

    #[test]
    fn test_is_completed_detects_done_tag_case_insensitive() {
        let card = KanbanCard {
            id: "t4".into(),
            content: "Task #Done".into(),
            checked: false,
            kid: None,
            params: HashMap::new(),
        };
        assert!(is_completed_card(&card));
    }

    #[test]
    fn test_is_completed_returns_false_for_unchecked() {
        let card = KanbanCard {
            id: "t5".into(),
            content: "Pending task".into(),
            checked: false,
            kid: None,
            params: HashMap::new(),
        };
        assert!(!is_completed_card(&card));
    }

    #[test]
    fn test_is_completed_returns_false_for_open_checkbox() {
        // A card with [ ] (open checkbox) has checked=false
        let card = KanbanCard {
            id: "t6".into(),
            content: "Open task".into(),
            checked: false,
            kid: None,
            params: HashMap::new(),
        };
        assert!(!is_completed_card(&card));
    }

    #[test]
    fn test_is_completed_false_for_done_substring() {
        // #done-ish should NOT count as #done
        let card = KanbanCard {
            id: "t7".into(),
            content: "Almost #done-ish".into(),
            checked: false,
            kid: None,
            params: HashMap::new(),
        };
        assert!(!is_completed_card(&card));
    }

    // -- find_completed_cards -----------------------------------------------

    #[test]
    fn test_find_completed_across_columns() {
        let b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n- [ ] Open task\n- [x] Done task\n\n\
             ## In Progress\n- [ ] Working\n\n\
             ## Done\n- [x] Finished\n- [x] Also finished\n",
        );
        let found = find_completed_cards(&b);
        assert_eq!(found.len(), 3);
        assert_eq!(found[0].card_title, "Done task");
        assert_eq!(found[1].card_title, "Finished");
        assert_eq!(found[2].card_title, "Also finished");
    }

    #[test]
    fn test_find_completed_with_tags() {
        let b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Col\n- [ ] Task #done\n- [ ] Normal task\n",
        );
        let found = find_completed_cards(&b);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].card_title, "Task #done");
    }

    #[test]
    fn test_find_completed_none_found() {
        let b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Col\n- [ ] Open\n- [ ] Also open\n",
        );
        let found = find_completed_cards(&b);
        assert!(found.is_empty());
    }

    // -- archive_completed_cards -------------------------------------------

    #[test]
    fn test_archive_moves_completed_to_archive_column() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n- [ ] Keep this\n- [x] Archive this\n\n\
             ## Done\n- [x] Also archive\n",
        );
        let result = archive_completed_cards(&mut b, "Archive");
        assert_eq!(result.moved_count, 2);
        assert_eq!(result.archive_column, "Archive");
        assert!(result.errors.is_empty());

        let cols = b.all_columns();
        // Todo should have 1 card left
        let todo = cols.iter().find(|c| c.title == "Todo").unwrap();
        assert_eq!(todo.cards.len(), 1);
        assert_eq!(todo.cards[0].content, "Keep this");

        // Done should be empty
        let done = cols.iter().find(|c| c.title == "Done").unwrap();
        assert_eq!(done.cards.len(), 0);

        // Archive should have 2 cards
        let archive = cols.iter().find(|c| c.title == "Archive").unwrap();
        assert_eq!(archive.cards.len(), 2);
    }

    #[test]
    fn test_archive_creates_column_if_missing() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n- [x] Done task\n",
        );
        assert!(b.all_columns().iter().all(|c| c.title != "Archive"));

        let result = archive_completed_cards(&mut b, "Archive");
        assert_eq!(result.moved_count, 1);

        let cols = b.all_columns();
        let archive = cols.iter().find(|c| c.title == "Archive");
        assert!(archive.is_some());
        assert_eq!(archive.unwrap().cards.len(), 1);
    }

    #[test]
    fn test_archive_preserves_kid() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n- [x] Task <!-- kid:abcd1234 -->\n",
        );
        // The parser extracts the kid
        let kid_before = b.all_columns()[0].cards[0].kid.clone();
        assert_eq!(kid_before, Some("abcd1234".to_string()));

        archive_completed_cards(&mut b, "Archive");

        let cols = b.all_columns();
        let archive = cols.iter().find(|c| c.title == "Archive").unwrap();
        assert_eq!(archive.cards[0].kid, Some("abcd1234".to_string()));
    }

    #[test]
    fn test_archive_no_completed_returns_zero() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n- [ ] Open\n",
        );
        let result = archive_completed_cards(&mut b, "Archive");
        assert_eq!(result.moved_count, 0);
        // Archive column should NOT be created when nothing to move
        assert!(b.all_columns().iter().all(|c| c.title != "Archive"));
    }

    #[test]
    fn test_archive_uses_existing_archive_column() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n- [x] New done\n\n\
             ## Archive\n- [x] Already archived\n",
        );
        let result = archive_completed_cards(&mut b, "Archive");
        // The already-archived card stays, plus 1 new card
        assert_eq!(result.moved_count, 1);

        let cols = b.all_columns();
        let archive = cols.iter().find(|c| c.title == "Archive").unwrap();
        // 1 already there + 1 moved
        assert_eq!(archive.cards.len(), 2);
    }

    #[test]
    fn test_archive_cards_removed_from_source() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Col1\n- [ ] Open1\n- [x] Done1\n- [ ] Open2\n\n\
             ## Col2\n- [x] Done2\n- [ ] Open3\n",
        );
        archive_completed_cards(&mut b, "Archive");

        let cols = b.all_columns();
        let col1 = cols.iter().find(|c| c.title == "Col1").unwrap();
        assert_eq!(col1.cards.len(), 2);
        assert!(col1.cards.iter().all(|c| !c.checked));

        let col2 = cols.iter().find(|c| c.title == "Col2").unwrap();
        assert_eq!(col2.cards.len(), 1);
        assert!(!col2.cards[0].checked);
    }

    #[test]
    fn test_archive_multiple_from_different_columns() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## A\n- [x] Done A\n\n\
             ## B\n- [x] Done B\n\n\
             ## C\n- [x] Done C\n",
        );
        let result = archive_completed_cards(&mut b, "Archive");
        assert_eq!(result.moved_count, 3);

        let cols = b.all_columns();
        let archive = cols.iter().find(|c| c.title == "Archive").unwrap();
        assert_eq!(archive.cards.len(), 3);

        // Verify order: should be A, B, C (original column order)
        let titles: Vec<&str> = archive.cards.iter().map(|c| c.content.as_str()).collect();
        assert_eq!(titles, vec!["Done A", "Done B", "Done C"]);
    }

    // -- archive_cards_by_date ---------------------------------------------

    #[test]
    fn test_archive_by_date_moves_old_cards() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n\
             - [ ] Old task @2020-01-01\n\
             - [ ] Recent task @2030-06-01\n\
             - [ ] No date task\n",
        );
        let result = archive_cards_by_date(&mut b, "2025-01-01", "Archive");
        assert_eq!(result.moved_count, 1);

        let cols = b.all_columns();
        let todo = cols.iter().find(|c| c.title == "Todo").unwrap();
        assert_eq!(todo.cards.len(), 2);

        let archive = cols.iter().find(|c| c.title == "Archive").unwrap();
        assert_eq!(archive.cards.len(), 1);
        assert!(archive.cards[0].content.contains("2020-01-01"));
    }

    #[test]
    fn test_archive_by_date_invalid_date_string() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n- [ ] Task @2020-01-01\n",
        );
        let result = archive_cards_by_date(&mut b, "not-a-date", "Archive");
        assert_eq!(result.moved_count, 0);
        assert!(!result.errors.is_empty());
    }

    #[test]
    fn test_archive_by_date_no_matching_cards() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Todo\n- [ ] Future task @2030-06-01\n",
        );
        let result = archive_cards_by_date(&mut b, "2025-01-01", "Archive");
        assert_eq!(result.moved_count, 0);
        assert!(result.errors.is_empty());
    }

    // -- new format (hierarchical rows/stacks) tests ------------------------

    #[test]
    fn test_archive_new_format_board() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             # Work\n\n\
             ## Frontend\n\n\
             ### Todo\n- [ ] Build UI\n- [x] Design mockup\n\n\
             ### Done\n- [x] Old task\n\n\
             ## Backend\n\n\
             ### Backlog\n- [x] Setup DB\n",
        );
        let result = archive_completed_cards(&mut b, "Archive");
        assert_eq!(result.moved_count, 3);

        // Archive column should be in first row, first stack
        let archive_col = &b.rows[0].stacks[0]
            .columns
            .iter()
            .find(|c| c.title == "Archive");
        assert!(archive_col.is_some());
        assert_eq!(archive_col.unwrap().cards.len(), 3);
    }

    #[test]
    fn test_archive_done_tag_only() {
        let mut b = board(
            "---\nkanban-plugin: board\n---\n\n\
             ## Col\n- [ ] Task A #done\n- [ ] Task B\n- [ ] Task C #archived\n",
        );
        let result = archive_completed_cards(&mut b, "Archive");
        assert_eq!(result.moved_count, 2);

        let cols = b.all_columns();
        let col = cols.iter().find(|c| c.title == "Col").unwrap();
        assert_eq!(col.cards.len(), 1);
        assert_eq!(col.cards[0].content, "Task B");
    }
}
