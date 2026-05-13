use std::fs;
use std::io;
use std::path::Path;

use crate::crdt::bridge::CrdtStore;

use super::persistence::{atomic_write_bytes, AtomicWriteOptions};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotWrite {
    Written,
    Unchanged,
}

pub fn save_snapshot_if_changed(path: &Path, bytes: &[u8]) -> Result<SnapshotWrite, io::Error> {
    let unchanged = path
        .exists()
        .then(|| fs::read(path).ok())
        .flatten()
        .map(|existing| existing == bytes)
        .unwrap_or(false);

    if unchanged {
        return Ok(SnapshotWrite::Unchanged);
    }

    atomic_write_bytes(path, bytes, AtomicWriteOptions::crdt_snapshot())?;
    Ok(SnapshotWrite::Written)
}

#[cfg(feature = "crdt")]
pub fn save_store_snapshot_if_changed(
    path: &Path,
    crdt: &CrdtStore,
) -> Result<SnapshotWrite, io::Error> {
    let bytes = crdt.save()?;
    save_snapshot_if_changed(path, &bytes)
}

#[cfg(not(feature = "crdt"))]
pub fn save_store_snapshot_if_changed(
    _path: &Path,
    _crdt: &CrdtStore,
) -> Result<SnapshotWrite, io::Error> {
    Ok(SnapshotWrite::Unchanged)
}

#[cfg(feature = "crdt")]
pub fn save_store_snapshot(path: &Path, crdt: &CrdtStore) -> Result<(), io::Error> {
    let bytes = crdt.save()?;
    atomic_write_bytes(path, &bytes, AtomicWriteOptions::crdt_snapshot())
}

#[cfg(not(feature = "crdt"))]
pub fn save_store_snapshot(_path: &Path, _crdt: &CrdtStore) -> Result<(), io::Error> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn save_snapshot_skips_identical_bytes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md.crdt");
        fs::write(&path, b"snapshot").unwrap();

        let result = save_snapshot_if_changed(&path, b"snapshot").unwrap();

        assert_eq!(result, SnapshotWrite::Unchanged);
        assert_eq!(fs::read(&path).unwrap(), b"snapshot");
        assert!(!path.with_extension("lexera-crdt.tmp").exists());
    }

    #[test]
    fn save_snapshot_writes_changed_bytes_atomically() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("board.md.crdt");
        fs::write(&path, b"old").unwrap();

        let result = save_snapshot_if_changed(&path, b"new").unwrap();

        assert_eq!(result, SnapshotWrite::Written);
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert!(!path.with_extension("lexera-crdt.tmp").exists());
    }
}
