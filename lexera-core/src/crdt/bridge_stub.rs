use std::io;
use std::path::Path;

use crate::types::{BoardSettings, GenerationMeta, KanbanBoard};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CrdtVersionVector(Vec<u8>);

impl CrdtVersionVector {
    pub fn encode(&self) -> Vec<u8> {
        self.0.clone()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ImportStatus;

#[derive(Clone, Debug)]
pub struct CrdtStore {
    board: KanbanBoard,
}

pub fn empty_version_vector() -> CrdtVersionVector {
    CrdtVersionVector::default()
}

pub fn decode_version_vector(bytes: &[u8]) -> io::Result<CrdtVersionVector> {
    Ok(CrdtVersionVector(bytes.to_vec()))
}

fn unsupported_crdt_error(operation: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        format!("CRDT feature is disabled; {} is unavailable", operation),
    )
}

impl CrdtStore {
    pub fn from_board(board: &KanbanBoard) -> io::Result<Self> {
        Ok(Self {
            board: board.clone(),
        })
    }

    pub fn load(bytes: &[u8]) -> io::Result<Self> {
        serde_json::from_slice::<KanbanBoard>(bytes)
            .map(|board| Self { board })
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))
    }

    pub fn save(&self) -> io::Result<Vec<u8>> {
        serde_json::to_vec(&self.board).map_err(|error| io::Error::other(error.to_string()))
    }

    pub fn save_to_file(&self, path: &Path) -> io::Result<()> {
        std::fs::write(path, self.save()?)
    }

    pub fn load_from_file(path: &Path) -> io::Result<Self> {
        let bytes = std::fs::read(path)?;
        Self::load(&bytes)
    }

    pub fn compact_change_store(&self) {}

    pub fn set_metadata(
        &mut self,
        yaml_header: Option<String>,
        kanban_footer: Option<String>,
        board_settings: Option<BoardSettings>,
        generation_meta: Option<GenerationMeta>,
    ) {
        self.board.yaml_header = yaml_header;
        self.board.kanban_footer = kanban_footer;
        self.board.board_settings = board_settings;
        self.board.generation_meta = generation_meta;
    }

    pub fn set_peer_id(&self, _peer_id: u64) -> io::Result<()> {
        Ok(())
    }

    pub fn apply_board(&mut self, incoming: &KanbanBoard, _base: &KanbanBoard) -> io::Result<()> {
        self.board = incoming.clone();
        Ok(())
    }

    pub fn to_board(&self) -> KanbanBoard {
        self.board.clone()
    }

    pub fn to_board_result(&self) -> io::Result<KanbanBoard> {
        Ok(self.to_board())
    }

    pub fn undo(&mut self) -> bool {
        false
    }

    pub fn redo(&mut self) -> bool {
        false
    }

    pub fn can_undo(&self) -> bool {
        false
    }

    pub fn can_redo(&self) -> bool {
        false
    }

    pub fn oplog_vv(&self) -> CrdtVersionVector {
        CrdtVersionVector(self.save().unwrap_or_default())
    }

    pub fn oplog_vv_result(&self) -> io::Result<CrdtVersionVector> {
        Ok(self.oplog_vv())
    }

    pub fn export_updates_since(&self, vv: &CrdtVersionVector) -> io::Result<Vec<u8>> {
        let current = self.save()?;
        if current == vv.encode() {
            Ok(Vec::new())
        } else {
            Ok(current)
        }
    }

    pub fn import_updates(&mut self, bytes: &[u8]) -> io::Result<ImportStatus> {
        if bytes.is_empty() {
            return Ok(ImportStatus);
        }
        let next = Self::load(bytes)?;
        self.board = next.board;
        Ok(ImportStatus)
    }

    pub fn require_real_crdt(operation: &str) -> io::Result<()> {
        Err(unsupported_crdt_error(operation))
    }
}
