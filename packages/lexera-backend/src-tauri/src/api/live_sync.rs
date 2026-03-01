use lexera_core::crdt::bridge::CrdtStore;
use lexera_core::include::{resolver, syntax};
use lexera_core::merge::card_identity;
use lexera_core::types::{IncludeSource, KanbanBoard};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use uuid::Uuid;

static LIVE_SESSIONS: LazyLock<Mutex<LiveSessionRegistry>> =
    LazyLock::new(|| Mutex::new(LiveSessionRegistry::default()));

#[derive(Default)]
struct LiveSessionRegistry {
    sessions: HashMap<String, LiveSession>,
}

struct LiveSession {
    board_dir: PathBuf,
    crdt: CrdtStore,
    current_board: KanbanBoard,
}

pub struct LiveSessionSnapshot {
    pub session_id: String,
    pub board: KanbanBoard,
    pub vv: Vec<u8>,
}

pub struct LiveSessionResult {
    pub board: KanbanBoard,
    pub vv: Vec<u8>,
    pub updates: Vec<u8>,
    pub changed: bool,
}

fn normalize_board(mut board: KanbanBoard, board_dir: &Path) -> KanbanBoard {
    for column in board.all_columns_mut() {
        for card in &mut column.cards {
            let original_content = card.content.clone();
            card.content = card_identity::strip_kid(&original_content);
            if card.kid.is_none() {
                card.kid = Some(card_identity::resolve_kid(&original_content, None));
            }
        }

        column.include_source = syntax::extract_include_path(&column.title).map(|raw_path| {
            IncludeSource {
                resolved_path: resolver::resolve_include_path(&raw_path, board_dir),
                raw_path,
            }
        });
    }
    board
}

fn card_id_map(board: &KanbanBoard) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for column in board.all_columns() {
        for card in &column.cards {
            if let Some(kid) = card.kid.as_ref() {
                if !kid.is_empty() && !card.id.is_empty() {
                    map.insert(kid.clone(), card.id.clone());
                }
            }
        }
    }
    map
}

fn restore_card_ids(board: &mut KanbanBoard, preferred_ids: &[&HashMap<String, String>]) {
    for column in board.all_columns_mut() {
        for card in &mut column.cards {
            let Some(kid) = card.kid.as_ref() else {
                continue;
            };
            for id_map in preferred_ids {
                if let Some(id) = id_map.get(kid) {
                    card.id = id.clone();
                    break;
                }
            }
        }
    }
}

fn encode_vv(store: &CrdtStore) -> Vec<u8> {
    store.oplog_vv().encode()
}

fn session_peer_id(session_id: &Uuid) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&session_id.as_bytes()[..8]);
    let raw = u64::from_le_bytes(bytes);
    if raw <= 1 { raw + 2 } else { raw }
}

pub fn open_session(
    _board_id: &str,
    board: KanbanBoard,
    board_dir: PathBuf,
    snapshot: Option<Vec<u8>>,
) -> Result<LiveSessionSnapshot, String> {
    log::info!(
        target: "lexera.live_sync",
        "Opening live sync session (has_snapshot={})",
        snapshot.is_some()
    );
    let normalized = normalize_board(board, &board_dir);
    let session_uuid = Uuid::new_v4();
    let session_id = session_uuid.to_string();
    let mut crdt = if let Some(bytes) = snapshot {
        CrdtStore::load(&bytes).map_err(|e| e.to_string())?
    } else {
        CrdtStore::from_board(&normalized).map_err(|e| e.to_string())?
    };
    crdt.set_peer_id(session_peer_id(&session_uuid))
        .map_err(|e| e.to_string())?;
    crdt.set_metadata(
        normalized.yaml_header.clone(),
        normalized.kanban_footer.clone(),
        normalized.board_settings.clone(),
    );
    let vv = encode_vv(&crdt);
    let current_board = normalized.clone();

    let mut registry = LIVE_SESSIONS
        .lock()
        .map_err(|_| "Live sync session registry is unavailable".to_string())?;
    registry.sessions.insert(
        session_id.clone(),
        LiveSession {
            board_dir,
            crdt,
            current_board,
        },
    );

    Ok(LiveSessionSnapshot {
        session_id,
        board: normalized,
        vv,
    })
}

pub fn close_session(session_id: &str) -> Result<bool, String> {
    let mut registry = LIVE_SESSIONS
        .lock()
        .map_err(|_| "Live sync session registry is unavailable".to_string())?;
    Ok(registry.sessions.remove(session_id).is_some())
}

pub fn apply_board(session_id: &str, board: KanbanBoard) -> Result<LiveSessionResult, String> {
    let mut registry = LIVE_SESSIONS
        .lock()
        .map_err(|_| "Live sync session registry is unavailable".to_string())?;
    let session = registry
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| format!("Live sync session not found: {}", session_id))?;

    let before_vv = session.crdt.oplog_vv();
    let current_board = session.current_board.clone();
    let incoming = normalize_board(board, &session.board_dir);
    let incoming_ids = card_id_map(&incoming);
    let current_ids = card_id_map(&current_board);

    if let Err(e) = session.crdt.apply_board(&incoming, &current_board) {
        log::error!("[live_sync.apply] Failed to apply board to CRDT: {}", e);
    }
    let mut next_board = normalize_board(session.crdt.to_board(), &session.board_dir);
    restore_card_ids(&mut next_board, &[&incoming_ids, &current_ids]);
    session.current_board = next_board.clone();

    let updates = session
        .crdt
        .export_updates_since(&before_vv)
        .map_err(|e| e.to_string())?;
    let vv = encode_vv(&session.crdt);

    Ok(LiveSessionResult {
        board: next_board,
        vv,
        changed: !updates.is_empty(),
        updates,
    })
}

pub fn import_updates(session_id: &str, bytes: &[u8]) -> Result<LiveSessionResult, String> {
    let mut registry = LIVE_SESSIONS
        .lock()
        .map_err(|_| "Live sync session registry is unavailable".to_string())?;
    let session = registry
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| format!("Live sync session not found: {}", session_id))?;

    let current_board = session.current_board.clone();
    let current_ids = card_id_map(&current_board);
    let before_vv = encode_vv(&session.crdt);

    session
        .crdt
        .import_updates(bytes)
        .map_err(|e| {
            log::warn!(
                target: "lexera.live_sync",
                "Failed to import live sync updates for session {}: {}",
                session_id,
                e
            );
            e.to_string()
        })?;

    let mut next_board = normalize_board(session.crdt.to_board(), &session.board_dir);
    restore_card_ids(&mut next_board, &[&current_ids]);
    session.current_board = next_board.clone();

    let vv = encode_vv(&session.crdt);
    let changed = vv != before_vv;

    Ok(LiveSessionResult {
        board: next_board,
        vv,
        changed,
        updates: Vec::new(),
    })
}
