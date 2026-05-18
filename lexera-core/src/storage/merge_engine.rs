use std::collections::HashMap;

#[cfg(feature = "crdt")]
use crate::crdt::bridge::CrdtStore;
use crate::merge::diff::{apply_change, diff_boards, snapshot_board, CardChange};
use crate::merge::merge::{CardConflict, ConflictField, MergeResult};
use crate::parser;
use crate::types::KanbanBoard;

use super::StorageError;

pub struct MergeRequest<'a> {
    pub board_id: &'a str,
    pub base: &'a KanbanBoard,
    pub current: &'a KanbanBoard,
    pub incoming: &'a KanbanBoard,
}

pub struct MergeOutcome<A> {
    pub board: KanbanBoard,
    pub artifact: A,
}

pub trait MergeEngine {
    type Artifact;

    fn merge_from_base(
        &self,
        request: MergeRequest<'_>,
    ) -> Result<MergeOutcome<Self::Artifact>, StorageError>;
}

#[cfg(feature = "crdt")]
pub struct CrdtMergeEngine;

#[cfg(feature = "crdt")]
impl MergeEngine for CrdtMergeEngine {
    type Artifact = CrdtStore;

    fn merge_from_base(
        &self,
        request: MergeRequest<'_>,
    ) -> Result<MergeOutcome<CrdtStore>, StorageError> {
        let base_store = CrdtStore::from_board(request.base)?;
        let snapshot = base_store.save()?;

        let mut current_store = CrdtStore::load(&snapshot)?;
        current_store.apply_board(request.current, request.base)?;

        let mut incoming_store = CrdtStore::load(&snapshot)?;
        incoming_store.set_peer_id(2)?;
        incoming_store.apply_board(request.incoming, request.base)?;

        let current_vv = current_store.oplog_vv();
        let incoming_delta = incoming_store.export_updates_since(&current_vv)?;
        current_store.import_updates(&incoming_delta)?;

        let merged_board = current_store.to_board_result()?;
        Ok(MergeOutcome {
            board: merged_board,
            artifact: current_store,
        })
    }
}

pub struct ConservativeMarkdownMergeEngine;

impl ConservativeMarkdownMergeEngine {
    fn semantic_signature(board: &KanbanBoard) -> String {
        let mut board = board.clone();
        board.generation_meta = None;
        board.reconcile_format_hint();
        parser::generate_markdown(&board)
    }
}

impl MergeEngine for ConservativeMarkdownMergeEngine {
    type Artifact = ();

    fn merge_from_base(&self, request: MergeRequest<'_>) -> Result<MergeOutcome<()>, StorageError> {
        let base = Self::semantic_signature(request.base);
        let current = Self::semantic_signature(request.current);
        let incoming = Self::semantic_signature(request.incoming);

        if incoming == current || incoming == base {
            return Ok(MergeOutcome {
                board: request.current.clone(),
                artifact: (),
            });
        }

        if current == base {
            return Ok(MergeOutcome {
                board: request.incoming.clone(),
                artifact: (),
            });
        }

        Err(StorageError::ConflictDetected {
            board_id: request.board_id.to_string(),
            conflicts: 1,
            merge_result: Box::new(MergeResult {
                board: request.incoming.clone(),
                conflicts: vec![CardConflict {
                    card_id: request.board_id.to_string(),
                    column_title: "<board>".to_string(),
                    field: ConflictField::Content,
                    base_value: base,
                    theirs_value: current,
                    ours_value: incoming,
                }],
                auto_merged: 0,
            }),
            crashsave: None,
        })
    }
}

/// Non-CRDT 3-way merge keyed by card identity (kid).
///
/// Replays the changes `incoming` made relative to `base` onto `current`.
/// Non-overlapping add / remove / move / edit are integrated automatically;
/// genuine same-card conflicts (both sides edited the same card to different
/// values, or edit-vs-delete) are recorded in the returned [`MergeResult`]
/// without being silently dropped — `current`'s value is kept in the merged
/// board and the conflict is surfaced for the user to resolve in the merge
/// view. This engine never errors on conflict; the caller decides whether to
/// prompt or take a strategy automatically.
pub struct CardIdentityMergeEngine;

impl CardIdentityMergeEngine {
    fn conflict(
        kid: &str,
        column_title: &str,
        field: ConflictField,
        base_value: String,
        theirs_value: String,
        ours_value: String,
    ) -> CardConflict {
        CardConflict {
            card_id: kid.to_string(),
            column_title: column_title.to_string(),
            field,
            base_value,
            theirs_value,
            ours_value,
        }
    }
}

