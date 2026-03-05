use lexera_core::crdt::bridge::CrdtStore;
use lexera_core::include::{resolver, syntax};
use lexera_core::merge::card_identity;
use lexera_core::parser;
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

        column.include_source =
            syntax::extract_include_path(&column.title).map(|raw_path| IncludeSource {
                resolved_path: resolver::resolve_include_path(&raw_path, board_dir),
                raw_path,
            });
    }
    board.reconcile_format_hint();
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

fn board_kid_sample(board: &KanbanBoard, limit: usize) -> Vec<String> {
    board
        .all_columns()
        .iter()
        .flat_map(|column| column.cards.iter())
        .filter_map(|card| card.kid.clone())
        .take(limit)
        .collect()
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

fn board_visible_signature(board: &KanbanBoard) -> String {
    let mut normalized = board.clone();
    normalized.generation_meta = None;
    normalized.reconcile_format_hint();
    parser::generate_markdown(&normalized)
}

fn boards_match_visible_content(a: &KanbanBoard, b: &KanbanBoard) -> bool {
    board_visible_signature(a) == board_visible_signature(b)
}

fn board_identity_stats(a: &KanbanBoard, b: &KanbanBoard) -> (usize, usize, usize) {
    let a_ids = card_id_map(a);
    let b_ids = card_id_map(b);
    let overlap = a_ids.keys().filter(|kid| b_ids.contains_key(*kid)).count();
    (a_ids.len(), b_ids.len(), overlap)
}

fn encode_vv(store: &CrdtStore) -> Vec<u8> {
    store.oplog_vv().encode()
}

fn session_peer_id(session_id: &Uuid) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&session_id.as_bytes()[..8]);
    let raw = u64::from_le_bytes(bytes);
    if raw <= 1 {
        raw + 2
    } else {
        raw
    }
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
    let normalized_ids = card_id_map(&normalized);
    let (mut crdt, current_board) = if let Some(bytes) = snapshot {
        let loaded = CrdtStore::load(&bytes).map_err(|e| e.to_string())?;
        match loaded.to_board_result() {
            Ok(snapshot_from_crdt) => {
                let mut snapshot_board = normalize_board(snapshot_from_crdt, &board_dir);
                restore_card_ids(&mut snapshot_board, &[&normalized_ids]);
                let (normalized_count, snapshot_count, overlap) =
                    board_identity_stats(&normalized, &snapshot_board);
                log::info!(
                    target: "lexera.live_sync",
                    "[open_session] normalized_vs_snapshot cards=({}, {}) overlap={} normalized={} snapshot={}",
                    normalized_count,
                    snapshot_count,
                    overlap,
                    board_card_summary(&normalized),
                    board_card_summary(&snapshot_board)
                );
                let visible_equal = boards_match_visible_content(&normalized, &snapshot_board);
                log::info!(
                    target: "lexera.live_sync",
                    "[open_session] source_decision visible_equal={} normalized_kids={:?} snapshot_kids={:?}",
                    visible_equal,
                    board_kid_sample(&normalized, 6),
                    board_kid_sample(&snapshot_board, 6)
                );
                if visible_equal {
                    (loaded, snapshot_board)
                } else {
                    log::warn!(
                        target: "lexera.live_sync",
                        "Snapshot diverged from board markdown during session open; rebuilding session CRDT"
                    );
                    (
                        CrdtStore::from_board(&normalized).map_err(|e| e.to_string())?,
                        normalized.clone(),
                    )
                }
            }
            Err(error) => {
                log::warn!(
                    target: "lexera.live_sync",
                    "Snapshot CRDT could not be materialized during session open; rebuilding from markdown board: {}",
                    error
                );
                (
                    CrdtStore::from_board(&normalized).map_err(|e| e.to_string())?,
                    normalized.clone(),
                )
            }
        }
    } else {
        (
            CrdtStore::from_board(&normalized).map_err(|e| e.to_string())?,
            normalized.clone(),
        )
    };
    crdt.set_peer_id(session_peer_id(&session_uuid))
        .map_err(|e| e.to_string())?;
    crdt.set_metadata(
        normalized.yaml_header.clone(),
        normalized.kanban_footer.clone(),
        normalized.board_settings.clone(),
        normalized.generation_meta.clone(),
    );
    let vv = encode_vv(&crdt);

    let mut registry = LIVE_SESSIONS
        .lock()
        .map_err(|_| "Live sync session registry is unavailable".to_string())?;
    registry.sessions.insert(
        session_id.clone(),
        LiveSession {
            board_dir,
            crdt,
            current_board: current_board.clone(),
        },
    );

    Ok(LiveSessionSnapshot {
        session_id,
        board: current_board,
        vv,
    })
}

pub fn close_session(session_id: &str) -> Result<bool, String> {
    let mut registry = LIVE_SESSIONS
        .lock()
        .map_err(|_| "Live sync session registry is unavailable".to_string())?;
    Ok(registry.sessions.remove(session_id).is_some())
}

