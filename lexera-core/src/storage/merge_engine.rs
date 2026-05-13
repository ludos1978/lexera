use crate::crdt::bridge::CrdtStore;
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

pub struct CrdtMergeEngine;

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

#[cfg(test)]
mod tests {
    use super::{ConservativeMarkdownMergeEngine, MergeEngine, MergeRequest};

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
}
