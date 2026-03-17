pub mod backup;
pub mod local;
pub mod registry;

use std::path::PathBuf;

use self::backup::CrashsaveEntry;
use crate::merge::merge::MergeResult;
use crate::search::SearchOptions;
use crate::types::{BoardInfo, KanbanBoard, SearchResult};

/// Result of a board write operation.
#[derive(Debug, Clone)]
pub struct WriteResult {
    pub merge_result: Option<MergeResult>,
    /// When a legacy-format board is saved, the write is redirected to a new
    /// file (`{name}-lexera2.md`) so the original stays untouched.
    pub redirected_path: Option<PathBuf>,
}

/// Abstract storage trait for board backends.
/// Implementations: LocalStorage (filesystem), future: iCloud, Dropbox, etc.
pub trait BoardStorage: Send + Sync {
    /// List all tracked boards with summary info.
    fn list_boards(&self) -> Vec<BoardInfo>;

    /// Read and parse a board by its ID.
    fn read_board(&self, board_id: &str) -> Option<KanbanBoard>;

    /// Write a full board back to storage.
    fn write_board(
        &self,
        board_id: &str,
        board: &KanbanBoard,
    ) -> Result<WriteResult, StorageError>;

    /// Add a card to a specific column in a board.
    fn add_card(&self, board_id: &str, col_index: usize, content: &str)
        -> Result<(), StorageError>;

    /// Append content to an existing card (identified by card ID).
    fn append_to_card(
        &self,
        board_id: &str,
        card_id: &str,
        content: &str,
    ) -> Result<(), StorageError>;

    /// Search cards across all boards.
    fn search(&self, query: &str) -> Vec<SearchResult>;

    /// Search cards with explicit options (regex, case sensitivity).
    fn search_with_options(&self, query: &str, options: SearchOptions) -> Vec<SearchResult> {
        let _ = options;
        self.search(query)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Board not found: {0}")]
    BoardNotFound(String),

    #[error("Column index {index} out of range (0-{max})")]
    ColumnOutOfRange { index: usize, max: usize },

    #[error("Card not found: {0}")]
    CardNotFound(String),

    #[error("Invalid board: {0}")]
    InvalidBoard(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Internal lock poisoned: {0}")]
    LockPoisoned(String),

    #[error("Conflict detected on board {board_id}: {conflicts} unresolved conflicts")]
    ConflictDetected {
        board_id: String,
        conflicts: usize,
        merge_result: Box<MergeResult>,
        crashsave: Option<CrashsaveEntry>,
    },

}
