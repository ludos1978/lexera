/// Tauri commands for the kanban viewer.

#[tauri::command]
pub fn open_in_system(path: String) -> Result<(), String> {
    opener::open(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    opener::open(&url).map_err(|e| e.to_string())
}