fn board_card_summary(board: &KanbanBoard) -> String {
    let cols: Vec<String> = board
        .all_columns()
        .iter()
        .map(|col| {
            let kids: Vec<&str> = col
                .cards
                .iter()
                .map(|c| c.kid.as_deref().unwrap_or("??"))
                .collect();
            format!("[{}:{}]", col.title, kids.join(","))
        })
        .collect();
    cols.join(" ")
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
    let (incoming_count, current_count, overlap_before) =
        board_identity_stats(&incoming, &current_board);

    log::info!(
        target: "lexera.live_sync",
        "[apply_board] session={} ids_before=({}, {}, overlap={}) incoming={} current={}",
        &session_id[..8],
        incoming_count,
        current_count,
        overlap_before,
        board_card_summary(&incoming),
        board_card_summary(&current_board)
    );

    if let Err(e) = session.crdt.apply_board(&incoming, &current_board) {
        log::error!(
            target: "lexera.live_sync",
            "[apply_board] FAILED session={} error={} incoming={} current={}",
            &session_id[..8],
            e,
            board_card_summary(&incoming),
            board_card_summary(&current_board)
        );
        session.crdt = CrdtStore::from_board(&current_board).map_err(|rebuild_error| {
            format!(
                "Failed to rebuild session CRDT after apply failure (session={}): {}",
                &session_id[..8],
                rebuild_error
            )
        })?;
        session.current_board = current_board;
        return Err(format!(
            "Failed to apply live sync board for session {}: {}",
            &session_id[..8],
            e
        ));
    }
    let next_snapshot = match session.crdt.to_board_result() {
        Ok(board) => board,
        Err(error) => {
            log::error!(
                target: "lexera.live_sync",
                "[apply_board] FAILED to materialize CRDT after apply session={} error={}",
                &session_id[..8],
                error
            );
            session.crdt = CrdtStore::from_board(&current_board).map_err(|rebuild_error| {
                format!(
                    "Failed to rebuild session CRDT after materialize failure (session={}): {}",
                    &session_id[..8],
                    rebuild_error
                )
            })?;
            session.current_board = current_board;
            return Err(format!(
                "Failed to materialize live sync board after apply for session {}: {}",
                &session_id[..8],
                error
            ));
        }
    };
    let mut next_board = normalize_board(next_snapshot, &session.board_dir);
    restore_card_ids(&mut next_board, &[&incoming_ids, &current_ids]);
    let (next_count, _, overlap_after) = board_identity_stats(&next_board, &incoming);

    log::info!(
        target: "lexera.live_sync",
        "[apply_board] session={} ids_after=({}, {}, overlap_with_incoming={}) crdt_output={} updates_len={}",
        &session_id[..8],
        next_count,
        incoming_count,
        overlap_after,
        board_card_summary(&next_board),
        session.crdt.export_updates_since(&before_vv).as_ref().map(|u| u.len()).unwrap_or(0)
    );

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

    log::info!(
        target: "lexera.live_sync",
        "[import_updates] session={} bytes={} before={}",
        &session_id[..8],
        bytes.len(),
        board_card_summary(&current_board)
    );

    if let Err(error) = session.crdt.import_updates(bytes) {
        log::warn!(
            target: "lexera.live_sync",
            "[import_updates] FAILED session={} bytes={} error={} before={}",
            &session_id[..8],
            bytes.len(),
            error,
            board_card_summary(&current_board)
        );
        session.crdt = CrdtStore::from_board(&current_board).map_err(|rebuild_error| {
            format!(
                "Failed to rebuild session CRDT after import failure (session={}): {}",
                &session_id[..8],
                rebuild_error
            )
        })?;
        session.current_board = current_board;
        return Err(format!(
            "Failed to import live sync updates for session {}: {}",
            &session_id[..8],
            error
        ));
    }

    let next_snapshot = match session.crdt.to_board_result() {
        Ok(board) => board,
        Err(error) => {
            log::error!(
                target: "lexera.live_sync",
                "[import_updates] FAILED to materialize CRDT session={} error={}",
                &session_id[..8],
                error
            );
            session.crdt = CrdtStore::from_board(&current_board).map_err(|rebuild_error| {
                format!(
                    "Failed to rebuild session CRDT after import materialize failure (session={}): {}",
                    &session_id[..8],
                    rebuild_error
                )
            })?;
            session.current_board = current_board;
            return Err(format!(
                "Failed to materialize board after importing live sync updates for session {}: {}",
                &session_id[..8],
                error
            ));
        }
    };
    let mut next_board = normalize_board(next_snapshot, &session.board_dir);
    restore_card_ids(&mut next_board, &[&current_ids]);

    let vv = encode_vv(&session.crdt);
    let changed = vv != before_vv;
    let (current_count, next_count, overlap_after) =
        board_identity_stats(&current_board, &next_board);

    log::info!(
        target: "lexera.live_sync",
        "[import_updates] session={} changed={} ids_after=({}, {}, overlap={}) after={}",
        &session_id[..8],
        changed,
        current_count,
        next_count,
        overlap_after,
        board_card_summary(&next_board)
    );

    session.current_board = next_board.clone();

    Ok(LiveSessionResult {
        board: next_board,
        vv,
        changed,
        updates: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_session_reuses_matching_snapshot_card_identities() {
        let markdown = "\
---
kanban-plugin: board
---

## Todo
- [ ] Buy groceries
- [ ] Walk the dog

## Done
- [x] Laundry
";
        let board_dir = PathBuf::from(".");
        let board = normalize_board(parser::parse_markdown(markdown), &board_dir);

        let mut snapshot_board = board.clone();
        let expected_kids = ["a1b2c3d4", "b1c2d3e4", "c1d2e3f4"];
        let mut next = 0usize;
        for column in snapshot_board.all_columns_mut() {
            for card in &mut column.cards {
                card.kid = Some(expected_kids[next].to_string());
                card.id = format!("seed-{}", next);
                next += 1;
            }
        }

        let snapshot = CrdtStore::from_board(&snapshot_board)
            .unwrap()
            .save()
            .unwrap();
        let session = open_session("board-1", board, board_dir, Some(snapshot)).unwrap();

        let kids: Vec<String> = session
            .board
            .all_columns()
            .iter()
            .flat_map(|column| column.cards.iter())
            .map(|card| card.kid.clone().unwrap())
            .collect();
        assert_eq!(
            kids,
            expected_kids
                .iter()
                .map(|kid| kid.to_string())
                .collect::<Vec<_>>()
        );

        close_session(&session.session_id).unwrap();
    }
}
