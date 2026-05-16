//! Non-CRDT merge resolution contract.
//!
//! When the `crdt` feature is compiled out, a board save that diverged from
//! another source (external file edit, mobile capture, web-clipper) is run
//! through [`crate::storage::merge_engine::CardIdentityMergeEngine`]. If that
//! produces unresolved conflicts, the backend hands the frontend a
//! [`MergeProposal`] describing the three sides, the auto-merged result, and
//! the per-card conflicts. The user resolves it in the merge view and sends
//! back a [`MergeResolution`] selecting an overall strategy and, for the
//! card-identity strategy, a per-conflict pick.
//!
//! These types are pure data (no CRDT, no IO) so they compile and serialize
//! identically regardless of the `crdt` feature.

use serde::{Deserialize, Serialize};

use crate::merge::diff::{apply_change, snapshot_board, CardChange, CardSnapshot};
use crate::merge::merge::CardConflict;
use crate::types::{KanbanBoard, KanbanCard};

/// Which of the three merge sides a value should come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictSide {
    /// The value from the common ancestor.
    Base,
    /// The value already on disk / from the other source ("theirs").
    Theirs,
    /// The value from this client's draft ("ours" — the incoming save).
    Ours,
}

/// Overall strategy the user picked in the merge view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MergeStrategy {
    /// Card-identity 3-way merge: take the auto-merged board and apply the
    /// user's per-conflict [`ConflictChoice`]s.
    CardIdentityThreeWay,
    /// Keep one whole side as the saved board and write the other side to a
    /// `{stem}-conflict-{timestamp}.md` backup so nothing is lost.
    ConflictFileBackup,
}

/// What the backend offers the frontend when a non-CRDT save conflicts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeProposal {
    pub board_id: String,
    /// Common ancestor.
    pub base: KanbanBoard,
    /// State already persisted / from the other source.
    pub current: KanbanBoard,
    /// This client's draft that triggered the save.
    pub incoming: KanbanBoard,
    /// `CardIdentityMergeEngine` output: non-overlapping changes already
    /// integrated, conflicting cards left at `current`'s value.
    pub auto_merged_board: KanbanBoard,
    /// Count of changes integrated without user input.
    pub auto_merged: usize,
    /// Per-card conflicts still needing a decision.
    pub conflicts: Vec<CardConflict>,
    /// Strategies the user may choose between in the merge view.
    pub strategies: Vec<MergeStrategy>,
}

impl MergeProposal {
    /// Both supported strategies, in display order.
    pub fn default_strategies() -> Vec<MergeStrategy> {
        vec![
            MergeStrategy::CardIdentityThreeWay,
            MergeStrategy::ConflictFileBackup,
        ]
    }
}

/// One user decision for a single conflicting card.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictChoice {
    /// The conflicting card's kid (matches [`CardConflict::card_id`]).
    pub card_id: String,
    /// Which side to keep for this card.
    pub pick: ConflictSide,
}

/// What the frontend sends back to apply the user's merge decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResolution {
    pub board_id: String,
    pub strategy: MergeStrategy,
    /// For [`MergeStrategy::CardIdentityThreeWay`]: one entry per conflict.
    /// Conflicts without an entry default to keeping `current` ("theirs").
    #[serde(default)]
    pub choices: Vec<ConflictChoice>,
    /// For [`MergeStrategy::ConflictFileBackup`]: which side becomes the
    /// saved board. The other side is written to the conflict backup file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_keep: Option<ConflictSide>,
}

/// Outcome of applying a [`MergeResolution`].
pub struct ResolvedMerge {
    /// The final board to persist.
    pub board: KanbanBoard,
    /// For [`MergeStrategy::ConflictFileBackup`] only: the discarded side,
    /// to be written to `{stem}-conflict-{timestamp}.md` so it is never
    /// silently lost. `None` for the three-way strategy (nothing is
    /// discarded wholesale there).
    pub backup: Option<KanbanBoard>,
}

/// Force the card identified by `kid` in `board` to match `target`
/// (a snapshot from one of the three sides), or remove it when `target`
/// is `None` (that side deleted the card). No-op when neither side has it.
fn set_card_to(board: &mut KanbanBoard, kid: &str, target: Option<&CardSnapshot>) {
    let present = snapshot_board(board).get(kid).cloned();
    match (present, target) {
        (Some(_), None) => {
            apply_change(
                board,
                &CardChange::Removed {
                    kid: kid.to_string(),
                    column_id: String::new(),
                    column_title: String::new(),
                },
            );
        }
        (None, Some(t)) => {
            apply_change(
                board,
                &CardChange::Added {
                    kid: kid.to_string(),
                    column_id: t.column_id.clone(),
                    column_title: t.column_title.clone(),
                    card: KanbanCard {
                        id: String::new(),
                        content: t.content.clone(),
                        checked: t.checked,
                        kid: Some(kid.to_string()),
                        params: t.params.clone(),
                    },
                    position: t.position,
                },
            );
        }
        (Some(p), Some(t)) => {
            apply_change(
                board,
                &CardChange::Modified {
                    kid: kid.to_string(),
                    column_id: p.column_id.clone(),
                    column_title: p.column_title.clone(),
                    old_content: p.content.clone(),
                    new_content: t.content.clone(),
                    old_checked: p.checked,
                    new_checked: t.checked,
                    old_params: p.params.clone(),
                    new_params: t.params.clone(),
                },
            );
            if p.column_id != t.column_id || p.column_title != t.column_title {
                apply_change(
                    board,
                    &CardChange::Moved {
                        kid: kid.to_string(),
                        old_column_id: p.column_id.clone(),
                        old_column: p.column_title.clone(),
                        new_column_id: t.column_id.clone(),
                        new_column: t.column_title.clone(),
                        position: t.position,
                    },
                );
            }
        }
        (None, None) => {}
    }
}

