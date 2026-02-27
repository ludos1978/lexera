/// iOS storage backend.
///
/// Simplified BoardStorage impl for the iOS sandbox.
/// Boards stored as .md files in the App Group container.
/// Board ID = SHA-256(filename) first 12 hex chars.
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::RwLock;

use sha2::{Digest, Sha256};

use lexera_core::capture::{format_capture_as_markdown, PendingItem};
use lexera_core::merge::card_identity;
use lexera_core::parser;
use lexera_core::search::{SearchCardMeta, SearchDocument, SearchEngine, SearchOptions};
use lexera_core::storage::{BoardStorage, StorageError};
use lexera_core::types::*;

/// State for a single tracked board.
struct BoardState {
    filename: String,
    board: KanbanBoard,
    content_hash: String,
}

pub struct IosStorage {
    boards_dir: PathBuf,
    pending_path: PathBuf,
    boards: RwLock<HashMap<String, BoardState>>,
}

fn board_id_from_filename(filename: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(filename.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..6])
}

fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

impl IosStorage {
    pub fn new(boards_dir: PathBuf, pending_path: PathBuf) -> Result<Self, std::io::Error> {
        fs::create_dir_all(&boards_dir)?;
        if let Some(parent) = pending_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let storage = Self {
            boards_dir,
            pending_path,
            boards: RwLock::new(HashMap::new()),
        };

        storage.scan_boards();
        storage.ensure_inbox();

        Ok(storage)
    }

    /// Scan the boards directory and load all .md files.
    fn scan_boards(&self) {
        let entries = match fs::read_dir(&self.boards_dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        let mut boards = self.boards.write().unwrap();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let filename = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let mut board = parser::parse_markdown(&content);
            if !board.valid {
                continue;
            }
            // Set title from filename if parser didn't extract one
            if board.title.is_empty() {
                board.title = filename.trim_end_matches(".md").to_string();
            }
            let id = board_id_from_filename(&filename);
            boards.insert(
                id,
                BoardState {
                    filename,
                    board,
                    content_hash: content_hash(&content),
                },
            );
        }
    }

    /// Ensure the default Inbox board exists.
    fn ensure_inbox(&self) {
        let inbox_id = board_id_from_filename("inbox.md");
        let boards = self.boards.read().unwrap();
        if boards.contains_key(&inbox_id) {
            return;
        }
        drop(boards);

        let content = "---\nkanban-plugin: board\n---\n\n## Captured\n\n## Tagged\n\n## Archived\n";
        let path = self.boards_dir.join("inbox.md");
        if let Err(e) = fs::write(&path, content) {
            log::error!("[ios_storage] Failed to create inbox board: {}", e);
            return;
        }

        let mut board = parser::parse_markdown(content);
        board.title = "Inbox".to_string();
        let mut boards = self.boards.write().unwrap();
        boards.insert(
            inbox_id,
            BoardState {
                filename: "inbox.md".to_string(),
                board,
                content_hash: content_hash(content),
            },
        );
    }

    /// Get the board ID of the inbox board.
    pub fn inbox_board_id(&self) -> String {
        board_id_from_filename("inbox.md")
    }

    /// Create a new board with the given title and default columns.
    pub fn create_board(&self, title: &str) -> Result<String, StorageError> {
        let safe_name: String = title
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == ' ' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let filename = format!("{}.md", safe_name.trim());
        let board_id = board_id_from_filename(&filename);

        let boards = self.boards.read().unwrap();
        if boards.contains_key(&board_id) {
            return Ok(board_id);
        }
        drop(boards);

        let content = "---\nkanban-plugin: board\n---\n\n## Inbox\n\n## Done\n".to_string();
        let path = self.boards_dir.join(&filename);
        fs::write(&path, &content)?;

        let mut board = parser::parse_markdown(&content);
        board.title = title.to_string();
        let mut boards = self.boards.write().unwrap();
        boards.insert(
            board_id.clone(),
            BoardState {
                filename,
                board,
                content_hash: content_hash(&content),
            },
        );

        Ok(board_id)
    }

