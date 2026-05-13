//! Low-level persistence primitives shared by storage implementations.
//!
//! This module intentionally knows nothing about kanban board semantics. It is
//! the boundary for durable text-file writes used by board markdown, includes,
//! crashsaves, and future storage backends.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

#[derive(Debug, Clone, Copy)]
pub struct AtomicWriteOptions {
    pub tmp_extension: &'static str,
    pub protect_non_empty_from_empty: bool,
    pub log_target: &'static str,
}

impl AtomicWriteOptions {
    pub const fn board_markdown() -> Self {
        Self {
            tmp_extension: "lexera-sync.tmp",
            protect_non_empty_from_empty: true,
            log_target: "lexera.storage.atomic_write",
        }
    }

    pub const fn crashsave() -> Self {
        Self {
            tmp_extension: "lexera-crashsave.tmp",
            protect_non_empty_from_empty: false,
            log_target: "lexera.backup.atomic_write",
        }
    }

    pub const fn crdt_snapshot() -> Self {
        Self {
            tmp_extension: "lexera-crdt.tmp",
            protect_non_empty_from_empty: false,
            log_target: "lexera.crdt.atomic_write",
        }
    }
}

/// Atomically write text content: temp file -> fsync temp -> rename -> fsync dir.
///
/// Parent directories are not created here. Callers decide whether missing
/// parents should be created or treated as a failed write.
pub fn atomic_write_text(
    path: &Path,
    content: &str,
    options: AtomicWriteOptions,
) -> Result<(), io::Error> {
    if options.protect_non_empty_from_empty && content.trim().is_empty() {
        if let Ok(existing) = fs::read_to_string(path) {
            if !existing.trim().is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Refusing to overwrite non-empty file with empty content",
                ));
            }
        }
    }

    atomic_write_bytes(path, content.as_bytes(), options)
}

/// Atomically write bytes: temp file -> fsync temp -> rename -> fsync dir.
pub fn atomic_write_bytes(
    path: &Path,
    content: &[u8],
    options: AtomicWriteOptions,
) -> Result<(), io::Error> {
    if options.protect_non_empty_from_empty && content.is_empty() {
        if let Ok(existing) = fs::read(path) {
            if !existing.is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Refusing to overwrite non-empty file with empty content",
                ));
            }
        }
    }

    let tmp_path = path.with_extension(options.tmp_extension);
    let mut file = fs::File::create(&tmp_path)?;
    if let Err(error) = file.write_all(content).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }

    if let Err(error) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }

    if let Some(dir) = path.parent() {
        match fs::File::open(dir) {
            Ok(dir_file) => {
                if let Err(error) = dir_file.sync_all() {
                    log::warn!(
                        target: options.log_target,
                        "Failed to fsync directory {:?}: {}",
                        dir,
                        error
                    );
                }
            }
            Err(error) => {
                log::warn!(
                    target: options.log_target,
                    "Failed to open directory {:?} for fsync: {}",
                    dir,
                    error
                );
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn board_markdown_write_refuses_empty_over_non_empty_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md");
        fs::write(&path, "# Board\n").unwrap();

        let result = atomic_write_text(&path, "   \n", AtomicWriteOptions::board_markdown());

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Board\n");
    }

    #[test]
    fn atomic_write_replaces_file_and_removes_temp() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md");
        fs::write(&path, "old").unwrap();

        atomic_write_text(&path, "new", AtomicWriteOptions::board_markdown()).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert!(!path.with_extension("lexera-sync.tmp").exists());
    }

    #[test]
    fn atomic_write_bytes_replaces_file_and_removes_temp() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md.crdt");
        fs::write(&path, b"old").unwrap();

        atomic_write_bytes(&path, b"\x01\x02\x03", AtomicWriteOptions::crdt_snapshot()).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"\x01\x02\x03");
        assert!(!path.with_extension("lexera-crdt.tmp").exists());
    }
}
