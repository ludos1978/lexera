/// iOS storage backend.
///
/// Simplified BoardStorage impl for the iOS sandbox.
/// Boards stored as encrypted .md files in the App Group container.
/// Board ID = SHA-256(filename) first 12 hex chars.
/// Files are encrypted at rest with AES-256-GCM (see encryption.rs).
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use sha2::{Digest, Sha256};

use lexera_core::capture::{format_capture_as_markdown, PendingItem};
use lexera_core::merge::card_identity;
use lexera_core::parser;
use lexera_core::search::{SearchCardMeta, SearchDocument, SearchEngine, SearchOptions};
use lexera_core::storage::{BoardStorage, StorageError};
use lexera_core::types::*;

use crate::encryption::FileEncryptor;

/// State for a single tracked board.
struct BoardState {
    filename: String,
    board: KanbanBoard,
    content_hash: String,
}

const MAX_BASE64_IMAGE_SIZE: usize = 10 * 1024 * 1024; // 10 MB (~7.5 MB raw)

/// Number of SHA-256 bytes used for board ID (6 bytes = 12 hex chars).
const BOARD_ID_HASH_BYTES: usize = 6;

pub struct IosStorage {
    boards_dir: PathBuf,
    pending_path: PathBuf,
    encryptor: FileEncryptor,
    boards: RwLock<HashMap<String, BoardState>>,
}

