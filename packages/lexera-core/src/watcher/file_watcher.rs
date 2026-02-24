/// File watcher using notify-debouncer-full.
///
/// Watches board files and include files, emits BoardChangeEvent via broadcast channel.
/// 500ms debounce window for macOS FSEvents and cloud sync stability.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use tokio::sync::broadcast;

use super::types::BoardChangeEvent;
use crate::include::resolver::IncludeMap;

const DEBOUNCE_DURATION: Duration = Duration::from_millis(500);

/// Path-to-board mapping for the watcher to resolve events.
#[derive(Debug, Default)]
struct PathMapping {
    /// main board file path -> board_id
    main_files: HashMap<PathBuf, String>,
    /// watched parent directories (to avoid duplicate watches)
    watched_dirs: std::collections::HashSet<PathBuf>,
}

/// File watcher that monitors board and include files for changes.
pub struct FileWatcher {
    _debouncer: Debouncer<notify::RecommendedWatcher, FileIdMap>,
    path_mapping: Arc<RwLock<PathMapping>>,
    event_tx: broadcast::Sender<BoardChangeEvent>,
}

impl FileWatcher {
    /// Create a new file watcher.
    /// Returns the watcher and a broadcast receiver for events.
    pub fn new(
        include_map: Arc<RwLock<IncludeMap>>,
    ) -> Result<(Self, broadcast::Receiver<BoardChangeEvent>), notify::Error> {
        let (event_tx, event_rx) = broadcast::channel(256);
        let path_mapping = Arc::new(RwLock::new(PathMapping::default()));

        let tx_clone = event_tx.clone();
        let mapping_clone = path_mapping.clone();
        let include_map_clone = include_map;

        let debouncer = new_debouncer(
            DEBOUNCE_DURATION,
            None,
            move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
                match result {
                    Ok(events) => {
                        for event in events {
                            handle_debounced_event(
                                &event,
                                &mapping_clone,
                                &include_map_clone,
                                &tx_clone,
                            );
                        }
                    }
                    Err(errors) => {
                        for e in errors {
                            log::error!("[lexera.watcher.error] Watch error: {}", e);
                        }
                    }
                }
            },
        )?;

        Ok((
            Self {
                _debouncer: debouncer,
                path_mapping,
                event_tx: event_tx.clone(),
            },
            event_rx,
        ))
    }

    /// Start watching a main board file.
    pub fn watch_board(&mut self, board_id: &str, path: &Path) -> Result<(), notify::Error> {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

        self.path_mapping
            .write()
            .unwrap()
            .main_files
            .insert(canonical.clone(), board_id.to_string());

        self.ensure_watched(&canonical)?;
        log::info!(
            "[lexera.watcher.board] Watching board {} at {:?}",
            board_id,
            canonical
        );
        Ok(())
    }

    /// Start watching an include file.
    pub fn watch_include(&mut self, path: &Path) -> Result<(), notify::Error> {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        self.ensure_watched(&canonical)?;
        log::info!(
            "[lexera.watcher.include] Watching include file {:?}",
            canonical
        );
        Ok(())
    }

    /// Stop watching a file path.
    pub fn unwatch(&mut self, path: &Path) -> Result<(), notify::Error> {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        self.path_mapping
            .write()
            .unwrap()
            .main_files
            .remove(&canonical);

        // Note: we watch parent directories, so we don't unwatch individual files
        // The debouncer will simply ignore events for paths we don't track
        Ok(())
    }

    /// Get a clone of the broadcast sender (for passing to other components).
    pub fn event_sender(&self) -> broadcast::Sender<BoardChangeEvent> {
        self.event_tx.clone()
    }

    /// Ensure the parent directory of a file is being watched.
    fn ensure_watched(&mut self, file_path: &Path) -> Result<(), notify::Error> {
        if let Some(parent) = file_path.parent() {
            let mut mapping = self.path_mapping.write().unwrap();
            if mapping.watched_dirs.contains(parent) {
                return Ok(());
            }
            mapping.watched_dirs.insert(parent.to_path_buf());
            drop(mapping);

            self._debouncer.watch(parent, RecursiveMode::NonRecursive)?;
        }
        Ok(())
    }
}

/// Handle a single debounced event.
fn handle_debounced_event(
    event: &DebouncedEvent,
    path_mapping: &Arc<RwLock<PathMapping>>,
    include_map: &Arc<RwLock<IncludeMap>>,
    tx: &broadcast::Sender<BoardChangeEvent>,
) {
    use notify::EventKind;

    for path in &event.paths {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.clone());

        // Check if this is a main board file
        let mapping = path_mapping.read().unwrap();
        if let Some(board_id) = mapping.main_files.get(&canonical) {
            let board_id = board_id.clone();
            drop(mapping);

            let change_event = match event.kind {
                EventKind::Remove(_) => BoardChangeEvent::FileDeleted {
                    board_id,
                    path: canonical,
                },
                EventKind::Create(_) => BoardChangeEvent::FileCreated {
                    board_id,
                    path: canonical,
                },
                _ => BoardChangeEvent::MainFileChanged { board_id },
            };

            if let Err(e) = tx.send(change_event) {
                log::warn!("[lexera.watcher.send] No receivers: {}", e);
            }
            continue;
        }
        drop(mapping);

        // Check if this is an include file
        let imap = include_map.read().unwrap();
        if imap.is_include_file(&canonical) {
            let board_ids = imap.get_boards_for_include(&canonical);
            drop(imap);

            if !board_ids.is_empty() {
                let change_event = BoardChangeEvent::IncludeFileChanged {
                    board_ids,
                    include_path: canonical,
                };
                if let Err(e) = tx.send(change_event) {
                    log::warn!("[lexera.watcher.send] No receivers: {}", e);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_mapping_insert_and_lookup() {
        let mut mapping = PathMapping::default();
        let path = PathBuf::from("/tmp/board.md");
        mapping.main_files.insert(path.clone(), "abc123".to_string());

        assert_eq!(mapping.main_files.get(&path), Some(&"abc123".to_string()));
    }
}
