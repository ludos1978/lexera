use serde::{Deserialize, Serialize};

use crate::types::KanbanBoard;

/// Summary of a save/rebase outcome.
///
/// The save system no longer uses three-way merge. This type remains as the
/// transport shape for conflict reporting and auto-merge metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    /// Resulting board snapshot or local draft snapshot attached to the outcome.
    pub board: KanbanBoard,
    /// Unresolved conflicts that require user action.
    pub conflicts: Vec<CardConflict>,
    /// Count of automatically integrated changes, if reported.
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