fn board_id_from_filename(filename: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(filename.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..BOARD_ID_HASH_BYTES])
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

        let encryptor = FileEncryptor::new(&boards_dir)?;

        let storage = Self {
            boards_dir,
            pending_path,
            encryptor,
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
            Err(e) => {
                log::error!(
                    "[ios_storage.scan_boards] Failed to read boards directory: {}",
                    e
                );
                return;
            }
        };

        let mut boards = self.boards.write().unwrap_or_else(|p| {
            log::warn!("[ios_storage.scan_boards] Lock was poisoned, recovering");
            p.into_inner()
        });
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let filename = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let content = match self.encryptor.read_and_migrate(&path) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!(
                        "[ios_storage.scan_boards] Failed to read '{}': {}",
                        filename,
                        e
                    );
                    continue;
                }
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
        let boards = self.boards.read().unwrap_or_else(|p| {
            log::warn!("[ios_storage.ensure_inbox] Lock was poisoned, recovering");
            p.into_inner()
        });
        if boards.contains_key(&inbox_id) {
            return;
        }
        drop(boards);

        let content = "---\nkanban-plugin: board\n---\n\n## Captured\n\n## Tagged\n\n## Archived\n";
        let path = self.boards_dir.join("inbox.md");
        if let Err(e) = self.encryptor.write_encrypted(&path, content) {
            log::error!("[ios_storage] Failed to create inbox board: {}", e);
            return;
        }

        let mut board = parser::parse_markdown(content);
        board.title = "Inbox".to_string();
        let mut boards = self.boards.write().unwrap_or_else(|p| {
            log::warn!("[ios_storage.ensure_inbox] Lock was poisoned, recovering");
            p.into_inner()
        });
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

        let boards = self.boards.read().unwrap_or_else(|p| {
            log::warn!("[ios_storage.create_board] Lock was poisoned, recovering");
            p.into_inner()
        });
        if boards.contains_key(&board_id) {
            return Ok(board_id);
        }
        drop(boards);

        let content = "---\nkanban-plugin: board\n---\n\n## Inbox\n\n## Done\n".to_string();
        let path = self.boards_dir.join(&filename);
        self.encryptor.write_encrypted(&path, &content)?;

        let mut board = parser::parse_markdown(&content);
        board.title = title.to_string();
        let mut boards = self.boards.write().unwrap_or_else(|p| {
            log::warn!("[ios_storage.create_board] Lock was poisoned, recovering");
            p.into_inner()
        });
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

    pub fn delete_board(&self, board_id: &str) -> Result<(), StorageError> {
        let inbox_id = self.inbox_board_id();
        if board_id == inbox_id {
            return Err(StorageError::InvalidBoard(
                "Cannot delete the Inbox board".to_string(),
            ));
        }

        let mut boards = self.boards.write().unwrap_or_else(|p| {
            log::warn!("[ios_storage.delete_board] Lock was poisoned, recovering");
            p.into_inner()
        });
        let state = boards
            .remove(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        let path = self.boards_dir.join(&state.filename);
        if path.exists() {
            fs::remove_file(&path)?;
        }

        Ok(())
    }

    pub fn edit_card(
        &self,
        board_id: &str,
        column_index: usize,
        card_index: usize,
        new_content: &str,
    ) -> Result<(), StorageError> {
        {
            let mut boards = self.boards.write().unwrap_or_else(|p| {
                log::warn!("[ios_storage.edit_card] Lock was poisoned, recovering");
                p.into_inner()
            });
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

            let mut columns = state.board.all_columns_mut();
            if column_index >= columns.len() {
                return Err(StorageError::ColumnOutOfRange {
                    index: column_index,
                    max: columns.len().saturating_sub(1),
                });
            }

            if card_index >= columns[column_index].cards.len() {
                return Err(StorageError::InvalidBoard(format!(
                    "Card index {} out of range (0-{})",
                    card_index,
                    columns[column_index].cards.len().saturating_sub(1)
                )));
            }

            columns[column_index].cards[card_index].content = new_content.to_string();
        }
        self.write_board_file(board_id)
    }

    pub fn delete_card(
        &self,
        board_id: &str,
        column_index: usize,
        card_index: usize,
    ) -> Result<(), StorageError> {
        {
            let mut boards = self.boards.write().unwrap_or_else(|p| {
                log::warn!("[ios_storage.delete_card] Lock was poisoned, recovering");
                p.into_inner()
            });
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

            let mut columns = state.board.all_columns_mut();
            if column_index >= columns.len() {
                return Err(StorageError::ColumnOutOfRange {
                    index: column_index,
                    max: columns.len().saturating_sub(1),
                });
            }

            if card_index >= columns[column_index].cards.len() {
                return Err(StorageError::InvalidBoard(format!(
                    "Card index {} out of range (0-{})",
                    card_index,
                    columns[column_index].cards.len().saturating_sub(1)
                )));
            }

            columns[column_index].cards.remove(card_index);
        }
        self.write_board_file(board_id)
    }

    pub fn process_pending(&self) -> Result<usize, StorageError> {
        if !self.pending_path.exists() {
            return Ok(0);
        }

        let content = fs::read_to_string(&self.pending_path)?;
        let items: Vec<PendingItem> = match serde_json::from_str(&content) {
            Ok(items) => items,
            Err(e) => {
                log::warn!(
                    "[ios_storage.process_pending] Failed to parse pending.json: {}",
                    e
                );
                return Ok(0);
            }
        };

        if items.is_empty() {
            return Ok(0);
        }

        let inbox_id = self.inbox_board_id();
        let mut processed = 0usize;

        for item in &items {
            if let PendingItem::Image { data, filename, .. } = item {
                if data.len() > MAX_BASE64_IMAGE_SIZE {
                    log::warn!(
                        "[ios_storage.process_pending] Rejecting oversized image '{}': {} bytes base64 exceeds {} byte limit",
                        filename,
                        data.len(),
                        MAX_BASE64_IMAGE_SIZE
                    );
                    continue;
                }
            }
            let card_content = format_capture_as_markdown(item);
            self.add_card(&inbox_id, 0, &card_content)?;
            processed += 1;
        }

        // Clear the queue
        fs::write(&self.pending_path, "[]")?;
        Ok(processed)
    }

    /// Write a board back to disk atomically, encrypted (.tmp + rename).
    fn write_board_file(&self, board_id: &str) -> Result<(), StorageError> {
        let mut boards = self.boards.write().unwrap_or_else(|p| {
            log::warn!("[ios_storage.write_board_file] Lock was poisoned, recovering");
            p.into_inner()
        });
        let state = boards
            .get(board_id)
            .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

        let content = parser::generate_markdown(&state.board);
        let path = self.boards_dir.join(&state.filename);
        self.encryptor.write_encrypted(&path, &content)?;

        // Update hash while still holding the write lock
        if let Some(state) = boards.get_mut(board_id) {
            state.content_hash = content_hash(&content);
        }

        Ok(())
    }
}

