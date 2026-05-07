//! Workspace + board normalization rules.
//!
//! Splits the workspace-management surface out of `config.rs` so the
//! invariant logic (canonicalize / dedup boards, ensure default
//! workspace, clean up stale workspace ids) lives next to the unit
//! tests that exercise it. External callers reach this through
//! `crate::config::*` via re-exports in `config.rs`.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

use super::{save_config, BoardEntry, SyncConfig, WorkspaceEntry};

fn canonicalize_board_file(file: &str) -> String {
    let path = PathBuf::from(file);
    fs::canonicalize(&path)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn canonicalize_and_deduplicate_board_entries(config: &mut SyncConfig) -> bool {
    let mut changed = false;

    let original_len = config.boards.len();
    let mut deduped: Vec<BoardEntry> = Vec::with_capacity(original_len);

    for mut entry in std::mem::take(&mut config.boards) {
        let canonical = canonicalize_board_file(&entry.file);
        if entry.file != canonical {
            entry.file = canonical.clone();
            changed = true;
        }

        if let Some(existing) = deduped.iter_mut().find(|b| b.file == canonical) {
            // Merge duplicate entries for the same board file.
            changed = true;
            if existing.name.is_none() && entry.name.is_some() {
                existing.name = entry.name.take();
            }
            for ws_id in entry.workspace_ids {
                if !existing.workspace_ids.contains(&ws_id) {
                    existing.workspace_ids.push(ws_id);
                }
            }
            continue;
        }

        deduped.push(entry);
    }

    if deduped.len() != original_len {
        changed = true;
    }
    config.boards = deduped;
    changed
}

/// Normalize workspace+board configuration so it remains usable:
/// - all board file paths are canonicalized and duplicate board entries are merged
/// - at least one workspace exists
/// - default workspace always points to an existing workspace
/// - every board belongs to at least one existing workspace
pub fn normalize_workspace_setup(config: &mut SyncConfig) -> bool {
    let mut changed = canonicalize_and_deduplicate_board_entries(config);

    // Remove duplicate/invalid workspace IDs.
    let mut seen_workspace_ids: HashSet<String> = HashSet::new();
    config.workspaces.retain(|ws| {
        let id = ws.id.trim();
        let keep = !id.is_empty() && seen_workspace_ids.insert(id.to_string());
        if !keep {
            changed = true;
        }
        keep
    });

    // Create "Default" workspace if no workspaces exist.
    if config.workspaces.is_empty() {
        let id = Uuid::new_v4().to_string();
        config.workspaces.push(WorkspaceEntry {
            id: id.clone(),
            name: "Default".to_string(),
            ..WorkspaceEntry::default()
        });
        config.default_workspace = Some(id);
        changed = true;
        log::info!("[config] Created default workspace");
    }

    // Ensure default_workspace points to an existing workspace.
    let default_is_valid = config
        .default_workspace
        .as_ref()
        .map(|id| config.workspaces.iter().any(|w| w.id == *id))
        .unwrap_or(false);
    if !default_is_valid {
        config.default_workspace = config.workspaces.first().map(|w| w.id.clone());
        changed = true;
    }

    let valid_workspace_ids: HashSet<String> =
        config.workspaces.iter().map(|w| w.id.clone()).collect();
    let fallback_ws_id = config
        .default_workspace
        .clone()
        .or_else(|| config.workspaces.first().map(|w| w.id.clone()));

    // Clean each board's workspace_ids and ensure at least one assignment.
    for board in &mut config.boards {
        let before = board.workspace_ids.clone();
        let mut cleaned: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for ws_id in &before {
            if valid_workspace_ids.contains(ws_id) && seen.insert(ws_id.clone()) {
                cleaned.push(ws_id.clone());
            }
        }
        if cleaned.is_empty() {
            if let Some(ref fallback) = fallback_ws_id {
                cleaned.push(fallback.clone());
            }
        }
        if cleaned != before {
            board.workspace_ids = cleaned;
            changed = true;
        }
    }

    changed
}

/// Ensure a "Default" workspace exists and all boards belong to at least one workspace.
/// Boards with no workspace assignment are placed into the default workspace.
pub fn ensure_default_workspace(config: &mut SyncConfig, config_path: &PathBuf) {
    let changed = normalize_workspace_setup(config);

    if changed {
        if let Err(e) = save_config(config_path, config) {
            log::error!("Failed to save config after workspace migration: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_workspace_setup_creates_default_and_assigns_board() {
        let mut cfg = SyncConfig {
            boards: vec![BoardEntry {
                file: "board.md".to_string(),
                name: None,
                workspace_ids: Vec::new(),
                ..BoardEntry::default()
            }],
            ..SyncConfig::default()
        };

        let changed = normalize_workspace_setup(&mut cfg);
        assert!(changed);
        assert_eq!(cfg.workspaces.len(), 1);
        let default_ws = cfg.default_workspace.clone().unwrap();
        assert_eq!(cfg.boards[0].workspace_ids, vec![default_ws]);
    }

    #[test]
    fn normalize_workspace_setup_removes_invalid_workspace_refs() {
        let ws_id = "ws-1".to_string();
        let mut cfg = SyncConfig {
            workspaces: vec![WorkspaceEntry {
                id: ws_id.clone(),
                name: "Main".to_string(),
                ..WorkspaceEntry::default()
            }],
            default_workspace: None,
            boards: vec![BoardEntry {
                file: "board.md".to_string(),
                name: None,
                workspace_ids: vec!["missing".to_string(), ws_id.clone(), ws_id.clone()],
                ..BoardEntry::default()
            }],
            ..SyncConfig::default()
        };

        let changed = normalize_workspace_setup(&mut cfg);
        assert!(changed);
        assert_eq!(cfg.default_workspace, Some(ws_id.clone()));
        assert_eq!(cfg.boards[0].workspace_ids, vec![ws_id]);
    }

    #[test]
    fn normalize_workspace_setup_canonicalizes_and_deduplicates_boards() {
        let dir = tempfile::tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        fs::write(&board_path, "---\nkanban-plugin: board\n---\n").unwrap();

        let canonical = fs::canonicalize(&board_path).unwrap();
        let non_canonical = dir.path().join(".").join("board.md");

        let ws_a = "ws-a".to_string();
        let ws_b = "ws-b".to_string();
        let mut cfg = SyncConfig {
            workspaces: vec![
                WorkspaceEntry {
                    id: ws_a.clone(),
                    name: "A".to_string(),
                    ..WorkspaceEntry::default()
                },
                WorkspaceEntry {
                    id: ws_b.clone(),
                    name: "B".to_string(),
                    ..WorkspaceEntry::default()
                },
            ],
            default_workspace: Some(ws_a.clone()),
            boards: vec![
                BoardEntry {
                    file: non_canonical.to_string_lossy().to_string(),
                    name: None,
                    workspace_ids: vec![ws_a.clone()],
                    ..BoardEntry::default()
                },
                BoardEntry {
                    file: canonical.to_string_lossy().to_string(),
                    name: Some("Board".to_string()),
                    workspace_ids: vec![ws_b.clone()],
                    ..BoardEntry::default()
                },
            ],
            ..SyncConfig::default()
        };

        let changed = normalize_workspace_setup(&mut cfg);
        assert!(changed);
        assert_eq!(cfg.boards.len(), 1);
        assert_eq!(cfg.boards[0].file, canonical.to_string_lossy().to_string());
        assert!(cfg.boards[0].workspace_ids.contains(&ws_a));
        assert!(cfg.boards[0].workspace_ids.contains(&ws_b));
    }
}