impl MergeEngine for CardIdentityMergeEngine {
    type Artifact = MergeResult;

    fn merge_from_base(
        &self,
        request: MergeRequest<'_>,
    ) -> Result<MergeOutcome<MergeResult>, StorageError> {
        let incoming_changes = diff_boards(request.base, request.incoming);
        let current_changes = diff_boards(request.base, request.current);

        // Index current's changes by kid (a card can be both Moved and
        // Modified, so each kid maps to a list).
        let mut current_by_kid: HashMap<&str, Vec<&CardChange>> = HashMap::new();
        for ch in &current_changes {
            current_by_kid.entry(ch.kid()).or_default().push(ch);
        }

        let base_snap = snapshot_board(request.base);
        let current_snap = snapshot_board(request.current);

        let mut merged = request.current.clone();
        let mut conflicts: Vec<CardConflict> = Vec::new();
        let mut auto_merged = 0usize;

        for ch in &incoming_changes {
            let kid = ch.kid();
            let cur = current_by_kid.get(kid).map(|v| v.as_slice()).unwrap_or(&[]);
            let cur_removed = cur.iter().any(|c| matches!(c, CardChange::Removed { .. }));
            let cur_modified = cur.iter().find_map(|c| match c {
                CardChange::Modified {
                    new_content,
                    new_checked,
                    new_params,
                    ..
                } => Some((new_content.clone(), *new_checked, new_params.clone())),
                _ => None,
            });
            let cur_moved = cur.iter().find_map(|c| match c {
                CardChange::Moved { new_column_id, .. } => Some(new_column_id.clone()),
                _ => None,
            });

            match ch {
                CardChange::Added {
                    column_title, card, ..
                } => {
                    if let Some(existing) = current_snap.get(kid) {
                        // Both sides introduced the same kid.
                        let incoming_content =
                            crate::merge::card_identity::strip_kid(&card.content);
                        if existing.content != incoming_content {
                            conflicts.push(Self::conflict(
                                kid,
                                column_title,
                                ConflictField::Content,
                                String::new(),
                                existing.content.clone(),
                                incoming_content,
                            ));
                        }
                    } else if apply_change(&mut merged, ch) {
                        auto_merged += 1;
                    }
                }
                CardChange::Removed { column_title, .. } => {
                    if cur_removed {
                        // both removed — nothing to do
                    } else if cur_modified.is_some() || cur_moved.is_some() {
                        let base_content = base_snap
                            .get(kid)
                            .map(|s| s.content.clone())
                            .unwrap_or_default();
                        let theirs = current_snap
                            .get(kid)
                            .map(|s| s.content.clone())
                            .unwrap_or_default();
                        conflicts.push(Self::conflict(
                            kid,
                            column_title,
                            ConflictField::Content,
                            base_content,
                            theirs,
                            String::from("<deleted>"),
                        ));
                    } else if apply_change(&mut merged, ch) {
                        auto_merged += 1;
                    }
                }
                CardChange::Modified {
                    column_title,
                    new_content,
                    new_checked,
                    new_params,
                    ..
                } => {
                    if let Some((cc, ck, cp)) = cur_modified.clone() {
                        if &cc == new_content && ck == *new_checked && &cp == new_params {
                            // identical edit on both sides — already in current
                        } else {
                            let field = if &cc != new_content {
                                ConflictField::Content
                            } else {
                                ConflictField::Checked
                            };
                            let base_content = base_snap
                                .get(kid)
                                .map(|s| s.content.clone())
                                .unwrap_or_default();
                            conflicts.push(Self::conflict(
                                kid,
                                column_title,
                                field,
                                base_content,
                                cc,
                                new_content.clone(),
                            ));
                        }
                    } else if cur_removed {
                        let base_content = base_snap
                            .get(kid)
                            .map(|s| s.content.clone())
                            .unwrap_or_default();
                        conflicts.push(Self::conflict(
                            kid,
                            column_title,
                            ConflictField::Content,
                            base_content,
                            String::from("<deleted>"),
                            new_content.clone(),
                        ));
                    } else if apply_change(&mut merged, ch) {
                        auto_merged += 1;
                    }
                }
                CardChange::Moved {
                    new_column,
                    new_column_id,
                    ..
                } => {
                    if let Some(cur_target) = cur_moved.clone() {
                        if &cur_target != new_column_id {
                            conflicts.push(Self::conflict(
                                kid,
                                new_column,
                                ConflictField::Position,
                                String::new(),
                                cur_target,
                                new_column_id.clone(),
                            ));
                        }
                    } else if cur_removed {
                        conflicts.push(Self::conflict(
                            kid,
                            new_column,
                            ConflictField::Position,
                            String::new(),
                            String::from("<deleted>"),
                            new_column.clone(),
                        ));
                    } else if apply_change(&mut merged, ch) {
                        auto_merged += 1;
                    }
                }
            }
        }

        let result = MergeResult {
            board: merged.clone(),
            conflicts,
            auto_merged,
        };
        Ok(MergeOutcome {
            board: merged,
            artifact: result,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CardIdentityMergeEngine, ConservativeMarkdownMergeEngine, MergeEngine, MergeRequest,
    };

    fn board(markdown: &str) -> crate::types::KanbanBoard {
        crate::parser::parse_markdown(markdown)
    }

    fn markdown(card: &str) -> String {
        format!(
            "---\nkanban-plugin: board\n---\n\n## Todo\n- [ ] {}\n",
            card
        )
    }

    #[test]
    fn markdown_merge_accepts_incoming_when_current_unchanged() {
        let base = board(&markdown("Base"));
        let current = base.clone();
        let incoming = board(&markdown("Incoming"));
        let engine = ConservativeMarkdownMergeEngine;

        let outcome = engine
            .merge_from_base(MergeRequest {
                board_id: "board",
                base: &base,
                current: &current,
                incoming: &incoming,
            })
            .unwrap();

        assert_eq!(
            crate::parser::generate_markdown(&outcome.board),
            crate::parser::generate_markdown(&incoming)
        );
    }

    #[test]
    fn markdown_merge_keeps_current_when_incoming_unchanged() {
        let base = board(&markdown("Base"));
        let current = board(&markdown("Current"));
        let incoming = base.clone();
        let engine = ConservativeMarkdownMergeEngine;

        let outcome = engine
            .merge_from_base(MergeRequest {
                board_id: "board",
                base: &base,
                current: &current,
                incoming: &incoming,
            })
            .unwrap();

        assert_eq!(
            crate::parser::generate_markdown(&outcome.board),
            crate::parser::generate_markdown(&current)
        );
    }

    #[test]
    fn markdown_merge_rejects_divergent_changes() {
        let base = board(&markdown("Base"));
        let current = board(&markdown("Current"));
        let incoming = board(&markdown("Incoming"));
        let engine = ConservativeMarkdownMergeEngine;

        let result = engine.merge_from_base(MergeRequest {
            board_id: "board",
            base: &base,
            current: &current,
            incoming: &incoming,
        });

        assert!(matches!(
            result,
            Err(crate::storage::StorageError::ConflictDetected { .. })
        ));
    }

    // ── CardIdentityMergeEngine ──────────────────────────────────────────

    use crate::types::{BoardFormat, KanbanBoard, KanbanCard, KanbanColumn};
    use std::collections::HashMap;

    fn mk_card(kid: &str, content: &str, checked: bool) -> KanbanCard {
        KanbanCard {
            id: format!("id-{}", kid),
            content: content.to_string(),
            checked,
            kid: Some(kid.to_string()),
            params: HashMap::new(),
        }
    }

    fn mk_board(columns: Vec<(&str, Vec<KanbanCard>)>) -> KanbanBoard {
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

    fn col_kids<'a>(board: &'a KanbanBoard, title: &str) -> Vec<&'a str> {
        board
            .all_columns()
            .into_iter()
            .find(|c| c.title == title)
            .map(|c| {
                c.cards
                    .iter()
                    .map(|card| card.kid.as_deref().unwrap_or(""))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn card_identity_merges_nonoverlapping_add() {
        // base [A]; current adds B; incoming adds C → merged has A,B,C
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "A", false)])]);
        let current = mk_board(vec![(
            "Todo",
            vec![mk_card("k1", "A", false), mk_card("k2", "B", false)],
        )]);
        let incoming = mk_board(vec![(
            "Todo",
            vec![mk_card("k1", "A", false), mk_card("k3", "C", false)],
        )]);

