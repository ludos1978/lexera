use axum::{extract::State, response::Json};
use serde::Serialize;
use std::path::Path;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskDiagnostics {
    pub log_size: u64,
    pub log_rotated_count: u64,
    pub backup_size: u64,
    pub backup_count: u64,
    pub crashsave_count: u64,
    pub crashsave_size: u64,
    pub crdt_size: u64,
    pub crdt_count: u64,
    pub board_count: u64,
    pub total_board_file_size: u64,
    // Write-loop detection counters
    pub write_count: u64,
    pub last_write_time: u64,
    pub skipped_write_count: u64,
}

pub async fn disk_diagnostics(State(state): State<AppState>) -> Json<DiskDiagnostics> {
    let board_paths = state.storage.all_board_paths();

    let mut backup_size: u64 = 0;
    let mut backup_count: u64 = 0;
    let mut crashsave_count: u64 = 0;
    let mut crashsave_size: u64 = 0;
    let mut crdt_size: u64 = 0;
    let mut crdt_count: u64 = 0;
    let mut total_board_file_size: u64 = 0;

    for (_id, board_path) in &board_paths {
        // Board file size
        if let Ok(meta) = std::fs::metadata(board_path) {
            total_board_file_size += meta.len();
        }

        // CRDT file
        let crdt_path = board_path.with_extension("md.crdt");
        if let Ok(meta) = std::fs::metadata(&crdt_path) {
            crdt_size += meta.len();
            crdt_count += 1;
        }

        let board_dir = board_path.parent().unwrap_or(Path::new("."));

        // Backup directory
        let backup_dir = board_dir.join(".lexera-backups");
        if backup_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&backup_dir) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            backup_size += meta.len();
                            backup_count += 1;
                        }
                    }
                }
            }
        }

        // Crashsave files (beside the board file, matching *-crashsave-*.md)
        if let Some(stem) = board_path.file_stem().and_then(|s| s.to_str()) {
            if let Ok(entries) = std::fs::read_dir(board_dir) {
                let crashsave_prefix = format!("{}-crashsave-", stem);
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str().map(String::from) {
                        if name.starts_with(&crashsave_prefix) && name.ends_with(".md") {
                            if let Ok(meta) = entry.metadata() {
                                if meta.is_file() {
                                    crashsave_size += meta.len();
                                    crashsave_count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Log file diagnostics
    let log_path_str = crate::log_bridge::log_file_path();
    let log_path = Path::new(&log_path_str);
    let log_size = std::fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);

    // Count rotated log files (backend.log.1, backend.log.2, ...)
    let mut log_rotated_count: u64 = 0;
    for i in 1..=10 {
        let rotated = format!("{}.{}", log_path_str, i);
        if Path::new(&rotated).exists() {
            log_rotated_count += 1;
        } else {
            break;
        }
    }

    // Write-loop counters
    let write_count = state
        .storage
        .write_counters
        .write_count
        .load(std::sync::atomic::Ordering::Relaxed);
    let last_write_time = state
        .storage
        .write_counters
        .last_write_time
        .load(std::sync::atomic::Ordering::Relaxed);
    let skipped_write_count = state
        .storage
        .write_counters
        .skipped_write_count
        .load(std::sync::atomic::Ordering::Relaxed);

    Json(DiskDiagnostics {
        log_size,
        log_rotated_count,
        backup_size,
        backup_count,
        crashsave_count,
        crashsave_size,
        crdt_size,
        crdt_count,
        board_count: board_paths.len() as u64,
        total_board_file_size,
        write_count,
        last_write_time,
        skipped_write_count,
    })
}