/// Apply a user [`MergeResolution`] to the three sides + the engine's
/// auto-merged board, producing the board to persist.
///
/// - [`MergeStrategy::ConflictFileBackup`]: keep one whole side; the other
///   is returned in `backup` for the caller to write via the existing
///   `BackupManager::create_conflict_backup`.
/// - [`MergeStrategy::CardIdentityThreeWay`]: start from the auto-merged
///   board (already current-biased, non-conflicting changes integrated)
///   and switch each conflicting card to the side the user picked. A
///   conflict with no explicit choice defaults to keeping `current`
///   ("theirs") — never silently takes the incoming value.
pub fn apply_resolution(
    base: &KanbanBoard,
    current: &KanbanBoard,
    incoming: &KanbanBoard,
    auto_merged: &KanbanBoard,
    conflicts: &[CardConflict],
    resolution: &MergeResolution,
) -> ResolvedMerge {
    match resolution.strategy {
        MergeStrategy::ConflictFileBackup => {
            let keep = resolution.backup_keep.unwrap_or(ConflictSide::Theirs);
            match keep {
                ConflictSide::Theirs => ResolvedMerge {
                    board: current.clone(),
                    backup: Some(incoming.clone()),
                },
                ConflictSide::Ours => ResolvedMerge {
                    board: incoming.clone(),
                    backup: Some(current.clone()),
                },
                ConflictSide::Base => ResolvedMerge {
                    board: base.clone(),
                    backup: Some(incoming.clone()),
                },
            }
        }
        MergeStrategy::CardIdentityThreeWay => {
            let mut board = auto_merged.clone();
            let incoming_snap = snapshot_board(incoming);
            let base_snap = snapshot_board(base);
            for conflict in conflicts {
                let kid = conflict.card_id.as_str();
                let pick = resolution
                    .choices
                    .iter()
                    .find(|c| c.card_id == kid)
                    .map(|c| c.pick)
                    .unwrap_or(ConflictSide::Theirs);
                match pick {
                    ConflictSide::Theirs => {}
                    ConflictSide::Ours => set_card_to(&mut board, kid, incoming_snap.get(kid)),
                    ConflictSide::Base => set_card_to(&mut board, kid, base_snap.get(kid)),
                }
            }
            ResolvedMerge {
                board,
                backup: None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strategy_serializes_kebab_case() {
        assert_eq!(
            serde_json::to_string(&MergeStrategy::CardIdentityThreeWay).unwrap(),
            "\"card-identity-three-way\""
        );
        assert_eq!(
            serde_json::to_string(&MergeStrategy::ConflictFileBackup).unwrap(),
            "\"conflict-file-backup\""
        );
    }

    #[test]
    fn conflict_side_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&ConflictSide::Ours).unwrap(),
            "\"ours\""
        );
        assert_eq!(
            serde_json::to_string(&ConflictSide::Theirs).unwrap(),
            "\"theirs\""
        );
        assert_eq!(
            serde_json::to_string(&ConflictSide::Base).unwrap(),
            "\"base\""
        );
    }

    #[test]
    fn resolution_round_trips_and_defaults_optionals() {
        // Minimal payload: no choices, no backup_keep — both default cleanly.
        let json = r#"{"boardId":"b1","strategy":"card-identity-three-way"}"#;
        let parsed: MergeResolution = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.board_id, "b1");
        assert_eq!(parsed.strategy, MergeStrategy::CardIdentityThreeWay);
        assert!(parsed.choices.is_empty());
        assert!(parsed.backup_keep.is_none());

        let full = MergeResolution {
            board_id: "b2".into(),
            strategy: MergeStrategy::ConflictFileBackup,
            choices: vec![ConflictChoice {
                card_id: "kid123".into(),
                pick: ConflictSide::Ours,
            }],
            backup_keep: Some(ConflictSide::Theirs),
        };
        let s = serde_json::to_string(&full).unwrap();
        let back: MergeResolution = serde_json::from_str(&s).unwrap();
        assert_eq!(back.board_id, "b2");
        assert_eq!(back.strategy, MergeStrategy::ConflictFileBackup);
        assert_eq!(back.choices.len(), 1);
        assert_eq!(back.choices[0].card_id, "kid123");
        assert_eq!(back.choices[0].pick, ConflictSide::Ours);
        assert_eq!(back.backup_keep, Some(ConflictSide::Theirs));
    }

    #[test]
    fn default_strategies_offers_both() {
        let s = MergeProposal::default_strategies();
        assert_eq!(s.len(), 2);
        assert!(s.contains(&MergeStrategy::CardIdentityThreeWay));
        assert!(s.contains(&MergeStrategy::ConflictFileBackup));
    }

    // ── apply_resolution ─────────────────────────────────────────────────

    use crate::merge::merge::ConflictField;
    use crate::types::{BoardFormat, KanbanColumn};
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

    fn content_conflict(kid: &str) -> CardConflict {
        CardConflict {
            card_id: kid.to_string(),
            column_title: "Todo".to_string(),
            field: ConflictField::Content,
            base_value: "base".to_string(),
            theirs_value: "theirs".to_string(),
            ours_value: "ours".to_string(),
        }
    }

    fn first_card_content(board: &KanbanBoard) -> Option<String> {
        board
            .all_columns()
            .first()
            .and_then(|c| c.cards.first())
            .map(|c| c.content.clone())
    }

    #[test]
    fn backup_keep_theirs_saves_current_backs_up_incoming() {
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "base", false)])]);
        let current = mk_board(vec![("Todo", vec![mk_card("k1", "theirs", false)])]);
        let incoming = mk_board(vec![("Todo", vec![mk_card("k1", "ours", false)])]);
        let res = MergeResolution {
            board_id: "b".into(),
            strategy: MergeStrategy::ConflictFileBackup,
            choices: vec![],
            backup_keep: Some(ConflictSide::Theirs),
        };
        let out = apply_resolution(&base, &current, &incoming, &current, &[], &res);
        assert_eq!(first_card_content(&out.board).as_deref(), Some("theirs"));
        assert_eq!(
            out.backup.as_ref().and_then(first_card_content).as_deref(),
            Some("ours")
        );
    }

    #[test]
    fn backup_default_keep_is_theirs() {
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "base", false)])]);
        let current = mk_board(vec![("Todo", vec![mk_card("k1", "theirs", false)])]);
        let incoming = mk_board(vec![("Todo", vec![mk_card("k1", "ours", false)])]);
        let res = MergeResolution {
            board_id: "b".into(),
            strategy: MergeStrategy::ConflictFileBackup,
            choices: vec![],
            backup_keep: None,
        };
        let out = apply_resolution(&base, &current, &incoming, &current, &[], &res);
        assert_eq!(first_card_content(&out.board).as_deref(), Some("theirs"));
        assert!(out.backup.is_some());
    }

    #[test]
    fn threeway_default_choice_keeps_current() {
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "base", false)])]);
        let current = mk_board(vec![("Todo", vec![mk_card("k1", "theirs", false)])]);
        let incoming = mk_board(vec![("Todo", vec![mk_card("k1", "ours", false)])]);
        // auto_merged is current-biased for the conflicting card
        let auto = current.clone();
        let res = MergeResolution {
            board_id: "b".into(),
            strategy: MergeStrategy::CardIdentityThreeWay,
            choices: vec![],
            backup_keep: None,
        };
        let out = apply_resolution(
            &base,
            &current,
            &incoming,
            &auto,
            &[content_conflict("k1")],
            &res,
        );
        assert_eq!(first_card_content(&out.board).as_deref(), Some("theirs"));
        assert!(out.backup.is_none());
    }

    #[test]
    fn threeway_pick_ours_switches_to_incoming_value() {
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "base", false)])]);
        let current = mk_board(vec![("Todo", vec![mk_card("k1", "theirs", false)])]);
        let incoming = mk_board(vec![("Todo", vec![mk_card("k1", "ours", false)])]);
        let auto = current.clone();
        let res = MergeResolution {
            board_id: "b".into(),
            strategy: MergeStrategy::CardIdentityThreeWay,
            choices: vec![ConflictChoice {
                card_id: "k1".into(),
                pick: ConflictSide::Ours,
            }],
            backup_keep: None,
        };
        let out = apply_resolution(
            &base,
            &current,
            &incoming,
            &auto,
            &[content_conflict("k1")],
            &res,
        );
        assert_eq!(first_card_content(&out.board).as_deref(), Some("ours"));
    }

    #[test]
    fn threeway_pick_ours_when_incoming_deleted_removes_card() {
        // edit-vs-delete: current edited k1, incoming deleted it.
        let base = mk_board(vec![("Todo", vec![mk_card("k1", "base", false)])]);
        let current = mk_board(vec![("Todo", vec![mk_card("k1", "theirs-edit", false)])]);
        let incoming = mk_board(vec![("Todo", vec![])]);
        let auto = current.clone(); // current-biased keeps the card
        let res = MergeResolution {
            board_id: "b".into(),
            strategy: MergeStrategy::CardIdentityThreeWay,
            choices: vec![ConflictChoice {
                card_id: "k1".into(),
                pick: ConflictSide::Ours,
            }],
            backup_keep: None,
        };
        let out = apply_resolution(
            &base,
            &current,
            &incoming,
            &auto,
            &[content_conflict("k1")],
            &res,
        );
        assert!(out
            .board
            .all_columns()
            .first()
            .map(|c| c.cards.is_empty())
            .unwrap_or(false));
    }
}
