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

use crate::merge::merge::CardConflict;
use crate::types::KanbanBoard;

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
}
