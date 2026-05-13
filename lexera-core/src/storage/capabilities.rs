use super::StorageError;

pub const CRDT_SYNC_DISABLED_MESSAGE: &str = "CRDT sync is disabled in this build";

pub trait CrdtSyncStorage: Send + Sync {
    fn crdt_sync_available(&self) -> bool;
    fn compact_loaded_crdts(&self) -> usize;
    fn get_crdt_vv(&self, board_id: &str) -> Option<Vec<u8>>;
    fn export_crdt_updates_since(&self, board_id: &str, vv_bytes: &[u8]) -> Option<Vec<u8>>;
    fn export_crdt_snapshot(&self, board_id: &str) -> Option<Vec<u8>>;
    fn import_crdt_updates(&self, board_id: &str, bytes: &[u8]) -> Result<(), StorageError>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct NoCrdtSync;

impl CrdtSyncStorage for NoCrdtSync {
    fn crdt_sync_available(&self) -> bool {
        false
    }

    fn compact_loaded_crdts(&self) -> usize {
        0
    }

    fn get_crdt_vv(&self, _board_id: &str) -> Option<Vec<u8>> {
        None
    }

    fn export_crdt_updates_since(&self, _board_id: &str, _vv_bytes: &[u8]) -> Option<Vec<u8>> {
        None
    }

    fn export_crdt_snapshot(&self, _board_id: &str) -> Option<Vec<u8>> {
        None
    }

    fn import_crdt_updates(&self, board_id: &str, _bytes: &[u8]) -> Result<(), StorageError> {
        Err(StorageError::InvalidBoard(format!(
            "{} for board {}",
            CRDT_SYNC_DISABLED_MESSAGE, board_id
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::{CrdtSyncStorage, NoCrdtSync};

    #[test]
    fn no_crdt_sync_reports_no_capability_without_panicking() {
        let sync = NoCrdtSync;

        assert!(!sync.crdt_sync_available());
        assert_eq!(sync.compact_loaded_crdts(), 0);
        assert!(sync.get_crdt_vv("board").is_none());
        assert!(sync.export_crdt_updates_since("board", &[]).is_none());
        assert!(sync.export_crdt_snapshot("board").is_none());
        assert!(sync.import_crdt_updates("board", b"updates").is_err());
    }
}
