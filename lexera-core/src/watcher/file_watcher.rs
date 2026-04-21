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
    /// include file paths currently being watched (canonical paths)
    watched_includes: std::collections::HashSet<PathBuf>,
    /// canonical media folder path -> board_id, used to attribute file events
    /// inside `*-Media/` to the originating board so the frontend can refresh
    /// just the affected embed.
    media_dirs: HashMap<PathBuf, String>,
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
            move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| match result {
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

        match self.path_mapping.write() {
            Ok(mut mapping) => {
                mapping
                    .main_files
                    .insert(canonical.clone(), board_id.to_string());
            }
            Err(e) => {
                log::error!("[lexera.watcher.board] Path mapping lock poisoned: {}", e);
                return Err(notify::Error::generic("Path mapping lock poisoned"));
            }
        }

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

    /// Start watching a board's media folder (`{board_dir}/{board_stem}-Media/`)
    /// non-recursively. Direct children (the user's source files like
    /// `.drawio`/`.excalidraw`/images) emit `MediaChanged` events; cache
    /// subfolders (e.g. `excalidraw-cache/`) are excluded by the
    /// non-recursive mode, so render-output writes don't cause feedback.
    /// Silently no-ops if the media folder doesn't exist yet.
    pub fn watch_board_media_dir(
        &mut self,
        board_id: &str,
        board_file_path: &Path,
    ) -> Result<(), notify::Error> {
        let parent = match board_file_path.parent() {
            Some(p) => p,
            None => return Ok(()),
        };
        let stem = match board_file_path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s,
            None => return Ok(()),
        };
        let media_dir = parent.join(format!("{}-Media", stem));
        if !media_dir.is_dir() {
            return Ok(());
        }
        let canonical = std::fs::canonicalize(&media_dir).unwrap_or(media_dir);
        match self.path_mapping.write() {
            Ok(mut mapping) => {
                if mapping.media_dirs.contains_key(&canonical) {
                    return Ok(());
                }
                mapping
                    .media_dirs
                    .insert(canonical.clone(), board_id.to_string());
                if mapping.watched_dirs.contains(&canonical) {
                    return Ok(());
                }
                mapping.watched_dirs.insert(canonical.clone());
            }
            Err(e) => {
                log::error!(
                    "[lexera.watcher.board_media] Path mapping lock poisoned: {}",
                    e
                );
                return Err(notify::Error::generic("Path mapping lock poisoned"));
            }
        }
        self._debouncer
            .watch(&canonical, RecursiveMode::NonRecursive)?;
        log::info!(
            "[lexera.watcher.board_media] Watching media dir for board {} at {:?}",
            board_id,
            canonical
        );
        Ok(())
    }

    /// Sync watched include paths with the current desired set.
    /// Only watches newly added paths; already-watched paths are skipped.
    /// Returns the number of newly watched paths.
    pub fn sync_include_paths(&mut self, desired: &[PathBuf]) -> Result<usize, notify::Error> {
        let desired_set: std::collections::HashSet<PathBuf> = desired
            .iter()
            .map(|p| std::fs::canonicalize(p).unwrap_or_else(|_| p.clone()))
            .collect();

        // Determine which paths are new (not yet watched)
        let new_paths: Vec<PathBuf> = {
            let mapping = self.path_mapping.read().map_err(|e| {
                log::error!(
                    "[lexera.watcher.sync_includes] Path mapping lock poisoned: {}",
                    e
                );
                notify::Error::generic("Path mapping lock poisoned")
            })?;
            desired_set
                .iter()
                .filter(|p| !mapping.watched_includes.contains(*p))
                .cloned()
                .collect()
        };

        let mut count = 0;
        for path in &new_paths {
            self.ensure_watched(path)?;
            count += 1;
        }

        // Update the tracked set to match the desired set
        if let Ok(mut mapping) = self.path_mapping.write() {
            mapping.watched_includes = desired_set;
        }

        Ok(count)
    }

    /// Stop watching a file path.
    pub fn unwatch(&mut self, path: &Path) -> Result<(), notify::Error> {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        match self.path_mapping.write() {
            Ok(mut mapping) => {
                mapping.main_files.remove(&canonical);
            }
            Err(e) => {
                log::error!("[lexera.watcher.unwatch] Path mapping lock poisoned: {}", e);
                return Err(notify::Error::generic("Path mapping lock poisoned"));
            }
        }

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
            let mut mapping = self.path_mapping.write().map_err(|e| {
                log::error!(
                    "[lexera.watcher.ensure_watched] Path mapping lock poisoned: {}",
                    e
                );
                notify::Error::generic("Path mapping lock poisoned")
            })?;
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
        let mapping = match path_mapping.read() {
            Ok(m) => m,
            Err(e) => {
                log::error!("[lexera.watcher.event] Path mapping lock poisoned: {}", e);
                return;
            }
        };
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
                _ => BoardChangeEvent::MainFileChanged {
                    board_id,
                    revision: None,
                    generation: None,
                    writer_id: None,
                },
            };

            if let Err(e) = tx.send(change_event) {
                log::warn!("[lexera.watcher.send] No receivers: {}", e);
            }
            continue;
        }
        drop(mapping);

        // Check if this is an include file
        let imap = match include_map.read() {
            Ok(m) => m,
            Err(e) => {
                log::error!("[lexera.watcher.event] Include map lock poisoned: {}", e);
                return;
            }
        };
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
            continue;
        }
        drop(imap);

        // Check if this file lives directly in a watched media dir.
        // Non-recursive watches mean cache subfolders (e.g. `excalidraw-cache/`)
        // never reach this branch — only direct children of `*-Media/` do —
        // so render-output writes can't trigger a feedback loop.
        let parent = match canonical.parent() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        let mapping = match path_mapping.read() {
            Ok(m) => m,
            Err(e) => {
                log::error!(
                    "[lexera.watcher.event] Path mapping lock poisoned: {}",
                    e
                );
                return;
            }
        };
        if let Some(board_id) = mapping.media_dirs.get(&parent) {
            let board_id = board_id.clone();
            drop(mapping);
            // Emit the board-relative path (`{boardStem}-Media/{filename}`)
            // so the frontend can match it against the `data-file-path`
            // attribute it stored from the original markdown reference.
            // Falling back to the canonical path if the relative form
            // can't be derived is fine — the frontend matches by exact
            // string and an absolute path simply won't match anything.
            let relative_path = parent
                .file_name()
                .and_then(|media_dir_name| {
                    canonical.file_name().map(|file_name| {
                        let mut p = PathBuf::from(media_dir_name);
                        p.push(file_name);
                        p
                    })
                })
                .unwrap_or_else(|| canonical.clone());
            let change_event = BoardChangeEvent::MediaChanged {
                board_id,
                path: Some(relative_path),
            };
            if let Err(e) = tx.send(change_event) {
                log::warn!("[lexera.watcher.send] No receivers: {}", e);
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
        mapping
            .main_files
            .insert(path.clone(), "abc123".to_string());

        assert_eq!(mapping.main_files.get(&path), Some(&"abc123".to_string()));
    }
}