    /// Process pending items from the Share Sheet extension.
    pub fn process_pending(&self) -> Result<usize, StorageError> {
        if !self.pending_path.exists() {
            return Ok(0);
        }

        let content = fs::read_to_string(&self.pending_path)?;
        let items: Vec<PendingItem> = match serde_json::from_str(&content) {
            Ok(items) => items,
            Err(_) => return Ok(0),
        };

        if items.is_empty() {
            return Ok(0);
        }

        let count = items.len();
        let inbox_id = self.inbox_board_id();

        for item in &items {
            let card_content = format_capture_as_markdown(item);
            self.add_card(&inbox_id, 0, &card_content)?;
        }

        // Clear the queue
        fs::write(&self.pending_path, "[]")?;
        Ok(count)
    }

    /// Write a board back to disk atomically (.tmp + rename).
    fn write_board_file(&self, board_id: &str) -> Result<(), StorageError> {
        let boards = self.boards.read().unwrap();
        let state = boards
            .get(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        let content = parser::generate_markdown(&state.board);
        let path = self.boards_dir.join(&state.filename);
        let tmp_path = path.with_extension("md.tmp");

        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp_path, &path)?;

        drop(boards);

        // Update hash
        let mut boards = self.boards.write().unwrap();
        if let Some(state) = boards.get_mut(board_id) {
            state.content_hash = content_hash(&content);
        }

        Ok(())
    }
}

impl BoardStorage for IosStorage {
    fn list_boards(&self) -> Vec<BoardInfo> {
        let boards = self.boards.read().unwrap();
        boards
            .iter()
            .map(|(id, state)| {
                let columns: Vec<ColumnSummary> = state
                    .board
                    .all_columns()
                    .iter()
                    .enumerate()
                    .map(|(i, c)| ColumnSummary {
                        index: i,
                        title: c.title.clone(),
                        card_count: c.cards.len(),
                    })
                    .collect();
                BoardInfo {
                    id: id.clone(),
                    title: state.board.title.clone(),
                    file_path: self
                        .boards_dir
                        .join(&state.filename)
                        .to_string_lossy()
                        .to_string(),
                    last_modified: String::new(),
                    columns,
                }
            })
            .collect()
    }

    fn read_board(&self, board_id: &str) -> Option<KanbanBoard> {
        let boards = self.boards.read().unwrap();
        boards.get(board_id).map(|s| s.board.clone())
    }

    fn write_board(
        &self,
        board_id: &str,
        board: &KanbanBoard,
    ) -> Result<Option<lexera_core::merge::merge::MergeResult>, StorageError> {
        {
            let mut boards = self.boards.write().unwrap();
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            state.board = board.clone();
        }
        self.write_board_file(board_id)?;
        Ok(None)
    }

    fn add_card(
        &self,
        board_id: &str,
        col_index: usize,
        content: &str,
    ) -> Result<(), StorageError> {
        {
            let mut boards = self.boards.write().unwrap();
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

            let mut columns = state.board.all_columns_mut();
            if col_index >= columns.len() {
                return Err(StorageError::ColumnOutOfRange {
                    index: col_index,
                    max: columns.len().saturating_sub(1),
                });
            }

            // ensure_kid returns (content_with_kid, kid)
            let (content_with_kid, kid) = card_identity::ensure_kid(content);
            let card = KanbanCard {
                id: parser::generate_id("card"),
                content: content_with_kid,
                checked: false,
                kid: Some(kid),
            };
            columns[col_index].cards.push(card);
        }
        self.write_board_file(board_id)
    }

    fn search(&self, query: &str) -> Vec<SearchResult> {
        self.search_with_options(query, SearchOptions::default())
    }

