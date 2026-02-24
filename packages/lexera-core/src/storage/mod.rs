pub mod local;

use crate::merge::merge::MergeResult;
use crate::types::{KanbanBoard, BoardInfo, SearchResult};

/// Abstract storage trait for board backends.
/// Implementations: LocalStorage (filesystem), future: iCloud, Dropbox, etc.
pub trait BoardStorage: Send + Sync {
    /// List all tracked boards with summary info.
    fn list_boards(&self) -> Vec<BoardInfo>;

    /// Read and parse a board by its ID.
    fn read_board(&self, board_id: &str) -> Option<KanbanBoard>;

    /// Write a full board back to storage.
    /// Returns Ok(None) for clean writes, Ok(Some(MergeResult)) when merge was needed.
    fn write_board(&self, board_id: &str, board: &KanbanBoard) -> Result<Option<MergeResult>, StorageError>;

    /// Add a card to a specific column in a board.
    fn add_card(
        &self,
        board_id: &str,
        col_index: usize,
        content: &str,
    ) -> Result<(), StorageError>;

    /// Search cards across all boards.
    fn search(&self, query: &str) -> Vec<SearchResult>;
}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Board not found: {0}")]
    BoardNotFound(String),

    #[error("Column index {index} out of range (0-{max})")]
    ColumnOutOfRange { index: usize, max: usize },

    #[error("Invalid board: {0}")]
    InvalidBoard(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Conflict detected on board {board_id}: {conflicts} unresolved conflicts")]
    ConflictDetected {
        board_id: String,
        conflicts: usize,
        merge_result: MergeResult,
    },
}