        let outcome = CardIdentityMergeEngine
            .merge_from_base(MergeRequest {
                board_id: "b",
                base: &base,
                current: &current,
                incoming: &incoming,
            })
            .unwrap();

        let kids = col_kids(&outcome.board, "Todo");
        assert!(kids.contains(&"k1") && kids.contains(&"k2") && kids.contains(&"k3"));
        assert_eq!(outcome.artifact.conflicts.len(), 0);
        assert_eq!(outcome.artifact.auto_merged, 1);
    }

    #[test]
    fn card_identity_same_card_edit_is_conflict_keeps_current() {
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "x", false)])]);
        let current = mk_board(vec![("Todo", vec![mk_card("k1", "current-edit", false)])]);
        let incoming = mk_board(vec![("Todo", vec![mk_card("k1", "incoming-edit", false)])]);

        let outcome = CardIdentityMergeEngine
            .merge_from_base(MergeRequest {
                board_id: "b",
                base: &base,
                current: &current,
                incoming: &incoming,
            })
            .unwrap();

        assert_eq!(outcome.artifact.conflicts.len(), 1);
        assert_eq!(outcome.artifact.auto_merged, 0);
        // current's value is preserved in the merged board (nothing lost)
        let card = outcome.board.all_columns()[0].cards[0].clone();
        assert_eq!(card.content, "current-edit");
        let c = &outcome.artifact.conflicts[0];
        assert_eq!(c.card_id, "k1");
        assert_eq!(c.theirs_value, "current-edit");
        assert_eq!(c.ours_value, "incoming-edit");
    }

    #[test]
    fn card_identity_identical_edit_is_not_conflict() {
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "x", false)])]);
        let same = mk_board(vec![("Todo", vec![mk_card("k1", "y", false)])]);

        let outcome = CardIdentityMergeEngine
            .merge_from_base(MergeRequest {
                board_id: "b",
                base: &base,
                current: &same,
                incoming: &same,
            })
            .unwrap();

        assert_eq!(outcome.artifact.conflicts.len(), 0);
        assert_eq!(outcome.board.all_columns()[0].cards[0].content, "y");
    }

    #[test]
    fn card_identity_incoming_remove_applies_when_current_untouched() {
        let base = mk_board(vec![(
            "Todo",
            vec![mk_card("k1", "A", false), mk_card("k2", "B", false)],
        )]);
        let current = base.clone();
        let incoming = mk_board(vec![("Todo", vec![mk_card("k1", "A", false)])]);

        let outcome = CardIdentityMergeEngine
            .merge_from_base(MergeRequest {
                board_id: "b",
                base: &base,
                current: &current,
                incoming: &incoming,
            })
            .unwrap();

        let kids = col_kids(&outcome.board, "Todo");
        assert_eq!(kids, vec!["k1"]);
        assert_eq!(outcome.artifact.conflicts.len(), 0);
        assert_eq!(outcome.artifact.auto_merged, 1);
    }

    #[test]
    fn card_identity_edit_vs_delete_is_conflict() {
        // current deletes k1; incoming edits k1 → conflict, current (deleted) kept
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "x", false)])]);
        let current = mk_board(vec![("Todo", vec![])]);
        let incoming = mk_board(vec![("Todo", vec![mk_card("k1", "edited", false)])]);

        let outcome = CardIdentityMergeEngine
            .merge_from_base(MergeRequest {
                board_id: "b",
                base: &base,
                current: &current,
                incoming: &incoming,
            })
            .unwrap();

        assert_eq!(outcome.artifact.conflicts.len(), 1);
        assert!(col_kids(&outcome.board, "Todo").is_empty());
    }

    #[test]
    fn card_identity_move_auto_merges() {
        let base = mk_board(vec![
            ("Todo", vec![mk_card("k1", "A", false)]),
            ("Done", vec![]),
        ]);
        let current = base.clone();
        let incoming = mk_board(vec![
            ("Todo", vec![]),
            ("Done", vec![mk_card("k1", "A", false)]),
        ]);

        let outcome = CardIdentityMergeEngine
            .merge_from_base(MergeRequest {
                board_id: "b",
                base: &base,
                current: &current,
                incoming: &incoming,
            })
            .unwrap();

        assert!(col_kids(&outcome.board, "Todo").is_empty());
        assert_eq!(col_kids(&outcome.board, "Done"), vec!["k1"]);
        assert_eq!(outcome.artifact.conflicts.len(), 0);
        assert_eq!(outcome.artifact.auto_merged, 1);
    }
}