    fn search_with_options(&self, query: &str, options: SearchOptions) -> Vec<SearchResult> {
        let engine = SearchEngine::compile(query, options);

        let boards = self.boards.read().unwrap();
        let mut results = Vec::new();

        for (board_id, state) in boards.iter() {
            let board = &state.board;
            for (flat_idx, col) in board.all_columns().iter().enumerate() {
                for card in &col.cards {
                    let meta = SearchCardMeta::from_card(&card.content, card.checked);
                    let doc = SearchDocument {
                        board_title: &board.title,
                        column_title: &col.title,
                        card_content: &card.content,
                        checked: card.checked,
                        meta: &meta,
                    };
                    if engine.matches(&doc) {
                        results.push(SearchResult {
                            board_id: board_id.clone(),
                            board_title: board.title.clone(),
                            column_title: col.title.clone(),
                            column_index: flat_idx,
                            card_id: card.id.clone(),
                            card_content: card.content.clone(),
                            checked: card.checked,
                            hash_tags: meta.hash_tags.clone(),
                            temporal_tags: meta.temporal_tags.clone(),
                            due_date: meta.due_date.map(|d| d.to_string()),
                            is_overdue: meta.is_overdue,
                            row_index: None,
                            stack_index: None,
                            col_local_index: None,
                        });
                    }
                }
            }
        }

        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_storage() -> (IosStorage, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let boards_dir = dir.path().join("boards");
        let pending_path = dir.path().join("ShareExtension").join("pending.json");
        let storage = IosStorage::new(boards_dir, pending_path).unwrap();
        (storage, dir)
    }

    #[test]
    fn test_inbox_created_on_init() {
        let (storage, _dir) = temp_storage();
        let boards = storage.list_boards();
        assert_eq!(boards.len(), 1);
        // Title is set to "Inbox" on creation
        assert!(boards[0].title == "Inbox" || boards[0].title == "inbox");
    }

    #[test]
    fn test_add_card_to_inbox() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();
        storage.add_card(&inbox_id, 0, "test card").unwrap();

        let board = storage.read_board(&inbox_id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols[0].cards.len(), 1);
        assert!(cols[0].cards[0].content.contains("test card"));
    }

    #[test]
    fn test_create_board() {
        let (storage, _dir) = temp_storage();
        let id = storage.create_board("My Notes").unwrap();
        let boards = storage.list_boards();
        assert_eq!(boards.len(), 2); // inbox + new board
        let board = storage.read_board(&id).unwrap();
        assert_eq!(board.title, "My Notes");
    }

    #[test]
    fn test_search() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();
        storage.add_card(&inbox_id, 0, "hello world").unwrap();
        storage.add_card(&inbox_id, 0, "goodbye world").unwrap();

        let results = storage.search("hello");
        assert_eq!(results.len(), 1);
        assert!(results[0].card_content.contains("hello"));
    }

    #[test]
    fn test_process_pending_shares() {
        let (storage, dir) = temp_storage();

        let pending = serde_json::json!([
            {"type": "text", "text": "shared note", "timestamp": 1000.0},
            {"type": "url", "url": "https://example.com", "title": "Example", "timestamp": 1001.0}
        ]);
        fs::write(dir.path().join("ShareExtension/pending.json"), pending.to_string()).unwrap();

        let count = storage.process_pending().unwrap();
        assert_eq!(count, 2);

        let inbox_id = storage.inbox_board_id();
        let board = storage.read_board(&inbox_id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols[0].cards.len(), 2);
        assert!(cols[0].cards[0].content.contains("shared note"));
        assert!(cols[0].cards[1].content.contains("[Example](https://example.com)"));
    }

    #[test]
    fn test_board_persists_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let boards_dir = dir.path().join("boards");
        let pending_path = dir.path().join("ShareExtension/pending.json");

        // Create storage and add card
        {
            let storage = IosStorage::new(boards_dir.clone(), pending_path.clone()).unwrap();
            let inbox_id = storage.inbox_board_id();
            storage.add_card(&inbox_id, 0, "persisted card").unwrap();
        }

        // Re-create storage — should reload from disk
        {
            let storage = IosStorage::new(boards_dir, pending_path).unwrap();
            let inbox_id = storage.inbox_board_id();
            let board = storage.read_board(&inbox_id).unwrap();
            let cols = board.all_columns();
            assert_eq!(cols[0].cards.len(), 1);
            assert!(cols[0].cards[0].content.contains("persisted card"));
        }
    }
}
