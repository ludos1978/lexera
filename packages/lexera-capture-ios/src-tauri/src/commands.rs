use std::sync::Arc;

use lexera_core::capture::format_capture_as_markdown;
use lexera_core::search::SearchOptions;
use lexera_core::storage::BoardStorage;
use lexera_core::types::{BoardInfo, KanbanBoard, SearchResult};

use crate::ios_storage::IosStorage;

#[tauri::command]
pub fn capture_text(
    storage: tauri::State<'_, Arc<IosStorage>>,
    content: String,
    board_id: Option<String>,
    col_index: Option<usize>,
) -> Result<(), String> {
    let bid = board_id.unwrap_or_else(|| storage.inbox_board_id());
    let col = col_index.unwrap_or(0);
    storage
        .add_card(&bid, col, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn capture_url(
    storage: tauri::State<'_, Arc<IosStorage>>,
    url: String,
    title: Option<String>,
    board_id: Option<String>,
) -> Result<(), String> {
    let item = lexera_core::capture::PendingItem::Url {
        url,
        title,
        timestamp: lexera_core::capture::timestamp_millis() as f64,
    };
    let content = format_capture_as_markdown(&item);
    let bid = board_id.unwrap_or_else(|| storage.inbox_board_id());
    storage
        .add_card(&bid, 0, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_boards(storage: tauri::State<'_, Arc<IosStorage>>) -> Vec<BoardInfo> {
    storage.list_boards()
}

#[tauri::command]
pub fn get_board(
    storage: tauri::State<'_, Arc<IosStorage>>,
    board_id: String,
) -> Option<KanbanBoard> {
    storage.read_board(&board_id)
}

#[tauri::command]
pub fn create_board(
    storage: tauri::State<'_, Arc<IosStorage>>,
    title: String,
) -> Result<String, String> {
    storage.create_board(&title).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search(
    storage: tauri::State<'_, Arc<IosStorage>>,
    query: String,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
) -> Vec<SearchResult> {
    let options = SearchOptions {
        case_sensitive: case_sensitive.unwrap_or(false),
        use_regex: use_regex.unwrap_or(false),
    };
    storage.search_with_options(&query, options)
}

#[tauri::command]
pub fn process_pending_shares(
    storage: tauri::State<'_, Arc<IosStorage>>,
) -> Result<usize, String> {
    storage.process_pending().map_err(|e| e.to_string())
}