impl BoardStorage for IosStorage {
    fn list_boards(&self) -> Vec<BoardInfo> {
        let boards = self.boards.read().unwrap_or_else(|p| {
            log::warn!("[ios_storage.list_boards] Lock was poisoned, recovering");
            p.into_inner()
        });
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
                    board_settings: state.board.board_settings.clone(),
                }
            })
            .collect()
    }

    fn read_board(&self, board_id: &str) -> Option<KanbanBoard> {
        let boards = self.boards.read().unwrap_or_else(|p| {
            log::warn!("[ios_storage.read_board] Lock was poisoned, recovering");
            p.into_inner()
        });
        boards.get(board_id).map(|s| s.board.clone())
    }

    fn write_board(
        &self,
        board_id: &str,
        board: &KanbanBoard,
    ) -> Result<lexera_core::storage::WriteResult, StorageError> {
        {
            let mut boards = self.boards.write().unwrap_or_else(|p| {
                log::warn!("[ios_storage.write_board] Lock was poisoned, recovering");
                p.into_inner()
            });
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;
            state.board = board.clone();
        }
        self.write_board_file(board_id)?;
        Ok(lexera_core::storage::WriteResult {
            merge_result: None,
            redirected_path: None,
        })
    }

    fn add_card(
        &self,
        board_id: &str,
        col_index: usize,
        content: &str,
    ) -> Result<(), StorageError> {
        {
            let mut boards = self.boards.write().unwrap_or_else(|p| {
                log::warn!("[ios_storage.add_card] Lock was poisoned, recovering");
                p.into_inner()
            });
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
                params: std::collections::HashMap::new(),
            };
            columns[col_index].cards.push(card);
        }
        self.write_board_file(board_id)
    }

    fn append_to_card(
        &self,
        board_id: &str,
        card_id: &str,
        content: &str,
    ) -> Result<(), StorageError> {
        {
            let mut boards = self.boards.write().unwrap_or_else(|p| {
                log::warn!("[ios_storage.append_to_card] Lock was poisoned, recovering");
                p.into_inner()
            });
            let state = boards
                .get_mut(board_id)
                .ok_or_else(|| StorageError::BoardNotFound(board_id.to_string()))?;

            let mut found = false;
            for col in state.board.all_columns_mut() {
                for card in col.cards.iter_mut() {
                    if card.id == card_id {
                        card.content = format!("{}\n{}", card.content, content);
                        found = true;
                        break;
                    }
                }
                if found {
                    break;
                }
            }
            if !found {
                return Err(StorageError::CardNotFound(card_id.to_string()));
            }
        }
        self.write_board_file(board_id)
    }

    fn search(&self, query: &str) -> Vec<SearchResult> {
        self.search_with_options(query, SearchOptions::default())
    }

    fn search_with_options(&self, query: &str, options: SearchOptions) -> Vec<SearchResult> {
        let engine = SearchEngine::compile(query, options);

        let boards = self.boards.read().unwrap_or_else(|p| {
            log::warn!("[ios_storage.search_with_options] Lock was poisoned, recovering");
            p.into_inner()
        });
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
                            links: meta.links.clone(),
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
        fs::write(
            dir.path().join("ShareExtension/pending.json"),
            pending.to_string(),
        )
        .unwrap();

        let count = storage.process_pending().unwrap();
        assert_eq!(count, 2);

        let inbox_id = storage.inbox_board_id();
        let board = storage.read_board(&inbox_id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols[0].cards.len(), 2);
        assert!(cols[0].cards[0].content.contains("shared note"));
        assert!(cols[0].cards[1]
            .content
            .contains("[Example](https://example.com)"));
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

    // ---------------------------------------------------------------
    // delete_board
    // ---------------------------------------------------------------

    #[test]
    fn test_delete_board() {
        let (storage, _dir) = temp_storage();
        let id = storage.create_board("Temp Board").unwrap();
        assert_eq!(storage.list_boards().len(), 2); // inbox + Temp Board

        storage.delete_board(&id).unwrap();
        assert_eq!(storage.list_boards().len(), 1); // only inbox remains
        assert!(storage.read_board(&id).is_none());
    }

    #[test]
    fn test_delete_board_removes_file_from_disk() {
        let (storage, dir) = temp_storage();
        let id = storage.create_board("Ephemeral").unwrap();
        let file_path = dir.path().join("boards").join("Ephemeral.md");
        assert!(file_path.exists());

        storage.delete_board(&id).unwrap();
        assert!(!file_path.exists());
    }

    #[test]
    fn test_delete_inbox_board_is_rejected() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();

        let result = storage.delete_board(&inbox_id);
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::InvalidBoard(msg) => {
                assert!(
                    msg.contains("Inbox"),
                    "Expected message about Inbox, got: {}",
                    msg
                );
            }
            other => panic!("Expected InvalidBoard error, got: {:?}", other),
        }

        // Inbox must still exist
        assert!(storage.read_board(&inbox_id).is_some());
    }

    #[test]
    fn test_delete_nonexistent_board() {
        let (storage, _dir) = temp_storage();

        let result = storage.delete_board("does_not_exist");
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::BoardNotFound(_) => {}
            other => panic!("Expected BoardNotFound error, got: {:?}", other),
        }
    }

    // ---------------------------------------------------------------
    // edit_card
    // ---------------------------------------------------------------

    #[test]
    fn test_edit_card() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();
        storage.add_card(&inbox_id, 0, "original content").unwrap();

        storage
            .edit_card(&inbox_id, 0, 0, "updated content")
            .unwrap();

        let board = storage.read_board(&inbox_id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols[0].cards.len(), 1);
        assert_eq!(cols[0].cards[0].content, "updated content");
    }

    #[test]
    fn test_edit_card_persists_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let boards_dir = dir.path().join("boards");
        let pending_path = dir.path().join("ShareExtension/pending.json");

        {
            let storage = IosStorage::new(boards_dir.clone(), pending_path.clone()).unwrap();
            let inbox_id = storage.inbox_board_id();
            storage.add_card(&inbox_id, 0, "before edit").unwrap();
            storage.edit_card(&inbox_id, 0, 0, "after edit").unwrap();
        }

        // Reload from disk
        {
            let storage = IosStorage::new(boards_dir, pending_path).unwrap();
            let inbox_id = storage.inbox_board_id();
            let board = storage.read_board(&inbox_id).unwrap();
            let cols = board.all_columns();
            assert_eq!(cols[0].cards[0].content, "after edit");
        }
    }

    #[test]
    fn test_edit_card_nonexistent_board() {
        let (storage, _dir) = temp_storage();

        let result = storage.edit_card("no_such_board", 0, 0, "text");
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::BoardNotFound(_) => {}
            other => panic!("Expected BoardNotFound error, got: {:?}", other),
        }
    }

    #[test]
    fn test_edit_card_column_out_of_range() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();
        storage.add_card(&inbox_id, 0, "a card").unwrap();

        let result = storage.edit_card(&inbox_id, 99, 0, "text");
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::ColumnOutOfRange { index, .. } => {
                assert_eq!(index, 99);
            }
            other => panic!("Expected ColumnOutOfRange error, got: {:?}", other),
        }
    }

    #[test]
    fn test_edit_card_card_index_out_of_range() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();
        // Column 0 exists but has no cards
        let result = storage.edit_card(&inbox_id, 0, 5, "text");
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::InvalidBoard(msg) => {
                assert!(
                    msg.contains("Card index"),
                    "Expected card-index message, got: {}",
                    msg
                );
            }
            other => panic!("Expected InvalidBoard (card index) error, got: {:?}", other),
        }
    }

    // ---------------------------------------------------------------
    // delete_card
    // ---------------------------------------------------------------

    #[test]
    fn test_delete_card() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();
        storage.add_card(&inbox_id, 0, "card A").unwrap();
        storage.add_card(&inbox_id, 0, "card B").unwrap();

        let board = storage.read_board(&inbox_id).unwrap();
        assert_eq!(board.all_columns()[0].cards.len(), 2);

        // Delete first card ("card A")
        storage.delete_card(&inbox_id, 0, 0).unwrap();

        let board = storage.read_board(&inbox_id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols[0].cards.len(), 1);
        assert!(cols[0].cards[0].content.contains("card B"));
    }

    #[test]
    fn test_delete_card_persists_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let boards_dir = dir.path().join("boards");
        let pending_path = dir.path().join("ShareExtension/pending.json");

        {
            let storage = IosStorage::new(boards_dir.clone(), pending_path.clone()).unwrap();
            let inbox_id = storage.inbox_board_id();
            storage.add_card(&inbox_id, 0, "will be deleted").unwrap();
            storage.add_card(&inbox_id, 0, "will remain").unwrap();
            storage.delete_card(&inbox_id, 0, 0).unwrap();
        }

        {
            let storage = IosStorage::new(boards_dir, pending_path).unwrap();
            let inbox_id = storage.inbox_board_id();
            let board = storage.read_board(&inbox_id).unwrap();
            let cols = board.all_columns();
            assert_eq!(cols[0].cards.len(), 1);
            assert!(cols[0].cards[0].content.contains("will remain"));
        }
    }

    #[test]
    fn test_delete_card_nonexistent_board() {
        let (storage, _dir) = temp_storage();

        let result = storage.delete_card("no_such_board", 0, 0);
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::BoardNotFound(_) => {}
            other => panic!("Expected BoardNotFound error, got: {:?}", other),
        }
    }

    #[test]
    fn test_delete_card_column_out_of_range() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();

        let result = storage.delete_card(&inbox_id, 99, 0);
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::ColumnOutOfRange { index, .. } => {
                assert_eq!(index, 99);
            }
            other => panic!("Expected ColumnOutOfRange error, got: {:?}", other),
        }
    }

    #[test]
    fn test_delete_card_card_index_out_of_range() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();

        let result = storage.delete_card(&inbox_id, 0, 10);
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::InvalidBoard(msg) => {
                assert!(
                    msg.contains("Card index"),
                    "Expected card-index message, got: {}",
                    msg
                );
            }
            other => panic!("Expected InvalidBoard (card index) error, got: {:?}", other),
        }
    }

    // ---------------------------------------------------------------
    // get_board (read_board)
    // ---------------------------------------------------------------

    #[test]
    fn test_get_board_returns_inbox() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();

        let board = storage.read_board(&inbox_id);
        assert!(board.is_some());
        let board = board.unwrap();
        assert!(board.title == "Inbox" || board.title == "inbox");
        // Inbox board has 3 columns: Captured, Tagged, Archived
        assert_eq!(board.all_columns().len(), 3);
    }

    #[test]
    fn test_get_board_returns_created_board() {
        let (storage, _dir) = temp_storage();
        let id = storage.create_board("Shopping List").unwrap();

        let board = storage.read_board(&id);
        assert!(board.is_some());
        let board = board.unwrap();
        assert_eq!(board.title, "Shopping List");
        // Default created board has 2 columns: Inbox, Done
        assert_eq!(board.all_columns().len(), 2);
    }

    #[test]
    fn test_get_board_nonexistent_returns_none() {
        let (storage, _dir) = temp_storage();

        let board = storage.read_board("does_not_exist");
        assert!(board.is_none());
    }

    #[test]
    fn test_get_board_after_adding_cards() {
        let (storage, _dir) = temp_storage();
        let id = storage.create_board("Work").unwrap();
        storage.add_card(&id, 0, "task 1").unwrap();
        storage.add_card(&id, 0, "task 2").unwrap();
        storage.add_card(&id, 1, "done task").unwrap();

        let board = storage.read_board(&id).unwrap();
        let cols = board.all_columns();
        assert_eq!(cols[0].cards.len(), 2);
        assert_eq!(cols[1].cards.len(), 1);
        assert!(cols[0].cards[0].content.contains("task 1"));
        assert!(cols[0].cards[1].content.contains("task 2"));
        assert!(cols[1].cards[0].content.contains("done task"));
    }

    // ---------------------------------------------------------------
    // Edge cases
    // ---------------------------------------------------------------

    #[test]
    fn test_add_card_to_nonexistent_board() {
        let (storage, _dir) = temp_storage();

        let result = storage.add_card("no_such_board", 0, "orphan card");
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::BoardNotFound(_) => {}
            other => panic!("Expected BoardNotFound error, got: {:?}", other),
        }
    }

    #[test]
    fn test_add_card_to_invalid_column_index() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();

        let result = storage.add_card(&inbox_id, 99, "card");
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::ColumnOutOfRange { index, .. } => {
                assert_eq!(index, 99);
            }
            other => panic!("Expected ColumnOutOfRange error, got: {:?}", other),
        }
    }

    #[test]
    fn test_create_board_duplicate_name_returns_same_id() {
        let (storage, _dir) = temp_storage();
        let id1 = storage.create_board("Duplicate").unwrap();
        let id2 = storage.create_board("Duplicate").unwrap();

        // create_board returns the existing board_id when a duplicate name is used
        assert_eq!(id1, id2);
        // Still only 2 boards total (inbox + Duplicate)
        assert_eq!(storage.list_boards().len(), 2);
    }

    #[test]
    fn test_create_board_special_characters_in_name() {
        let (storage, _dir) = temp_storage();
        let id = storage.create_board("My Board! @#$%").unwrap();

        let board = storage.read_board(&id).unwrap();
        assert_eq!(board.title, "My Board! @#$%");
        // Special characters (except space, hyphen, alphanumeric) become underscores in filename
        assert_eq!(storage.list_boards().len(), 2);
    }

    // ---------------------------------------------------------------
    // Encryption at rest
    // ---------------------------------------------------------------

    #[test]
    fn test_encrypted_write_read_roundtrip() {
        let (storage, _dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();
        storage
            .add_card(&inbox_id, 0, "encrypted roundtrip card")
            .unwrap();

        // Read it back from the in-memory cache
        let board = storage.read_board(&inbox_id).unwrap();
        let cols = board.all_columns();
        assert!(cols[0].cards[0]
            .content
            .contains("encrypted roundtrip card"));
    }

    #[test]
    fn test_encrypted_file_on_disk_is_not_plaintext() {
        let (storage, dir) = temp_storage();
        let inbox_id = storage.inbox_board_id();
        storage
            .add_card(&inbox_id, 0, "super secret content")
            .unwrap();

        // Read the raw bytes of the inbox file on disk
        let raw = fs::read(dir.path().join("boards").join("inbox.md")).unwrap();

        // The file should start with the encryption magic header
        assert_eq!(
            &raw[..4],
            b"LEXE",
            "File on disk should start with encryption magic header"
        );

        // The raw bytes should not contain any plaintext board content
        let raw_str = String::from_utf8_lossy(&raw);
        assert!(
            !raw_str.contains("super secret content"),
            "Encrypted file should not contain plaintext card content"
        );
        assert!(
            !raw_str.contains("kanban-plugin"),
            "Encrypted file should not contain plaintext frontmatter"
        );
    }

    #[test]
    fn test_encrypted_board_persists_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let boards_dir = dir.path().join("boards");
        let pending_path = dir.path().join("ShareExtension/pending.json");

        // First session: create storage and add card
        {
            let storage = IosStorage::new(boards_dir.clone(), pending_path.clone()).unwrap();
            let inbox_id = storage.inbox_board_id();
            storage
                .add_card(&inbox_id, 0, "encrypted persisted card")
                .unwrap();
        }

        // Verify file on disk is encrypted
        let raw = fs::read(boards_dir.join("inbox.md")).unwrap();
        assert_eq!(&raw[..4], b"LEXE", "File should be encrypted on disk");

        // Second session: reload from encrypted disk
        {
            let storage = IosStorage::new(boards_dir, pending_path).unwrap();
            let inbox_id = storage.inbox_board_id();
            let board = storage.read_board(&inbox_id).unwrap();
            let cols = board.all_columns();
            assert_eq!(cols[0].cards.len(), 1);
            assert!(cols[0].cards[0]
                .content
                .contains("encrypted persisted card"));
        }
    }

    #[test]
    fn test_legacy_unencrypted_files_migrated_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let boards_dir = dir.path().join("boards");
        let pending_path = dir.path().join("ShareExtension/pending.json");
        fs::create_dir_all(&boards_dir).unwrap();

        // Write a legacy unencrypted board file using the same format that
        // IosStorage produces (frontmatter + columns, no cards yet).
        let legacy_content =
            "---\nkanban-plugin: board\n---\n\n## Captured\n\n## Tagged\n\n## Archived\n";
        fs::write(boards_dir.join("inbox.md"), legacy_content).unwrap();

        // Verify the file is plaintext before loading
        let raw_before = fs::read(boards_dir.join("inbox.md")).unwrap();
        assert!(
            !crate::encryption::FileEncryptor::is_encrypted(&raw_before),
            "File should be unencrypted before migration"
        );
        assert!(
            String::from_utf8_lossy(&raw_before).contains("kanban-plugin"),
            "File should contain plaintext frontmatter"
        );

        // Load storage: should detect unencrypted file, parse it, and migrate it
        let storage = IosStorage::new(boards_dir.clone(), pending_path).unwrap();
        let inbox_id = storage.inbox_board_id();
        let board = storage.read_board(&inbox_id).unwrap();
        // Board should have 3 columns from the legacy content
        assert_eq!(board.all_columns().len(), 3);

        // Verify the file on disk was migrated to encrypted format
        let raw = fs::read(boards_dir.join("inbox.md")).unwrap();
        assert_eq!(
            &raw[..4],
            b"LEXE",
            "Legacy file should be migrated to encrypted format"
        );
        assert!(
            !String::from_utf8_lossy(&raw).contains("kanban-plugin"),
            "Migrated file should not contain plaintext"
        );

        // Adding a card should still work after migration
        storage
            .add_card(&inbox_id, 0, "post-migration card")
            .unwrap();
        let board = storage.read_board(&inbox_id).unwrap();
        assert!(board.all_columns()[0].cards[0]
            .content
            .contains("post-migration card"));
    }

    #[test]
    fn test_key_file_created_in_boards_dir() {
        let (_storage, dir) = temp_storage();
        let key_path = dir.path().join("boards").join(".lexera.key");
        assert!(key_path.exists(), "Encryption key file should be created");
        let key_data = fs::read(&key_path).unwrap();
        assert_eq!(key_data.len(), 32, "Key should be 256 bits (32 bytes)");
    }
}
